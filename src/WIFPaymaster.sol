// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPaymaster} from "account-abstraction/interfaces/IPaymaster.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";
import {UserOperationLib} from "account-abstraction/core/UserOperationLib.sol";
import {_packValidationData} from "account-abstraction/core/Helpers.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IRateProvider} from "./interfaces/IRateProvider.sol";

/**
 * @title WIFPaymaster
 * @notice ERC-4337 (EntryPoint v0.7) Paymaster that lets users pay gas in $WIF on Robinhood Chain.
 *
 * Flow:
 * 1. User submits UserOp with this paymaster.
 * 2. validatePaymasterUserOp prices maxCost in WIF (rate * premium) and pulls that prefund from the user.
 * 3. The UserOp executes. Whatever it does (revoke allowance, spend its WIF, revert) cannot dodge the fee.
 * 4. postOp charges the actual cost, refunds the rest, burns a portion and sends the remainder to treasury.
 *
 * ERC-7562 (bundler validation rules):
 * - Validation never reads block.timestamp. Rate expiry is returned as validUntil and enforced by the EntryPoint.
 * - Validation reads the rate provider and writes token storage, so the paymaster must be staked.
 *
 * Optional user protection: paymasterAndData may carry a uint256 maxWif after the gas limits
 * ([paymaster | verificationGas | postOpGas | maxWif]). It is covered by the user's signature, so the
 * owner cannot raise the rate or premium above what the user agreed to.
 *
 * Safety:
 * - Hard per-tx ETH cost cap
 * - Daily global sponsorship limit (counted on actual cost)
 * - Bounded rate from RateProvider with expiry
 * - Fee is collected for reverted UserOps too, so the deposit cannot be drained for free
 */
contract WIFPaymaster is IPaymaster {
    using SafeERC20 for IERC20;

    IEntryPoint public immutable entryPoint;
    IERC20 public immutable wif;
    IRateProvider public rateProvider;

    address public owner;
    address public treasury;          // receives non-burned WIF
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    // Config (owner-settable)
    uint256 public premiumBps = 1500;          // 15% premium over pure gas cost
    uint256 public burnBps = 3000;             // 30% of collected WIF is burned
    uint256 public maxGasCostWei = 0.02 ether; // hard per-tx cap (~$50 at $2500 ETH)
    uint256 public dailyLimitWei = 1 ether;    // global daily sponsorship limit
    uint256 public postOpGasOverhead = 120_000; // postOp gas (~90k) + EntryPoint unused-gas penalty, excluded from actualGasCost

    // State
    uint256 public dailySpentWei;
    uint256 public lastDayTimestamp;

    // Events
    event UserOpSponsored(
        address indexed sender,
        bytes32 indexed userOpHash,
        uint256 ethCost,
        uint256 wifCharged,
        uint256 wifBurned
    );
    event ConfigUpdated(string param, uint256 value);
    event RateProviderUpdated(address newProvider);
    event TreasuryUpdated(address newTreasury);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // Errors
    error OnlyEntryPoint();
    error OnlyOwner();
    error ExceedsMaxGasCost();
    error DailyLimitExceeded();
    error InsufficientWifBalance();
    error InsufficientWifAllowance();
    error WifCostAboveUserLimit();
    error ZeroAddress();
    error InvalidBps();

    modifier onlyEntryPoint() {
        if (msg.sender != address(entryPoint)) revert OnlyEntryPoint();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor(
        IEntryPoint _entryPoint,
        IERC20 _wif,
        IRateProvider _rateProvider,
        address _treasury
    ) {
        if (address(_entryPoint) == address(0) || address(_wif) == address(0) || address(_rateProvider) == address(0) || _treasury == address(0)) {
            revert ZeroAddress();
        }
        entryPoint = _entryPoint;
        wif = _wif;
        rateProvider = _rateProvider;
        treasury = _treasury;
        owner = msg.sender;
        lastDayTimestamp = block.timestamp;
    }

    // ============ ERC-4337 required functions ============

    /**
     * @notice Called by EntryPoint during validation. Pulls the maximum WIF fee up front.
     * @return context Encoded data passed to postOp (sender, prefund, rate, userOpHash)
     * @return validationData validUntil = rate expiry, no aggregator
     */
    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    ) external onlyEntryPoint returns (bytes memory context, uint256 validationData) {
        // 1. Enforce hard per-tx cap
        if (maxCost > maxGasCostWei) revert ExceedsMaxGasCost();

        // 2. Enforce daily limit (the window rolls in postOp, where timestamps are allowed)
        if (dailySpentWei + maxCost > dailyLimitWei) revert DailyLimitExceeded();

        // 3. Price the worst case in WIF. Reverts if the provider is paused.
        (uint256 wifPerEth, uint48 validUntil) = rateProvider.quote();
        uint256 prefund = _wifFor(maxCost, wifPerEth);

        // 4. Respect the user's signed cap, if any
        bytes calldata pmData = userOp.paymasterAndData;
        uint256 offset = UserOperationLib.PAYMASTER_DATA_OFFSET;
        if (pmData.length >= offset + 32) {
            uint256 maxWif = uint256(bytes32(pmData[offset:offset + 32]));
            if (prefund > maxWif) revert WifCostAboveUserLimit();
        }

        // 5. Pull the prefund now, so nothing the UserOp does can avoid payment
        address sender = userOp.sender;
        if (wif.balanceOf(sender) < prefund) revert InsufficientWifBalance();
        if (wif.allowance(sender, address(this)) < prefund) revert InsufficientWifAllowance();
        wif.safeTransferFrom(sender, address(this), prefund);

        context = abi.encode(sender, prefund, wifPerEth, userOpHash);
        validationData = _packValidationData(false, validUntil, 0);
    }

    /**
     * @notice Called by EntryPoint after the UserOp executes (or reverts).
     *         Charges the actual cost in both cases and refunds the unused prefund.
     */
    function postOp(
        PostOpMode, // charged whether the UserOp succeeded or reverted
        bytes calldata context,
        uint256 actualGasCost,
        uint256 actualUserOpFeePerGas
    ) external onlyEntryPoint {
        (address sender, uint256 prefund, uint256 wifPerEth, bytes32 userOpHash) =
            abi.decode(context, (address, uint256, uint256, bytes32));

        // Use the rate the user was validated against, so postOp cannot fail on a stale provider
        uint256 ethCost = actualGasCost + postOpGasOverhead * actualUserOpFeePerGas;
        uint256 wifToCharge = _wifFor(ethCost, wifPerEth);
        if (wifToCharge > prefund) {
            wifToCharge = prefund;
        }

        _recordSpend(ethCost);

        uint256 refund = prefund - wifToCharge;
        if (refund > 0) {
            wif.safeTransfer(sender, refund);
        }

        // Burn portion
        uint256 toBurn = (wifToCharge * burnBps) / 10_000;
        if (toBurn > 0) {
            wif.safeTransfer(BURN_ADDRESS, toBurn);
        }

        // Rest to treasury
        uint256 toTreasury = wifToCharge - toBurn;
        if (toTreasury > 0) {
            wif.safeTransfer(treasury, toTreasury);
        }

        emit UserOpSponsored(sender, userOpHash, ethCost, wifToCharge, toBurn);
    }

    /// @notice WIF (with premium) charged for `ethAmount` wei of gas at the current rate. For UIs.
    function quoteWif(uint256 ethAmount) external view returns (uint256) {
        (uint256 wifPerEth,) = rateProvider.quote();
        return _wifFor(ethAmount, wifPerEth);
    }

    /// @notice Starts a new daily window if the current one has ended. Anyone can call it, so a full
    ///         window never stays blocked just because no UserOp could pass validation to roll it.
    function rollDailyWindow() public {
        if (block.timestamp >= lastDayTimestamp + 1 days) {
            dailySpentWei = 0;
            lastDayTimestamp = block.timestamp;
        }
    }

    // ============ Internal ============

    function _wifFor(uint256 ethAmount, uint256 wifPerEth) internal view returns (uint256) {
        return (ethAmount * wifPerEth * (10_000 + premiumBps)) / (1e18 * 10_000);
    }

    function _recordSpend(uint256 cost) internal {
        rollDailyWindow();
        dailySpentWei += cost;
    }

    // ============ Admin ============

    function setPremiumBps(uint256 _premiumBps) external onlyOwner {
        if (_premiumBps > 5000) revert InvalidBps(); // max 50%
        premiumBps = _premiumBps;
        emit ConfigUpdated("premiumBps", _premiumBps);
    }

    function setBurnBps(uint256 _burnBps) external onlyOwner {
        if (_burnBps > 10_000) revert InvalidBps();
        burnBps = _burnBps;
        emit ConfigUpdated("burnBps", _burnBps);
    }

    function setMaxGasCostWei(uint256 _max) external onlyOwner {
        maxGasCostWei = _max;
        emit ConfigUpdated("maxGasCostWei", _max);
    }

    function setDailyLimitWei(uint256 _limit) external onlyOwner {
        dailyLimitWei = _limit;
        emit ConfigUpdated("dailyLimitWei", _limit);
    }

    function setPostOpGasOverhead(uint256 _gas) external onlyOwner {
        postOpGasOverhead = _gas;
        emit ConfigUpdated("postOpGasOverhead", _gas);
    }

    function setRateProvider(IRateProvider _provider) external onlyOwner {
        if (address(_provider) == address(0)) revert ZeroAddress();
        rateProvider = _provider;
        emit RateProviderUpdated(address(_provider));
    }

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        address old = owner;
        owner = newOwner;
        emit OwnershipTransferred(old, newOwner);
    }

    // Allow owner to deposit ETH into EntryPoint for gas sponsorship
    function depositToEntryPoint() external payable onlyOwner {
        entryPoint.depositTo{value: msg.value}(address(this));
    }

    // Allow owner to withdraw unused ETH from EntryPoint
    function withdrawFromEntryPoint(address payable to, uint256 amount) external onlyOwner {
        entryPoint.withdrawTo(to, amount);
    }

    // Emergency: withdraw any stuck WIF (prefunds only sit here inside a bundle, never between txs)
    function rescueWif(address to, uint256 amount) external onlyOwner {
        wif.safeTransfer(to, amount);
    }

    // Bundlers require a stake because validation touches storage outside the sender
    function addStake(uint32 unstakeDelaySec) external payable onlyOwner {
        entryPoint.addStake{value: msg.value}(unstakeDelaySec);
    }

    function unlockStake() external onlyOwner {
        entryPoint.unlockStake();
    }

    function withdrawStake(address payable to) external onlyOwner {
        entryPoint.withdrawStake(to);
    }
}

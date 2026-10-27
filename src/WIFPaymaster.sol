// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPaymaster} from "account-abstraction/interfaces/IPaymaster.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";
import {IRateProvider} from "./interfaces/IRateProvider.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";

/**
 * @title WIFPaymaster
 * @notice ERC-4337 Paymaster that lets users pay gas in $WIF on Robinhood Chain.
 *
 * Flow:
 * 1. User submits UserOp with this paymaster.
 * 2. validatePaymasterUserOp calculates required WIF (gas cost * rate * premium).
 * 3. Checks user balance + allowance + hard caps.
 * 4. postOp pulls WIF, burns a portion, sends rest to treasury.
 *
 * Safety:
 * - Hard per-tx ETH cost cap
 * - Daily global sponsorship limit
 * - Bounded rate from RateProvider
 * - Requires explicit WIF allowance
 */
contract WIFPaymaster is IPaymaster {
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
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // Errors
    error OnlyEntryPoint();
    error OnlyOwner();
    error RateProviderUnhealthy();
    error ExceedsMaxGasCost();
    error DailyLimitExceeded();
    error InsufficientWifBalance();
    error InsufficientWifAllowance();
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
     * @notice Called by EntryPoint during validation.
     * @return context Encoded data passed to postOp (sender, ethCost, wifAmount)
     * @return validationData 0 = success (valid until max uint48, aggregator = 0)
     */
    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    ) external onlyEntryPoint returns (bytes memory context, uint256 validationData) {
        // 1. Check rate provider is healthy
        if (!rateProvider.isHealthy()) revert RateProviderUnhealthy();

        // 2. Enforce hard per-tx cap
        if (maxCost > maxGasCostWei) revert ExceedsMaxGasCost();

        // 3. Enforce daily limit (simple rolling 24h)
        _updateDailyLimit(maxCost);

        // 4. Calculate required WIF
        uint256 baseWif = rateProvider.getWifForEth(maxCost);
        uint256 wifRequired = (baseWif * (10_000 + premiumBps)) / 10_000;

        // 5. Check user has enough WIF + allowance
        address sender = userOp.sender;
        if (wif.balanceOf(sender) < wifRequired) revert InsufficientWifBalance();
        if (wif.allowance(sender, address(this)) < wifRequired) revert InsufficientWifAllowance();

        // 6. Pack context for postOp
        context = abi.encode(sender, maxCost, wifRequired, userOpHash);
        validationData = 0; // valid indefinitely, no aggregator
    }

    /**
     * @notice Called by EntryPoint after the UserOp executes (or reverts).
     *         We only charge on successful execution (mode == opSucceeded).
     */
    function postOp(
        PostOpMode mode,
        bytes calldata context,
        uint256 actualGasCost,
        uint256 // actualUserOpFeePerGas - unused
    ) external onlyEntryPoint {
        // Only charge on success. On failure we could still charge a small amount,
        // but for better UX we refund the full pre-charge conceptually by not pulling.
        if (mode != PostOpMode.opSucceeded) {
            return;
        }

        (address sender, uint256 maxCost, uint256 wifRequired, bytes32 userOpHash) =
            abi.decode(context, (address, uint256, uint256, bytes32));

        // Recalculate with actual cost for fairness (still apply premium)
        uint256 baseWif = rateProvider.getWifForEth(actualGasCost);
        uint256 wifToCharge = (baseWif * (10_000 + premiumBps)) / 10_000;

        // Cap at what we pre-validated
        if (wifToCharge > wifRequired) {
            wifToCharge = wifRequired;
        }

        // Pull WIF from user
        bool success = wif.transferFrom(sender, address(this), wifToCharge);
        require(success, "WIF transfer failed");

        // Burn portion
        uint256 toBurn = (wifToCharge * burnBps) / 10_000;
        if (toBurn > 0) {
            wif.transfer(BURN_ADDRESS, toBurn);
        }

        // Rest to treasury
        uint256 toTreasury = wifToCharge - toBurn;
        if (toTreasury > 0) {
            wif.transfer(treasury, toTreasury);
        }

        emit UserOpSponsored(sender, userOpHash, actualGasCost, wifToCharge, toBurn);
    }

    // ============ Internal ============

    function _updateDailyLimit(uint256 cost) internal {
        if (block.timestamp >= lastDayTimestamp + 1 days) {
            dailySpentWei = 0;
            lastDayTimestamp = block.timestamp;
        }
        if (dailySpentWei + cost > dailyLimitWei) revert DailyLimitExceeded();
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

    function setRateProvider(IRateProvider _provider) external onlyOwner {
        if (address(_provider) == address(0)) revert ZeroAddress();
        rateProvider = _provider;
        emit RateProviderUpdated(address(_provider));
    }

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;
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

    // Emergency: withdraw any stuck WIF
    function rescueWif(address to, uint256 amount) external onlyOwner {
        wif.transfer(to, amount);
    }

    // Required by some interfaces / for stake
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

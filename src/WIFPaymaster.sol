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

interface IBurnable {
    function burn(uint256 amount) external;
}

/**
 * @title WIFPaymaster
 * @notice ERC-4337 (EntryPoint v0.7) Paymaster that lets users pay gas in $WIF on Robinhood Chain.
 *
 * Flow:
 * 1. User submits UserOp with this paymaster.
 * 2. validatePaymasterUserOp prices maxCost in WIF (rate * premium) and pulls that prefund from the user.
 * 3. The UserOp executes. Whatever it does (revoke allowance, spend its WIF, revert) cannot dodge the fee.
 * 4. postOp charges the actual cost and refunds the rest. The fee is split into a burn share and a
 *    treasury share that accumulate here; anyone can flush() them, which calls WIF.burn() for real.
 *
 * ERC-7562 (bundler validation rules):
 * - Validation never reads block.timestamp. Rate expiry is returned as validUntil, and a full daily
 *   window is returned as validAfter (the time it ends). The EntryPoint enforces both.
 * - Validation reads the rate provider and writes token storage, so the paymaster must be staked.
 *
 * First op of a new account: it holds WIF but cannot approve us without gas. If the allowance is short,
 * one op per account is accepted when its callData only does approve(paymaster, >= fee) on WIF, through
 * the account's standard single-call entry point (SimpleAccount/Light/Coinbase execute, Safe 4337 module,
 * ERC-7579 execute for Kernel/Nexus). The fee is collected in postOp, after the approve ran. A collection
 * failure never reverts postOp, so a fake "approve" costs us at most one op of gas per account.
 *
 * Optional user protection: paymasterAndData may carry a uint256 maxWif after the gas limits
 * ([paymaster | verificationGas | postOpGas | maxWif]). It is covered by the user's signature, so the
 * owner cannot raise the rate or premium above what the user agreed to.
 *
 * Safety:
 * - Hard per-tx ETH cost cap
 * - Global and per-account daily sponsorship limits (counted on actual cost)
 * - Bounded, expiring rate from RateProvider; keeper updates are rate-limited there
 * - Fee is collected for reverted UserOps too, so the deposit cannot be drained for free
 * - Two-step ownership transfer; rescueWif cannot touch WIF owed to the burn or the treasury
 */
contract WIFPaymaster is IPaymaster {
    using SafeERC20 for IERC20;

    IEntryPoint public immutable entryPoint;
    IERC20 public immutable wif;
    IRateProvider public rateProvider;

    address public owner;
    address public pendingOwner;
    address public treasury;          // receives non-burned WIF
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD; // only if burn() fails

    // Single-call entry points of common smart accounts, accepted for the setup op
    bytes4 private constant EXECUTE = 0xb61d27f6;          // execute(address,uint256,bytes): Simple, Light, Coinbase, Thirdweb
    bytes4 private constant EXECUTE_7579 = 0xe9ae5c53;     // execute(bytes32,bytes): Kernel v3, Nexus
    bytes4 private constant SAFE_EXECUTE = 0x7bb37428;     // executeUserOp(address,uint256,bytes,uint8): Safe4337Module
    bytes4 private constant SAFE_EXECUTE_ERR = 0x541d63c8; // executeUserOpWithErrorString(address,uint256,bytes,uint8)

    // Config (owner-settable)
    uint256 public premiumBps = 1500;              // 15% premium over pure gas cost
    uint256 public burnBps = 3000;                 // 30% of collected WIF is burned
    uint256 public maxGasCostWei = 0.02 ether;     // hard per-tx cap (~$50 at $2500 ETH)
    uint256 public dailyLimitWei = 1 ether;        // global daily sponsorship limit
    uint256 public accountDailyLimitWei = 0.05 ether; // per-account daily limit, so one sender can't use up the global one
    uint256 public postOpGasOverhead = 120_000;    // worst case: setup-op postOp (~108k) + EntryPoint unused-gas penalty

    // State
    struct Window {
        uint128 spentWei;
        uint64 start;
    }

    struct Totals {
        uint64 ops;
        uint96 wifCharged;
        uint96 wifBurned; // assigned to the burn; flushed or still in pendingBurn
    }

    Window public daily;
    mapping(address => Window) public accountWindow;
    mapping(address => bool) public setupUsed; // account already used its one approve-only op
    uint128 public pendingBurn;
    uint128 public pendingTreasury;
    Totals public totals;

    // Events
    event UserOpSponsored(
        address indexed sender,
        bytes32 indexed userOpHash,
        uint256 ethCost,
        uint256 wifCharged,
        uint256 wifBurned
    );
    event SetupFeeUnpaid(address indexed sender, bytes32 indexed userOpHash, uint256 ethCost);
    event Flushed(uint256 wifBurned, uint256 wifToTreasury);
    event ConfigUpdated(string param, uint256 value);
    event RateProviderUpdated(address newProvider);
    event TreasuryUpdated(address newTreasury);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
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
    error AmountReserved();

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
        daily.start = uint64(block.timestamp);
    }

    // ============ ERC-4337 required functions ============

    /**
     * @notice Called by EntryPoint during validation. Pulls the maximum WIF fee up front.
     * @return context Encoded data passed to postOp (sender, prefund, rate, userOpHash, prepaid)
     * @return validationData validUntil = rate expiry; validAfter = end of a full daily window, if any
     */
    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    ) external onlyEntryPoint returns (bytes memory context, uint256 validationData) {
        // 1. Enforce hard caps that no window can satisfy
        if (maxCost > maxGasCostWei) revert ExceedsMaxGasCost();
        if (maxCost > dailyLimitWei || maxCost > accountDailyLimitWei) revert DailyLimitExceeded();

        // 2. Price the worst case in WIF. Reverts if the provider is paused.
        (uint256 wifPerEth, uint48 validUntil) = rateProvider.quote();
        uint256 prefund = _wifFor(maxCost, wifPerEth);

        // 3. Respect the user's signed cap, if any
        _checkUserLimit(userOp.paymasterAndData, prefund);

        // 4. Pull the prefund now, so nothing the UserOp does can avoid payment
        address sender = userOp.sender;
        if (wif.balanceOf(sender) < prefund) revert InsufficientWifBalance();
        bool prepaid = wif.allowance(sender, address(this)) >= prefund;
        if (prepaid) {
            wif.safeTransferFrom(sender, address(this), prefund);
        } else {
            // One approve-only setup op per account, charged in postOp
            if (setupUsed[sender] || !_isApproveCall(userOp.callData, prefund)) revert InsufficientWifAllowance();
            setupUsed[sender] = true;
        }

        context = abi.encode(sender, prefund, wifPerEth, userOpHash, prepaid);
        validationData = _packValidationData(false, validUntil, _validAfter(sender, maxCost));
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
        (address sender, uint256 prefund, uint256 wifPerEth, bytes32 userOpHash, bool prepaid) =
            abi.decode(context, (address, uint256, uint256, bytes32, bool));

        // Use the rate the user was validated against, so postOp cannot fail on a stale provider
        uint256 ethCost = actualGasCost + postOpGasOverhead * actualUserOpFeePerGas;
        uint256 wifToCharge = _wifFor(ethCost, wifPerEth);
        if (wifToCharge > prefund) {
            wifToCharge = prefund;
        }

        _recordSpend(daily, ethCost);
        _recordSpend(accountWindow[sender], ethCost);

        if (prepaid) {
            uint256 refund = prefund - wifToCharge;
            if (refund > 0) {
                wif.safeTransfer(sender, refund);
            }
        } else if (!_tryPullWif(sender, wifToCharge)) {
            // Setup op whose approve did not happen (reverted or fake). Never revert here.
            emit SetupFeeUnpaid(sender, userOpHash, ethCost);
            return;
        }

        uint256 toBurn = _book(wifToCharge);
        emit UserOpSponsored(sender, userOpHash, ethCost, wifToCharge, toBurn);
    }

    /// @notice Burns the pending burn share with WIF.burn() and sends the treasury share. Anyone can call it.
    function flush() external {
        uint256 toBurn = pendingBurn;
        uint256 toTreasury = pendingTreasury;
        pendingBurn = 0;
        pendingTreasury = 0;
        if (toBurn > 0) {
            // Real supply reduction; fall back to the dead address if the token ever refuses
            try IBurnable(address(wif)).burn(toBurn) {}
            catch {
                wif.safeTransfer(BURN_ADDRESS, toBurn);
            }
        }
        if (toTreasury > 0) {
            wif.safeTransfer(treasury, toTreasury);
        }
        emit Flushed(toBurn, toTreasury);
    }

    /// @notice WIF (with premium) charged for `ethAmount` wei of gas at the current rate. For UIs.
    function quoteWif(uint256 ethAmount) external view returns (uint256) {
        (uint256 wifPerEth,) = rateProvider.quote();
        return _wifFor(ethAmount, wifPerEth);
    }

    // ============ Internal ============

    function _wifFor(uint256 ethAmount, uint256 wifPerEth) internal view returns (uint256) {
        return (ethAmount * wifPerEth * (10_000 + premiumBps)) / (1e18 * 10_000);
    }

    /// @dev Splits a collected fee into the burn and treasury shares. They are settled in batches by
    ///      flush(), so each op pays for one transfer instead of three.
    function _book(uint256 wifCharged) internal returns (uint256 toBurn) {
        toBurn = (wifCharged * burnBps) / 10_000;
        pendingBurn += uint128(toBurn);
        pendingTreasury += uint128(wifCharged - toBurn);
        Totals memory t = totals;
        totals = Totals(t.ops + 1, t.wifCharged + uint96(wifCharged), t.wifBurned + uint96(toBurn));
    }

    function _checkUserLimit(bytes calldata pmData, uint256 prefund) internal pure {
        uint256 offset = UserOperationLib.PAYMASTER_DATA_OFFSET;
        if (pmData.length >= offset + 32 && prefund > uint256(bytes32(pmData[offset:offset + 32]))) {
            revert WifCostAboveUserLimit();
        }
    }

    /// @dev Daily limits: a full window makes the op valid only once that window ends. If the window
    ///      already ended, the result is in the past and postOp opens a new one.
    function _validAfter(address sender, uint256 maxCost) internal view returns (uint48 validAfter) {
        validAfter = _fullUntil(daily, maxCost, dailyLimitWei);
        uint48 accountAfter = _fullUntil(accountWindow[sender], maxCost, accountDailyLimitWei);
        if (accountAfter > validAfter) validAfter = accountAfter;
    }

    /// @dev 0 if `cost` fits in the window, otherwise the time the window ends.
    function _fullUntil(Window memory w, uint256 cost, uint256 limit) internal pure returns (uint48) {
        if (w.spentWei + cost <= limit) return 0;
        return uint48(w.start + 1 days);
    }

    function _recordSpend(Window storage w, uint256 cost) internal {
        if (block.timestamp >= w.start + 1 days) {
            w.spentWei = 0;
            w.start = uint64(block.timestamp);
        }
        w.spentWei += uint128(cost);
    }

    /// @dev True if callData makes the account call approve(this, amount >= minAmount) on WIF and nothing else.
    function _isApproveCall(bytes calldata callData, uint256 minAmount) internal view returns (bool) {
        if (callData.length < 4) return false;
        bytes4 selector = bytes4(callData[:4]);
        address target;
        uint256 value;
        bytes memory data;
        uint256 start; // where the inner call starts in `data`

        if (selector == EXECUTE) {
            (target, value, data) = abi.decode(callData[4:], (address, uint256, bytes));
        } else if (selector == SAFE_EXECUTE || selector == SAFE_EXECUTE_ERR) {
            uint8 operation;
            (target, value, data, operation) = abi.decode(callData[4:], (address, uint256, bytes, uint8));
            if (operation != 0) return false; // CALL only, never DELEGATECALL
        } else if (selector == EXECUTE_7579) {
            bytes32 mode;
            (mode, data) = abi.decode(callData[4:], (bytes32, bytes));
            // Single call, default exec type; execution data is abi.encodePacked(target, value, callData)
            if (mode != bytes32(0) || data.length < 52) return false;
            assembly {
                target := shr(96, mload(add(data, 32)))
                value := mload(add(data, 52))
            }
            start = 52;
        } else {
            return false;
        }

        if (target != address(wif) || value != 0 || data.length - start != 68) return false;
        bytes32 head;
        uint256 spenderWord;
        uint256 amount;
        assembly {
            let inner := add(add(data, 32), start)
            head := mload(inner)
            spenderWord := mload(add(inner, 4))
            amount := mload(add(inner, 36))
        }
        return bytes4(head) == IERC20.approve.selector && spenderWord == uint256(uint160(address(this)))
            && amount >= minAmount;
    }

    function _tryPullWif(address from, uint256 amount) internal returns (bool) {
        (bool ok, bytes memory ret) =
            address(wif).call(abi.encodeCall(IERC20.transferFrom, (from, address(this), amount)));
        return ok && (ret.length == 0 || (ret.length == 32 && abi.decode(ret, (bool))));
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

    function setAccountDailyLimitWei(uint256 _limit) external onlyOwner {
        accountDailyLimitWei = _limit;
        emit ConfigUpdated("accountDailyLimitWei", _limit);
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

    /// @notice Starts a two-step transfer (e.g. to a Safe); the new owner must call acceptOwnership.
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert OnlyOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    // Allow owner to deposit ETH into EntryPoint for gas sponsorship (EntryPoint.depositTo also works for anyone)
    function depositToEntryPoint() external payable onlyOwner {
        entryPoint.depositTo{value: msg.value}(address(this));
    }

    // Allow owner to withdraw unused ETH from EntryPoint
    function withdrawFromEntryPoint(address payable to, uint256 amount) external onlyOwner {
        entryPoint.withdrawTo(to, amount);
    }

    // Emergency: withdraw stray WIF, never the shares owed to the burn or the treasury
    function rescueWif(address to, uint256 amount) external onlyOwner {
        if (amount + pendingBurn + pendingTreasury > wif.balanceOf(address(this))) revert AmountReserved();
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

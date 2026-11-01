// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {WIFPaymaster} from "../src/WIFPaymaster.sol";
import {BoundedRateProvider} from "../src/BoundedRateProvider.sol";
import {MockWIF} from "../src/mocks/MockWIF.sol";
import {IRateProvider} from "../src/interfaces/IRateProvider.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {IPaymaster} from "account-abstraction/interfaces/IPaymaster.sol";
import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockEntryPoint {
    mapping(address => uint256) public balanceOf;

    function depositTo(address account) external payable {
        balanceOf[account] += msg.value;
    }

    function withdrawTo(address payable to, uint256 amount) external {
        balanceOf[msg.sender] -= amount;
        (bool ok,) = to.call{value: amount}("");
        require(ok);
    }

    function addStake(uint32) external payable {}
    function unlockStake() external {}
    function withdrawStake(address payable) external {}
}

contract WIFPaymasterTest is Test {
    WIFPaymaster paymaster;
    BoundedRateProvider rateProvider;
    MockWIF wif;
    MockEntryPoint entryPoint;

    address user = makeAddr("user");
    address treasury = makeAddr("treasury");

    uint256 constant WIF_PER_ETH = 1_000_000 ether;

    function setUp() public {
        entryPoint = new MockEntryPoint();
        wif = new MockWIF(10_000_000 ether);
        rateProvider = new BoundedRateProvider(
            WIF_PER_ETH,
            100_000 ether,
            10_000_000 ether
        );

        paymaster = new WIFPaymaster(
            IEntryPoint(address(entryPoint)),
            IERC20(address(wif)),
            rateProvider,
            treasury
        );

        vm.deal(address(this), 10 ether);
        paymaster.depositToEntryPoint{value: 5 ether}();

        wif.transfer(user, 100_000 ether);
        vm.prank(user);
        wif.approve(address(paymaster), type(uint256).max);
    }

    function _userOp(address sender) internal pure returns (PackedUserOperation memory userOp) {
        userOp.sender = sender;
    }

    function _wifFor(uint256 ethAmount) internal pure returns (uint256) {
        return (ethAmount * WIF_PER_ETH * 11_500) / (1e18 * 10_000);
    }

    function _validate(uint256 maxCost) internal returns (bytes memory context, uint256 validationData) {
        vm.prank(address(entryPoint));
        return paymaster.validatePaymasterUserOp(_userOp(user), keccak256("test-hash"), maxCost);
    }

    function test_ValidatePullsPrefundAndReturnsExpiry() public {
        uint256 maxCost = 0.01 ether;
        uint256 before = wif.balanceOf(user);

        (, uint256 validationData) = _validate(maxCost);

        uint48 validUntil = uint48(validationData >> 160);
        assertEq(uint160(validationData), 0, "no sig failure, no aggregator");
        assertEq(validUntil, rateProvider.lastUpdateTimestamp() + rateProvider.MAX_UPDATE_AGE());
        assertEq(wif.balanceOf(address(paymaster)), _wifFor(maxCost));
        assertEq(before - wif.balanceOf(user), _wifFor(maxCost));
    }

    function test_PostOpChargesActualCostAndRefunds() public {
        uint256 maxCost = 0.01 ether;
        uint256 actualGasCost = 0.002 ether;
        uint256 feePerGas = 1 gwei;
        uint256 before = wif.balanceOf(user);

        (bytes memory context,) = _validate(maxCost);
        vm.prank(address(entryPoint));
        paymaster.postOp(IPaymaster.PostOpMode.opSucceeded, context, actualGasCost, feePerGas);

        uint256 ethCost = actualGasCost + paymaster.postOpGasOverhead() * feePerGas;
        uint256 charged = _wifFor(ethCost);
        uint256 burned = (charged * 3000) / 10_000;

        assertEq(before - wif.balanceOf(user), charged, "user pays actual cost only");
        assertEq(paymaster.pendingBurn(), burned);
        assertEq(paymaster.pendingTreasury(), charged - burned);
        assertEq(wif.balanceOf(address(paymaster)), charged, "only the fee stays, until flushed");
        (uint128 spent,) = paymaster.daily();
        assertEq(spent, ethCost);
        (uint128 accountSpent,) = paymaster.accountWindow(user);
        assertEq(accountSpent, ethCost);
        (uint64 ops, uint96 totalCharged, uint96 totalBurned) = paymaster.totals();
        assertEq(ops, 1);
        assertEq(totalCharged, charged);
        assertEq(totalBurned, burned);
    }

    function test_PostOpChargesRevertedOps() public {
        uint256 before = wif.balanceOf(user);

        (bytes memory context,) = _validate(0.01 ether);
        vm.prank(address(entryPoint));
        paymaster.postOp(IPaymaster.PostOpMode.opReverted, context, 0.002 ether, 1 gwei);

        assertGt(before - wif.balanceOf(user), 0, "reverted ops still pay");
        assertGt(paymaster.pendingTreasury(), 0);
    }

    function test_PostOpChargeCappedAtPrefund() public {
        uint256 maxCost = 0.01 ether;
        uint256 before = wif.balanceOf(user);

        (bytes memory context,) = _validate(maxCost);
        vm.prank(address(entryPoint));
        paymaster.postOp(IPaymaster.PostOpMode.opSucceeded, context, maxCost, 1 gwei);

        assertEq(before - wif.balanceOf(user), _wifFor(maxCost));
    }

    function test_PostOpUsesValidatedRateAfterRateChange() public {
        (bytes memory context,) = _validate(0.01 ether);
        rateProvider.setRate(WIF_PER_ETH * 2);
        uint256 before = wif.balanceOf(user);

        vm.prank(address(entryPoint));
        paymaster.postOp(IPaymaster.PostOpMode.opSucceeded, context, 0.002 ether, 0);

        uint256 refund = wif.balanceOf(user) - before;
        assertEq(refund, _wifFor(0.01 ether) - _wifFor(0.002 ether));
    }

    function test_UserSignedWifLimit() public {
        uint256 maxCost = 0.01 ether;
        PackedUserOperation memory userOp = _userOp(user);

        userOp.paymasterAndData = abi.encodePacked(address(paymaster), uint128(0), uint128(0), _wifFor(maxCost) - 1);
        vm.prank(address(entryPoint));
        vm.expectRevert(WIFPaymaster.WifCostAboveUserLimit.selector);
        paymaster.validatePaymasterUserOp(userOp, bytes32(0), maxCost);

        userOp.paymasterAndData = abi.encodePacked(address(paymaster), uint128(0), uint128(0), _wifFor(maxCost));
        vm.prank(address(entryPoint));
        paymaster.validatePaymasterUserOp(userOp, bytes32(0), maxCost);
    }

    function test_RevertWhenExceedsMaxGasCost() public {
        vm.prank(address(entryPoint));
        vm.expectRevert(WIFPaymaster.ExceedsMaxGasCost.selector);
        paymaster.validatePaymasterUserOp(_userOp(user), bytes32(0), 0.03 ether);
    }

    function test_RevertWhenInsufficientWif() public {
        vm.prank(address(entryPoint));
        vm.expectRevert(WIFPaymaster.InsufficientWifBalance.selector);
        paymaster.validatePaymasterUserOp(_userOp(makeAddr("poor")), bytes32(0), 0.01 ether);
    }

    function test_RevertWhenInsufficientAllowance() public {
        vm.prank(user);
        wif.approve(address(paymaster), 0);

        vm.prank(address(entryPoint));
        vm.expectRevert(WIFPaymaster.InsufficientWifAllowance.selector);
        paymaster.validatePaymasterUserOp(_userOp(user), bytes32(0), 0.01 ether);
    }

    function _approveCall(address spender, uint256 amount) internal view returns (bytes memory) {
        return abi.encodeWithSelector(
            bytes4(0xb61d27f6), address(wif), uint256(0), abi.encodeCall(IERC20.approve, (spender, amount))
        );
    }

    function test_SetupOpChargedInPostOp() public {
        address fresh = makeAddr("fresh");
        wif.transfer(fresh, 50_000 ether);
        PackedUserOperation memory userOp = _userOp(fresh);
        userOp.callData = _approveCall(address(paymaster), type(uint256).max);

        vm.prank(address(entryPoint));
        (bytes memory context,) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0.01 ether);
        assertEq(wif.balanceOf(fresh), 50_000 ether, "nothing pulled before the approve runs");
        assertTrue(paymaster.setupUsed(fresh));

        vm.prank(fresh); // what execute() does
        wif.approve(address(paymaster), type(uint256).max);
        vm.prank(address(entryPoint));
        paymaster.postOp(IPaymaster.PostOpMode.opSucceeded, context, 0.002 ether, 0);

        assertEq(50_000 ether - wif.balanceOf(fresh), _wifFor(0.002 ether));
        assertEq(wif.balanceOf(address(paymaster)), _wifFor(0.002 ether), "fee held until flush");
    }

    function test_SetupOpOnlyOnce() public {
        address fresh = makeAddr("fresh");
        wif.transfer(fresh, 50_000 ether);
        PackedUserOperation memory userOp = _userOp(fresh);
        userOp.callData = _approveCall(address(paymaster), type(uint256).max);

        vm.startPrank(address(entryPoint));
        paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0.01 ether);
        vm.expectRevert(WIFPaymaster.InsufficientWifAllowance.selector);
        paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0.01 ether);
        vm.stopPrank();
    }

    function test_SetupOpRejectsOtherCalls() public {
        address fresh = makeAddr("fresh");
        wif.transfer(fresh, 50_000 ether);
        PackedUserOperation memory userOp = _userOp(fresh);
        bytes[3] memory bad = [
            _approveCall(makeAddr("other"), type(uint256).max), // approves someone else
            _approveCall(address(paymaster), 1), // approves less than the fee
            abi.encodeWithSelector(bytes4(0xb61d27f6), address(wif), uint256(0), abi.encodeCall(IERC20.transfer, (address(paymaster), 1)))
        ];
        for (uint256 i; i < bad.length; i++) {
            userOp.callData = bad[i];
            vm.prank(address(entryPoint));
            vm.expectRevert(WIFPaymaster.InsufficientWifAllowance.selector);
            paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0.01 ether);
        }
    }

    function test_SetupFeeUnpaidNeverReverts() public {
        address fresh = makeAddr("fresh");
        wif.transfer(fresh, 50_000 ether);
        PackedUserOperation memory userOp = _userOp(fresh);
        userOp.callData = _approveCall(address(paymaster), type(uint256).max);

        vm.prank(address(entryPoint));
        (bytes memory context,) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0.01 ether);

        // The approve never happened (reverted op or an account that ignores execute)
        uint256 ethCost = 0.002 ether + paymaster.postOpGasOverhead();
        vm.expectEmit(true, true, false, true);
        emit WIFPaymaster.SetupFeeUnpaid(fresh, bytes32(0), ethCost);
        vm.prank(address(entryPoint));
        paymaster.postOp(IPaymaster.PostOpMode.opReverted, context, 0.002 ether, 1);
        assertEq(wif.balanceOf(fresh), 50_000 ether);
    }

    function _freshAccount() internal returns (address fresh) {
        fresh = makeAddr("fresh");
        wif.transfer(fresh, 50_000 ether);
    }

    function _validateSetup(address sender, bytes memory callData) internal returns (bool ok) {
        PackedUserOperation memory userOp = _userOp(sender);
        userOp.callData = callData;
        vm.prank(address(entryPoint));
        try paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0.01 ether) {
            ok = true;
        } catch {}
    }

    function _approveData() internal view returns (bytes memory) {
        return abi.encodeCall(IERC20.approve, (address(paymaster), type(uint256).max));
    }

    function test_SetupOpSafe4337Module() public {
        bytes memory call = abi.encodeWithSelector(bytes4(0x7bb37428), address(wif), uint256(0), _approveData(), uint8(0));
        assertTrue(_validateSetup(_freshAccount(), call));
    }

    function test_SetupOpSafeRejectsDelegatecall() public {
        bytes memory call = abi.encodeWithSelector(bytes4(0x7bb37428), address(wif), uint256(0), _approveData(), uint8(1));
        assertFalse(_validateSetup(_freshAccount(), call));
    }

    function test_SetupOpErc7579SingleCall() public {
        bytes memory execution = abi.encodePacked(address(wif), uint256(0), _approveData());
        bytes memory call = abi.encodeWithSelector(bytes4(0xe9ae5c53), bytes32(0), execution);
        assertTrue(_validateSetup(_freshAccount(), call));
    }

    function test_SetupOpErc7579RejectsBatchMode() public {
        bytes memory execution = abi.encodePacked(address(wif), uint256(0), _approveData());
        bytes memory call = abi.encodeWithSelector(bytes4(0xe9ae5c53), bytes32(uint256(1) << 248), execution);
        assertFalse(_validateSetup(_freshAccount(), call));
    }

    function test_SetupOpRejectsOtherTargetOrValue() public {
        address fresh = _freshAccount();
        assertFalse(_validateSetup(fresh, abi.encodeWithSelector(bytes4(0xb61d27f6), makeAddr("x"), uint256(0), _approveData())));
        assertFalse(_validateSetup(fresh, abi.encodeWithSelector(bytes4(0xb61d27f6), address(wif), uint256(1), _approveData())));
        assertFalse(_validateSetup(fresh, abi.encodeWithSelector(bytes4(0x34fcd5be), address(wif), uint256(0), _approveData())));
    }

    function testFuzz_ChargeBoundedAndNoWifLeaks(uint256 maxCost, uint256 actualGasCost, uint256 feePerGas, bool reverted)
        public
    {
        maxCost = bound(maxCost, 1, 0.02 ether);
        actualGasCost = bound(actualGasCost, 0, 1 ether);
        feePerGas = bound(feePerGas, 0, 1000 gwei);
        uint256 before = wif.balanceOf(user);

        (bytes memory context,) = _validate(maxCost);
        vm.prank(address(entryPoint));
        paymaster.postOp(
            reverted ? IPaymaster.PostOpMode.opReverted : IPaymaster.PostOpMode.opSucceeded, context, actualGasCost, feePerGas
        );

        assertLe(before - wif.balanceOf(user), _wifFor(maxCost), "never more than the prefund");
        assertEq(
            wif.balanceOf(address(paymaster)), paymaster.pendingBurn() + paymaster.pendingTreasury(), "holds only what it owes"
        );
    }

    function testFuzz_RandomCallDataIsNeverASetupOp(bytes calldata callData) public {
        assertFalse(_validateSetup(_freshAccount(), callData));
    }

    function test_RevertWhenProviderPaused() public {
        rateProvider.setPaused(true);

        vm.prank(address(entryPoint));
        vm.expectRevert(BoundedRateProvider.ProviderPaused.selector);
        paymaster.validatePaymasterUserOp(_userOp(user), bytes32(0), 0.01 ether);
    }

    function test_OnlyEntryPointCanCall() public {
        vm.expectRevert(WIFPaymaster.OnlyEntryPoint.selector);
        paymaster.validatePaymasterUserOp(_userOp(user), bytes32(0), 0.01 ether);

        vm.expectRevert(WIFPaymaster.OnlyEntryPoint.selector);
        paymaster.postOp(IPaymaster.PostOpMode.opSucceeded, "", 0, 0);
    }

    function _spend(address sender, uint256 cost) internal {
        vm.prank(address(entryPoint));
        (bytes memory context,) = paymaster.validatePaymasterUserOp(_userOp(sender), bytes32(0), cost);
        vm.prank(address(entryPoint));
        paymaster.postOp(IPaymaster.PostOpMode.opSucceeded, context, cost, 0);
    }

    function _validAfter(uint256 validationData) internal pure returns (uint48) {
        return uint48(validationData >> 208);
    }

    function test_FullDailyWindowSetsValidAfter() public {
        paymaster.setDailyLimitWei(0.015 ether);
        _spend(user, 0.01 ether);
        (, uint64 start) = paymaster.daily();

        // Full: valid only once the window ends, enforced by the EntryPoint (no timestamp read here)
        (, uint256 validationData) = _validate(0.01 ether);
        assertEq(_validAfter(validationData), start + 1 days);

        // After the window, postOp opens a new one
        vm.warp(block.timestamp + 1 days);
        rateProvider.setRate(WIF_PER_ETH);
        _spend(user, 0.001 ether);
        (uint128 spent, uint64 newStart) = paymaster.daily();
        assertEq(newStart, block.timestamp);
        assertEq(spent, 0.001 ether);
    }

    function test_AccountDailyLimitIsPerSender() public {
        paymaster.setAccountDailyLimitWei(0.015 ether);
        _spend(user, 0.01 ether);
        (, uint64 start) = paymaster.accountWindow(user);

        (, uint256 full) = _validate(0.01 ether);
        assertEq(_validAfter(full), start + 1 days, "this sender is capped");

        address other = makeAddr("other");
        wif.transfer(other, 50_000 ether);
        vm.prank(other);
        wif.approve(address(paymaster), type(uint256).max);
        vm.prank(address(entryPoint));
        (, uint256 fresh) = paymaster.validatePaymasterUserOp(_userOp(other), bytes32(0), 0.01 ether);
        assertEq(_validAfter(fresh), 0, "others are not");
    }

    function test_RevertWhenSingleOpAboveDailyLimits() public {
        paymaster.setAccountDailyLimitWei(0.005 ether);
        vm.prank(address(entryPoint));
        vm.expectRevert(WIFPaymaster.DailyLimitExceeded.selector);
        paymaster.validatePaymasterUserOp(_userOp(user), bytes32(0), 0.01 ether);
    }

    function test_FlushBurnsSupplyAndPaysTreasury() public {
        _spend(user, 0.01 ether);
        uint256 burn = paymaster.pendingBurn();
        uint256 toTreasury = paymaster.pendingTreasury();
        uint256 supply = wif.totalSupply();

        vm.prank(makeAddr("anyone"));
        paymaster.flush();

        assertEq(wif.totalSupply(), supply - burn, "real burn");
        assertEq(wif.balanceOf(treasury), toTreasury);
        assertEq(wif.balanceOf(address(paymaster)), 0);
        assertEq(paymaster.pendingBurn(), 0);
        assertEq(paymaster.pendingTreasury(), 0);
    }

    function test_FlushFallsBackToDeadAddress() public {
        NoBurnWIF token = new NoBurnWIF(10_000_000 ether);
        WIFPaymaster pm = new WIFPaymaster(IEntryPoint(address(entryPoint)), IERC20(address(token)), rateProvider, treasury);
        token.transfer(user, 100_000 ether);
        vm.prank(user);
        token.approve(address(pm), type(uint256).max);

        vm.prank(address(entryPoint));
        (bytes memory context,) = pm.validatePaymasterUserOp(_userOp(user), bytes32(0), 0.01 ether);
        vm.prank(address(entryPoint));
        pm.postOp(IPaymaster.PostOpMode.opSucceeded, context, 0.01 ether, 0);
        uint256 burn = pm.pendingBurn();

        pm.flush();
        assertEq(token.balanceOf(address(0xdead)), burn);
    }

    function test_RescueCannotTakeReservedWif() public {
        _spend(user, 0.01 ether);
        vm.expectRevert(WIFPaymaster.AmountReserved.selector);
        paymaster.rescueWif(address(this), 1);

        wif.transfer(address(paymaster), 5 ether); // stray
        paymaster.rescueWif(address(this), 5 ether);
    }

    function test_TwoStepOwnership() public {
        address safe = makeAddr("safe");
        paymaster.transferOwnership(safe);
        assertEq(paymaster.owner(), address(this), "not yet");

        vm.expectRevert(WIFPaymaster.OnlyOwner.selector);
        paymaster.acceptOwnership();

        vm.prank(safe);
        paymaster.acceptOwnership();
        assertEq(paymaster.owner(), safe);
        assertEq(paymaster.pendingOwner(), address(0));
    }

    function test_KeeperCanRefreshRate() public {
        address keeper = makeAddr("keeper");

        vm.prank(keeper);
        vm.expectRevert(BoundedRateProvider.NotOwnerOrKeeper.selector);
        rateProvider.setRate(WIF_PER_ETH * 2);

        rateProvider.setKeeper(keeper);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(keeper);
        rateProvider.setRate((WIF_PER_ETH * 11) / 10);

        (uint256 rate, uint48 validUntil) = rateProvider.quote();
        assertEq(rate, (WIF_PER_ETH * 11) / 10);
        assertEq(validUntil, block.timestamp + rateProvider.MAX_UPDATE_AGE());
    }

    function test_KeeperIsRateLimited() public {
        address keeper = makeAddr("keeper");
        rateProvider.setKeeper(keeper);
        vm.warp(block.timestamp + 1 hours);

        vm.prank(keeper);
        vm.expectRevert(BoundedRateProvider.KeeperChangeTooLarge.selector);
        rateProvider.setRate((WIF_PER_ETH * 13) / 10); // +30%

        vm.prank(keeper);
        rateProvider.setRate((WIF_PER_ETH * 12) / 10); // +20% is the limit

        vm.prank(keeper);
        vm.expectRevert(BoundedRateProvider.KeeperTooSoon.selector);
        rateProvider.setRate((WIF_PER_ETH * 12) / 10);

        // The owner is not limited
        rateProvider.setRate(WIF_PER_ETH * 3);
        assertEq(rateProvider.wifPerEth(), WIF_PER_ETH * 3);
    }

    function test_OnlyOwnerAdmin() public {
        vm.startPrank(user);
        vm.expectRevert(WIFPaymaster.OnlyOwner.selector);
        paymaster.setPremiumBps(0);
        vm.expectRevert(WIFPaymaster.OnlyOwner.selector);
        paymaster.setRateProvider(IRateProvider(address(1)));
        vm.expectRevert(BoundedRateProvider.NotOwner.selector);
        rateProvider.setKeeper(user);
        vm.stopPrank();
    }
}

/// @dev A token without burn(), to test the flush fallback
contract NoBurnWIF {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(uint256 supply) {
        balanceOf[msg.sender] = supply;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (allowance[from][msg.sender] != type(uint256).max) allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

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
        assertEq(wif.balanceOf(address(0xdead)), burned);
        assertEq(wif.balanceOf(treasury), charged - burned);
        assertEq(wif.balanceOf(address(paymaster)), 0, "no WIF left behind");
        assertEq(paymaster.dailySpentWei(), ethCost);
    }

    function test_PostOpChargesRevertedOps() public {
        uint256 before = wif.balanceOf(user);

        (bytes memory context,) = _validate(0.01 ether);
        vm.prank(address(entryPoint));
        paymaster.postOp(IPaymaster.PostOpMode.opReverted, context, 0.002 ether, 1 gwei);

        assertGt(before - wif.balanceOf(user), 0, "reverted ops still pay");
        assertGt(wif.balanceOf(treasury), 0);
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

    function test_DailyLimitBlocksUntilWindowRolls() public {
        paymaster.setDailyLimitWei(0.015 ether);

        (bytes memory context,) = _validate(0.01 ether);
        vm.prank(address(entryPoint));
        paymaster.postOp(IPaymaster.PostOpMode.opSucceeded, context, 0.01 ether, 0);

        vm.prank(address(entryPoint));
        vm.expectRevert(WIFPaymaster.DailyLimitExceeded.selector);
        paymaster.validatePaymasterUserOp(_userOp(user), bytes32(0), 0.01 ether);

        vm.warp(block.timestamp + 1 days);
        rateProvider.setRate(WIF_PER_ETH);
        paymaster.rollDailyWindow();
        assertEq(paymaster.dailySpentWei(), 0);
        _validate(0.01 ether);
    }

    function test_KeeperCanRefreshRate() public {
        address keeper = makeAddr("keeper");

        vm.prank(keeper);
        vm.expectRevert(BoundedRateProvider.NotOwnerOrKeeper.selector);
        rateProvider.setRate(WIF_PER_ETH * 2);

        rateProvider.setKeeper(keeper);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(keeper);
        rateProvider.setRate(WIF_PER_ETH * 2);

        (uint256 rate, uint48 validUntil) = rateProvider.quote();
        assertEq(rate, WIF_PER_ETH * 2);
        assertEq(validUntil, block.timestamp + rateProvider.MAX_UPDATE_AGE());
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

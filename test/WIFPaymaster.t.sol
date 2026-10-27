// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {WIFPaymaster} from "../src/WIFPaymaster.sol";
import {BoundedRateProvider} from "../src/BoundedRateProvider.sol";
import {MockWIF} from "../src/mocks/MockWIF.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {IPaymaster} from "account-abstraction/interfaces/IPaymaster.sol";
import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";

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

    function test_ValidateAndCharge() public {
        uint256 maxCost = 0.01 ether;

        PackedUserOperation memory userOp;
        userOp.sender = user;

        bytes32 userOpHash = keccak256("test-hash");

        vm.prank(address(entryPoint));
        (bytes memory context, uint256 validationData) =
            paymaster.validatePaymasterUserOp(userOp, userOpHash, maxCost);

        assertEq(validationData, 0);

        vm.prank(address(entryPoint));
        paymaster.postOp(
            IPaymaster.PostOpMode.opSucceeded,
            context,
            maxCost,
            0
        );

        uint256 expectedBase = (maxCost * WIF_PER_ETH) / 1e18;
        uint256 expectedWithPremium = (expectedBase * 11500) / 10000;
        uint256 expectedBurn = (expectedWithPremium * 3000) / 10000;

        assertEq(wif.balanceOf(address(0xdead)), expectedBurn);
        assertGt(wif.balanceOf(treasury), 0);
    }

    function test_RevertWhenExceedsMaxGasCost() public {
        PackedUserOperation memory userOp;
        userOp.sender = user;

        vm.prank(address(entryPoint));
        vm.expectRevert(WIFPaymaster.ExceedsMaxGasCost.selector);
        paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0.03 ether);
    }

    function test_RevertWhenInsufficientWif() public {
        address poorUser = makeAddr("poor");
        PackedUserOperation memory userOp;
        userOp.sender = poorUser;

        vm.prank(address(entryPoint));
        vm.expectRevert(WIFPaymaster.InsufficientWifBalance.selector);
        paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0.01 ether);
    }
}

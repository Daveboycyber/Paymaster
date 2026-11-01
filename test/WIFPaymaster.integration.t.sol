// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {WIFPaymaster} from "../src/WIFPaymaster.sol";
import {BoundedRateProvider} from "../src/BoundedRateProvider.sol";
import {MockWIF} from "../src/mocks/MockWIF.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";
import {SimpleAccount} from "account-abstraction/samples/SimpleAccount.sol";
import {SimpleAccountFactory} from "account-abstraction/samples/SimpleAccountFactory.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @notice End-to-end against the real EntryPoint v0.7 and a SimpleAccount that holds zero ETH.
contract WIFPaymasterIntegrationTest is Test {
    EntryPoint entryPoint;
    WIFPaymaster paymaster;
    BoundedRateProvider rateProvider;
    MockWIF wif;
    SimpleAccount account;
    SimpleAccountFactory factory;

    address owner;
    uint256 ownerKey;
    address bundler = makeAddr("bundler");
    address treasury = makeAddr("treasury");
    address voteAddress = makeAddr("vote");

    uint256 constant WIF_PER_ETH = 1_000_000 ether;
    uint256 constant GAS_PRICE = 1 gwei;

    function setUp() public {
        (owner, ownerKey) = makeAddrAndKey("owner");

        entryPoint = new EntryPoint();
        wif = new MockWIF(10_000_000 ether);
        rateProvider = new BoundedRateProvider(WIF_PER_ETH, 100_000 ether, 10_000_000 ether);
        paymaster = new WIFPaymaster(IEntryPoint(address(entryPoint)), IERC20(address(wif)), rateProvider, treasury);

        vm.deal(address(this), 10 ether);
        paymaster.depositToEntryPoint{value: 1 ether}();
        paymaster.addStake{value: 1 ether}(1 days);

        factory = new SimpleAccountFactory(IEntryPoint(address(entryPoint)));
        account = factory.createAccount(owner, 0);
        wif.transfer(address(account), 10_000 ether);

        // One-time approval (in production: a sponsored first op or a batched setup)
        vm.prank(address(account));
        wif.approve(address(paymaster), type(uint256).max);

        vm.fee(GAS_PRICE);
    }

    function _op(bytes memory callData, bytes memory pmExtra) internal view returns (PackedUserOperation memory op) {
        op.sender = address(account);
        op.nonce = entryPoint.getNonce(address(account), 0);
        op.callData = callData;
        op.accountGasLimits = bytes32((uint256(150_000) << 128) | 200_000);
        op.preVerificationGas = 50_000;
        op.gasFees = bytes32((GAS_PRICE << 128) | GAS_PRICE);
        op.paymasterAndData = abi.encodePacked(address(paymaster), uint128(100_000), uint128(150_000), pmExtra);
        bytes32 hash = MessageHashUtils.toEthSignedMessageHash(entryPoint.getUserOpHash(op));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, hash);
        op.signature = abi.encodePacked(r, s, v);
    }

    function _execute(address target, bytes memory data) internal pure returns (bytes memory) {
        return abi.encodeCall(SimpleAccount.execute, (target, 0, data));
    }

    function _handle(PackedUserOperation memory op) internal {
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        vm.prank(bundler, bundler);
        entryPoint.handleOps(ops, payable(bundler));
    }

    function test_VoteWithZeroEth() public {
        uint256 wifBefore = wif.balanceOf(address(account));
        uint256 depositBefore = entryPoint.balanceOf(address(paymaster));

        _handle(_op(_execute(address(wif), abi.encodeCall(IERC20.transfer, (voteAddress, 1 ether))), ""));

        uint256 fee = wifBefore - wif.balanceOf(address(account)) - 1 ether;
        assertEq(address(account).balance, 0, "account never held ETH");
        assertEq(wif.balanceOf(voteAddress), 1 ether, "vote landed");
        assertGt(fee, 0, "gas paid in WIF");
        assertEq(wif.balanceOf(address(paymaster)), fee, "refund settled, fee held until flush");

        uint256 supply = wif.totalSupply();
        paymaster.flush();
        assertEq(supply - wif.totalSupply(), (fee * 3000) / 10_000, "30% burned from supply");
        assertEq(wif.balanceOf(treasury), fee - (fee * 3000) / 10_000);
        assertEq(wif.balanceOf(address(paymaster)), 0);
        assertLt(entryPoint.balanceOf(address(paymaster)), depositBefore, "paymaster paid ETH gas");
    }

    function test_FeeCoversEthSpent() public {
        uint256 wifBefore = wif.balanceOf(address(account));
        uint256 depositBefore = entryPoint.balanceOf(address(paymaster));

        _handle(_op(_execute(address(wif), abi.encodeCall(IERC20.transfer, (voteAddress, 1 ether))), ""));

        uint256 fee = wifBefore - wif.balanceOf(address(account)) - 1 ether;
        uint256 ethSpent = depositBefore - entryPoint.balanceOf(address(paymaster));
        // Without the premium, the WIF taken must still be worth at least the ETH the paymaster paid
        assertGe((fee * 10_000) / 11_500, (ethSpent * WIF_PER_ETH) / 1e18, "postOp overhead covers real cost");
    }

    function test_RevertedOpStillPays() public {
        uint256 wifBefore = wif.balanceOf(address(account));

        // Transfer more WIF than the account has, so execution reverts
        _handle(_op(_execute(address(wif), abi.encodeCall(IERC20.transfer, (voteAddress, 1_000_000 ether))), ""));

        assertGt(wifBefore - wif.balanceOf(address(account)), 0, "failed op still charged");
        assertEq(wif.balanceOf(voteAddress), 0);
        assertEq(wif.balanceOf(address(paymaster)), wifBefore - wif.balanceOf(address(account)), "only the fee kept");
    }

    function test_RevokingAllowanceCannotDodgeFee() public {
        uint256 wifBefore = wif.balanceOf(address(account));

        _handle(_op(_execute(address(wif), abi.encodeCall(IERC20.approve, (address(paymaster), 0))), ""));

        assertEq(wif.allowance(address(account), address(paymaster)), 0, "allowance revoked");
        assertGt(wifBefore - wif.balanceOf(address(account)), 0, "fee collected anyway");
        assertGt(paymaster.pendingTreasury(), 0);
    }

    function test_NewAccountOnboardsWithZeroEth() public {
        // A brand-new account: not deployed, never approved anything, holds only WIF
        (address newOwner, uint256 newKey) = makeAddrAndKey("newOwner");
        address sender = factory.getAddress(newOwner, 0);
        wif.transfer(sender, 5_000 ether);

        PackedUserOperation memory op;
        op.sender = sender;
        op.initCode = abi.encodePacked(address(factory), abi.encodeCall(SimpleAccountFactory.createAccount, (newOwner, 0)));
        op.callData = _execute(address(wif), abi.encodeCall(IERC20.approve, (address(paymaster), type(uint256).max)));
        op.accountGasLimits = bytes32((uint256(400_000) << 128) | 100_000);
        op.preVerificationGas = 50_000;
        op.gasFees = bytes32((GAS_PRICE << 128) | GAS_PRICE);
        op.paymasterAndData = abi.encodePacked(address(paymaster), uint128(100_000), uint128(150_000));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(newKey, MessageHashUtils.toEthSignedMessageHash(entryPoint.getUserOpHash(op)));
        op.signature = abi.encodePacked(r, s, v);
        _handle(op);

        assertGt(sender.code.length, 0, "account deployed");
        assertEq(sender.balance, 0, "never held ETH");
        assertEq(wif.allowance(sender, address(paymaster)), type(uint256).max, "approved for later ops");
        assertGt(5_000 ether - wif.balanceOf(sender), 0, "setup fee paid in WIF");
        assertTrue(paymaster.setupUsed(sender));
    }

    function test_StaleRateRejectedByEntryPoint() public {
        vm.warp(block.timestamp + rateProvider.MAX_UPDATE_AGE() + 1);
        PackedUserOperation memory op = _op(_execute(voteAddress, ""), "");

        vm.expectRevert(abi.encodeWithSelector(IEntryPoint.FailedOp.selector, 0, "AA32 paymaster expired or not due"));
        _handle(op);
    }

    function test_UserWifLimitEnforced() public {
        PackedUserOperation memory op = _op(_execute(voteAddress, ""), abi.encode(uint256(1)));

        vm.expectRevert();
        _handle(op);
    }
}

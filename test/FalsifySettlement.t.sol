// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {FalsifySettlement} from "../src/FalsifySettlement.sol";
import {MockERC8004Identity} from "../src/mocks/ERC8004Mock.sol";
import {MockERC8004Reputation} from "../src/mocks/ERC8004Mock.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

contract FalsifySettlementTest is Test {
    FalsifySettlement settlement;
    MockERC8004Identity identity;
    MockERC8004Reputation reputation;
    MockUSDC usdc;

    address validator = makeAddr("validator");
    address platform = makeAddr("platform");
    address customer = makeAddr("customer");
    address agent = makeAddr("agent");

    uint256 agentId;

    function setUp() public {
        identity = new MockERC8004Identity();
        reputation = new MockERC8004Reputation();
        usdc = new MockUSDC();
        settlement = new FalsifySettlement(
            validator,
            platform,
            address(identity),
            address(reputation),
            address(usdc)
        );

        // Register the adversary as an ERC-8004 agent and bind its wallet.
        vm.prank(agent);
        agentId = identity.register("ipfs://agent-metadata");
    }

    function _createETH() internal {
        vm.deal(customer, 1 ether);
        vm.startPrank(customer);
        settlement.createAssertion{value: 1 ether}(
            bytes32("assertion"),
            bytes32("test"),
            block.timestamp + 1 days
        );
        vm.stopPrank();
    }

    function _submit(uint256 id, bytes32 cex) internal {
        vm.prank(agent);
        settlement.submitCounterexample(id, cex, agentId);
    }

    function test_valid_counterexample_pays_bounty_and_positive_reputation()
        public
    {
        _createETH();
        _submit(1, bytes32("cex"));

        vm.prank(validator);
        settlement.settle(1, bytes32("cex"), true);

        assertEq(agent.balance, 0.85 ether, "85% payout");
        assertEq(platform.balance, 0.15 ether, "15% fee");
        assertEq(address(settlement).balance, 0, "escrow drained");
        assertEq(
            reputation.positiveCounts(agentId, "validCounterexamples"),
            1,
            "positive reputation written"
        );
    }

    function test_invalid_counterexample_gets_zero_and_negative_reputation()
        public
    {
        _createETH();
        _submit(1, bytes32("cex"));

        uint256 before = agent.balance;
        vm.prank(validator);
        settlement.settle(1, bytes32("cex"), false);

        assertEq(agent.balance, before, "zero payout");
        assertEq(address(settlement).balance, 1 ether, "bounty still held");
        assertEq(
            reputation.negativeCounts(agentId, "falseClaimRate"),
            1,
            "negative reputation written"
        );
    }

    function test_usdc_assertion_settles_via_x402_payment_proof() public {
        uint256 bounty = 100 * 1e6; // 100 USDC (6 decimals)
        usdc.mint(customer, bounty);
        vm.prank(customer);
        usdc.approve(address(settlement), bounty);

        vm.prank(customer);
        settlement.createAssertionUSDC(
            bytes32("assertion"),
            bytes32("test"),
            block.timestamp + 1 days,
            bounty,
            bytes32("x402-proof-hash")
        );

        _submit(1, bytes32("cex"));
        vm.prank(validator);
        settlement.settle(1, bytes32("cex"), true);

        assertEq(usdc.balanceOf(agent), 85 * 1e6, "85% USDC payout");
        assertEq(usdc.balanceOf(platform), 15 * 1e6, "15% USDC fee");
    }

    function test_unregistered_wallet_cannot_submit() public {
        _createETH();
        vm.prank(address(0xBEEF));
        vm.expectRevert("not agent wallet");
        settlement.submitCounterexample(1, bytes32("cex"), agentId);
    }

    function test_counterexample_cannot_settle_twice() public {
        _createETH();
        _submit(1, bytes32("cex"));

        vm.startPrank(validator);
        settlement.settle(1, bytes32("cex"), true);
        vm.expectRevert("closed");
        settlement.settle(1, bytes32("cex"), true);
        vm.stopPrank();
    }

    function test_expired_assertion_refunds() public {
        _createETH();
        vm.warp(block.timestamp + 2 days);

        uint256 before = customer.balance;
        vm.prank(customer);
        settlement.refund(1);

        assertEq(customer.balance, before + 1 ether, "refunded");
        assertEq(address(settlement).balance, 0, "escrow drained");
    }
}

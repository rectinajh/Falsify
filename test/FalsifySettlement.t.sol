// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {FalsifySettlement} from "../src/FalsifySettlement.sol";

contract FalsifySettlementTest is Test {
    FalsifySettlement settlement;

    address validator = makeAddr("validator");
    address platform = makeAddr("platform");
    address customer = makeAddr("customer");
    address agent = makeAddr("agent");

    function setUp() public {
        settlement = new FalsifySettlement(validator, platform);
    }

    function _create() internal {
        vm.deal(customer, 1 ether);
        vm.startPrank(customer);
        settlement.createAssertion{value: 1 ether}(
            bytes32("assertion"),
            bytes32("test"),
            block.timestamp + 1 days
        );
        vm.stopPrank();
    }

    function test_valid_counterexample_pays_bounty() public {
        _create();
        vm.prank(agent);
        settlement.submitCounterexample(1, bytes32("cex"));

        vm.prank(validator);
        settlement.settle(1, bytes32("cex"), agent, true);

        assertEq(agent.balance, 0.85 ether); // 85%
        assertEq(platform.balance, 0.15 ether); // 15% fee
        assertEq(address(settlement).balance, 0);
    }

    function test_invalid_counterexample_gets_zero() public {
        _create();
        vm.prank(agent);
        settlement.submitCounterexample(1, bytes32("cex"));

        uint256 before = agent.balance;
        vm.prank(validator);
        settlement.settle(1, bytes32("cex"), agent, false);

        assertEq(agent.balance, before); // zero payout
        assertEq(address(settlement).balance, 1 ether); // bounty still held
    }

    function test_counterexample_cannot_settle_twice() public {
        _create();
        vm.prank(agent);
        settlement.submitCounterexample(1, bytes32("cex"));

        vm.startPrank(validator);
        settlement.settle(1, bytes32("cex"), agent, true);
        vm.expectRevert("closed");
        settlement.settle(1, bytes32("cex"), agent, true);
        vm.stopPrank();
    }

    function test_expired_assertion_refunds() public {
        _create();
        vm.warp(block.timestamp + 2 days);

        uint256 before = customer.balance;
        vm.prank(customer);
        settlement.refund(1);

        assertEq(customer.balance, before + 1 ether);
        assertEq(address(settlement).balance, 0);
    }
}

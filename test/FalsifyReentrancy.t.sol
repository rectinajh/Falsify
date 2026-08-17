// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Vault} from "../src/Vault.sol";
import {Attack} from "../src/Attack.sol";

/// @notice Falsify property test.
///
/// Assertion: "withdraw() is reentrancy-safe; a depositor can withdraw at most
/// what they deposited."
///
/// Mapping to Falsify:
///   committed_test(no counterexample)      == PASS => NOT_FALSIFIED
///   committed_test(reentrancy counterexample) == FAIL => FALSIFIED
contract FalsifyReentrancyTest is Test {
    receive() external payable {}

    /// Baseline: without an attack, the property holds.
    function test_without_attack_invariant_holds() public {
        Vault vault = new Vault();
        vm.deal(address(this), 1 ether);
        vault.deposit{value: 1 ether}();
        vault.withdraw();

        assertEq(vault.balances(address(this)), 0);
        assertEq(address(vault).balance, 0);
    }

    /// Counterexample: the reentrancy attack falsifies the assertion.
    /// This test is EXPECTED TO FAIL on the vulnerable contract, which is the
    /// exact evidence a Falsify verifier uses to release the bounty.
    function test_reentrancy_counterexample_falsifies_assertion() public {
        Vault vault = new Vault();

        address victim = makeAddr("victim");
        vm.deal(victim, 10 ether);
        vm.startPrank(victim);
        vault.deposit{value: 10 ether}();
        vm.stopPrank();

        Attack attacker = new Attack(vault);
        vm.deal(address(attacker), 1 ether);
        attacker.attack{value: 1 ether}();

        // Property: attacker's net drain must not exceed their own 1 ether deposit.
        // Vulnerable contract: attacker drains ~11 ether, so this assertion fails.
        assertLe(attacker.drained(), 1 ether);
    }
}

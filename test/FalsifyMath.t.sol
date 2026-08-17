// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Math} from "../src/Math.sol";

/// @notice Falsify correctness property test.
/// The counterexample is injected via COUNTEREXAMPLE_A / COUNTEREXAMPLE_B.
contract FalsifyMathTest is Test {
    function test_add_returns_sum() public {
        uint256 a = vm.envOr("COUNTEREXAMPLE_A", uint256(2));
        uint256 b = vm.envOr("COUNTEREXAMPLE_B", uint256(3));
        Math m = new Math();
        assertEq(m.add(a, b), a + b);
    }
}

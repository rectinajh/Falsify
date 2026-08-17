// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Deliberately buggy math contract — the second Falsify demo target.
/// @dev The assertion under test is: "add(a, b) returns a + b for all a, b."
///      The bug returns 0 whenever a == b, which a counterexample falsifies.
contract Math {
    function add(uint256 a, uint256 b) public pure returns (uint256) {
        if (a == b) {
            return 0;
        }
        return a + b;
    }
}

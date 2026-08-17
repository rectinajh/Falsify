// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Deliberately vulnerable vault — the Falsify demo target.
/// @dev The assertion under test is: "withdraw() is safe against reentrancy."
///      The property test in test/FalsifyReentrancy.t.sol encodes this assertion.
contract Vault {
    mapping(address => uint256) public balances;
    uint256 public totalDeposited;

    function deposit() external payable {
        balances[msg.sender] += msg.value;
        totalDeposited += msg.value;
    }

    /// @dev Vulnerable: sends ETH before zeroing the balance (checks-effects-interactions violation).
    function withdraw() external {
        uint256 amount = balances[msg.sender];
        require(amount > 0, "nothing to withdraw");
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "transfer failed");
        balances[msg.sender] = 0;
    }
}

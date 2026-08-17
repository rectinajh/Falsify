// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal ERC-20 interface used by Falsify for USDC bounties.
/// @dev Only the functions the settlement contract needs; full ERC-20 omitted.
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);

    function transferFrom(address from, address to, uint256 amount)
        external
        returns (bool);

    function balanceOf(address account) external view returns (uint256);
}

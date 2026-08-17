// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal ERC-8004 Identity Registry interface (Draft).
/// @dev Full spec: https://eips.ethereum.org/EIPS/eip-8004
interface IERC8004Identity {
    function register(string calldata agentURI) external returns (uint256 agentId);

    function setAgentURI(uint256 agentId, string calldata newURI) external;

    function setAgentWallet(
        uint256 agentId,
        address newWallet,
        uint256 deadline,
        bytes calldata signature
    ) external;

    function getAgentWallet(uint256 agentId) external view returns (address);
}

/// @notice Minimal ERC-8004 Reputation Registry interface (Draft).
/// @dev value is a signed fixed-point int128; valueDecimals is 0..18.
interface IERC8004Reputation {
    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external;
}

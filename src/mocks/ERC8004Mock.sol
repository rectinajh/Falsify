// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    IERC8004Identity,
    IERC8004Reputation
} from "../interfaces/IERC8004.sol";

/// @notice Minimal ERC-8004 Identity Registry mock for local tests.
contract MockERC8004Identity is IERC8004Identity {
    uint256 public nextAgentId;
    mapping(uint256 => address) private wallets;
    mapping(uint256 => string) public uris;

    function register(string calldata agentURI) external returns (uint256 agentId) {
        agentId = ++nextAgentId;
        uris[agentId] = agentURI;
        wallets[agentId] = msg.sender;
    }

    function setAgentURI(uint256 agentId, string calldata newURI) external {
        uris[agentId] = newURI;
    }

    function setAgentWallet(
        uint256 agentId,
        address newWallet,
        uint256,
        bytes calldata
    ) external {
        wallets[agentId] = newWallet;
    }

    function getAgentWallet(uint256 agentId) external view returns (address) {
        return wallets[agentId];
    }
}

/// @notice Minimal ERC-8004 Reputation Registry mock for local tests.
contract MockERC8004Reputation is IERC8004Reputation {
    mapping(uint256 => mapping(string => uint256)) public positiveCounts; // agentId => tag => count
    mapping(uint256 => mapping(string => uint256)) public negativeCounts; // agentId => tag => count

    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8,
        string calldata tag1,
        string calldata,
        string calldata,
        string calldata,
        bytes32
    ) external {
        if (value > 0) {
            positiveCounts[agentId][tag1]++;
        } else if (value < 0) {
            negativeCounts[agentId][tag1]++;
        }
    }
}

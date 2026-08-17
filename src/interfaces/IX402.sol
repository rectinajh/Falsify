// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal x402 (Coinbase AI-to-AI payments, draft) reference types.
/// @dev This is NOT an official standard interface. It mirrors the x402 V2
///      `paymentPayload` shape used by the reference server so the Solidity
///      settlement layer can commit a `proofOfPayment`-derived identifier.
///      Reference: https://docs.cdp.coinbase.com/paymaster/docs/x402-payments
interface IX402 {
    /// @dev The Falsify-specific data carried inside a paymentPayload's
    ///      `extensions` object. Kept as ABI-encoded bytes to stay neutral.
    struct FalsifyExtension {
        bytes32 assertionHash;
        bytes32 testRef;
        uint256 bounty;
        uint256 deadline;
        address payTo; // settlement contract that will custody the escrow
    }

    /// @dev Emitted when an x402-funded assertion is created on-chain.
    event X402AssertionFunded(
        uint256 indexed assertionId,
        bytes32 indexed paymentProofHash,
        address indexed customer
    );
}

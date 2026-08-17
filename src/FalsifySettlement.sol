// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC8004Identity, IERC8004Reputation} from "./interfaces/IERC8004.sol";
import {IERC20} from "./interfaces/IERC20.sol";

/// @notice Falsify settlement contract.
///
/// Customers escrow a bounty behind an assertion + committed property test.
/// Adversary agents (identified by an ERC-8004 agentId) submit counterexamples.
/// The deterministic verifier is represented by an authorized `validator`
/// address; it calls `settle` after running the test:
///   - test FAILS  -> FALSIFIED  -> payout + positive reputation
///   - test PASSES -> NOT_FALSIFIED -> no payout + negative reputation
///
/// Bounties are native ETH (MVP) or USDC (ERC-20). A USDC assertion records an
/// x402 `proofOfPayment`-derived hash so the on-chain escrow is cryptographically
/// linked to the off-chain x402 payment rail.
contract FalsifySettlement {
    struct Assertion {
        bytes32 assertionHash;
        bytes32 testRef;
        address customer;
        uint256 bounty;
        uint256 deadline;
        bool settled;
        bool refunded;
        bool usdc; // bounty currency: false = native ETH, true = USDC
        bytes32 x402PaymentProof; // proofOfPayment-derived id; 0 for native
    }

    uint256 public nextAssertionId;
    mapping(uint256 => Assertion) public assertions;
    mapping(bytes32 => uint256) public counterexampleToAssertion; // replay guard
    mapping(bytes32 => bool) public settledCounterexamples;
    mapping(bytes32 => uint256) public counterexampleAgent; // cexHash => agentId

    address public validator;
    address public platform;
    uint256 public platformFeeBps = 1500; // 15%

    IERC8004Identity public immutable identityRegistry;
    IERC8004Reputation public immutable reputationRegistry;
    IERC20 public immutable usdc;

    event AssertionCreated(
        uint256 indexed assertionId,
        address indexed customer,
        uint256 bounty,
        bool usdc
    );
    event CounterexampleSubmitted(
        uint256 indexed assertionId,
        bytes32 indexed counterexampleHash,
        uint256 indexed agentId,
        address wallet
    );
    event Falsified(
        uint256 indexed assertionId,
        bytes32 indexed counterexampleHash,
        uint256 indexed agentId,
        address wallet,
        uint256 payout
    );
    event Rejected(
        uint256 indexed assertionId,
        bytes32 indexed counterexampleHash,
        uint256 indexed agentId,
        address wallet
    );
    event Refunded(uint256 indexed assertionId, address indexed customer);

    constructor(
        address _validator,
        address _platform,
        address _identityRegistry,
        address _reputationRegistry,
        address _usdc
    ) {
        validator = _validator;
        platform = _platform;
        identityRegistry = IERC8004Identity(_identityRegistry);
        reputationRegistry = IERC8004Reputation(_reputationRegistry);
        usdc = IERC20(_usdc);
    }

    modifier onlyValidator() {
        require(msg.sender == validator, "not validator");
        _;
    }

    /// @notice Escrow a native-ETH bounty.
    function createAssertion(
        bytes32 assertionHash,
        bytes32 testRef,
        uint256 deadline
    ) external payable {
        require(deadline > block.timestamp, "deadline");
        require(msg.value > 0, "no bounty");
        uint256 id = ++nextAssertionId;
        assertions[id] = Assertion(
            assertionHash,
            testRef,
            msg.sender,
            msg.value,
            deadline,
            false,
            false,
            false,
            bytes32(0)
        );
        emit AssertionCreated(id, msg.sender, msg.value, false);
    }

    /// @notice Escrow a USDC bounty funded via the x402 payment rail.
    /// @dev `x402PaymentProof` is the hash of the off-chain proofOfPayment that
    ///      paid `bounty` to this contract. The USDC is pulled via transferFrom.
    function createAssertionUSDC(
        bytes32 assertionHash,
        bytes32 testRef,
        uint256 deadline,
        uint256 bounty,
        bytes32 x402PaymentProof
    ) external {
        require(deadline > block.timestamp, "deadline");
        require(bounty > 0, "no bounty");
        require(x402PaymentProof != bytes32(0), "no payment proof");
        require(
            usdc.transferFrom(msg.sender, address(this), bounty),
            "usdc transfer"
        );
        uint256 id = ++nextAssertionId;
        assertions[id] = Assertion(
            assertionHash,
            testRef,
            msg.sender,
            bounty,
            deadline,
            false,
            false,
            true,
            x402PaymentProof
        );
        emit AssertionCreated(id, msg.sender, bounty, true);
    }

    /// @notice Submit a counterexample as an ERC-8004 registered agent.
    /// @dev The caller MUST be the wallet bound to `agentId` in the identity
    ///      registry. This makes on-chain reputation non-transferable.
    function submitCounterexample(
        uint256 assertionId,
        bytes32 counterexampleHash,
        uint256 agentId
    ) external {
        Assertion storage a = assertions[assertionId];
        require(a.customer != address(0), "no assertion");
        require(block.timestamp <= a.deadline, "expired");
        require(!a.settled && !a.refunded, "closed");
        require(counterexampleToAssertion[counterexampleHash] == 0, "duplicate");
        require(
            identityRegistry.getAgentWallet(agentId) == msg.sender,
            "not agent wallet"
        );
        counterexampleToAssertion[counterexampleHash] = assertionId;
        counterexampleAgent[counterexampleHash] = agentId;
        emit CounterexampleSubmitted(
            assertionId,
            counterexampleHash,
            agentId,
            msg.sender
        );
    }

    /// @notice Settle a counterexample. Verdict comes from the deterministic
    ///         verifier, NOT from an LLM.
    function settle(
        uint256 assertionId,
        bytes32 counterexampleHash,
        bool falsified
    ) external onlyValidator {
        Assertion storage a = assertions[assertionId];
        require(!a.settled && !a.refunded, "closed");
        require(
            counterexampleToAssertion[counterexampleHash] == assertionId,
            "unknown"
        );
        require(!settledCounterexamples[counterexampleHash], "settled");
        settledCounterexamples[counterexampleHash] = true;

        uint256 agentId = counterexampleAgent[counterexampleHash];
        address agentWallet = identityRegistry.getAgentWallet(agentId);

        if (falsified) {
            uint256 fee = (a.bounty * platformFeeBps) / 10000;
            uint256 payout = a.bounty - fee;
            a.settled = true;

            if (a.usdc) {
                require(usdc.transfer(agentWallet, payout), "usdc agent");
                require(usdc.transfer(platform, fee), "usdc platform");
            } else {
                (bool ok1, ) = agentWallet.call{value: payout}("");
                (bool ok2, ) = platform.call{value: fee}("");
                require(ok1 && ok2, "transfer failed");
            }

            _writeReputation(
                agentId,
                1,
                "validCounterexamples",
                counterexampleHash
            );
            emit Falsified(
                assertionId,
                counterexampleHash,
                agentId,
                agentWallet,
                payout
            );
        } else {
            _writeReputation(
                agentId,
                -1,
                "falseClaimRate",
                counterexampleHash
            );
            emit Rejected(assertionId, counterexampleHash, agentId, agentWallet);
        }
    }

    /// @notice Refund an un-settled, expired assertion.
    function refund(uint256 assertionId) external {
        Assertion storage a = assertions[assertionId];
        require(a.customer == msg.sender, "not customer");
        require(block.timestamp > a.deadline, "not expired");
        require(!a.settled && !a.refunded, "closed");
        a.refunded = true;

        if (a.usdc) {
            require(usdc.transfer(a.customer, a.bounty), "usdc refund");
        } else {
            (bool ok, ) = a.customer.call{value: a.bounty}("");
            require(ok, "refund failed");
        }
        emit Refunded(assertionId, a.customer);
    }

    function _writeReputation(
        uint256 agentId,
        int128 value,
        string memory tag,
        bytes32 counterexampleHash
    ) internal {
        reputationRegistry.giveFeedback(
            agentId,
            value,
            0,
            tag,
            "falsify",
            "falsify",
            "",
            counterexampleHash
        );
    }
}

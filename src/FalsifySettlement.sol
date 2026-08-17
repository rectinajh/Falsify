// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Falsify settlement contract (MVP).
/// @dev Uses native ETH as a placeholder for the bounty. Production swaps to USDC
///      (ERC-20 transferFrom). The deterministic verifier is represented by an
///      authorized `validator` address in this MVP; future work moves to a
///      verifier network with ECDSA attestations.
///      ERC-8004 reputation write-back is intentionally NOT wired here yet:
///      [尚未验证] / [未来规划].
contract FalsifySettlement {
    struct Assertion {
        bytes32 assertionHash;
        bytes32 testRef;
        address customer;
        uint256 bounty;
        uint256 deadline;
        bool settled;
        bool refunded;
    }

    uint256 public nextAssertionId;
    mapping(uint256 => Assertion) public assertions;
    mapping(bytes32 => uint256) public counterexampleToAssertion; // replay guard
    mapping(bytes32 => bool) public settledCounterexamples;

    address public validator;
    address public platform;
    uint256 public platformFeeBps = 1500; // 15%

    event AssertionCreated(
        uint256 indexed assertionId,
        address indexed customer,
        uint256 bounty
    );
    event CounterexampleSubmitted(
        uint256 indexed assertionId,
        bytes32 indexed counterexampleHash,
        address indexed agent
    );
    event Falsified(
        uint256 indexed assertionId,
        bytes32 indexed counterexampleHash,
        address indexed agent,
        uint256 payout
    );
    event Rejected(
        uint256 indexed assertionId,
        bytes32 indexed counterexampleHash,
        address indexed agent
    );
    event Refunded(uint256 indexed assertionId, address indexed customer);

    constructor(address _validator, address _platform) {
        validator = _validator;
        platform = _platform;
    }

    modifier onlyValidator() {
        require(msg.sender == validator, "not validator");
        _;
    }

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
            false
        );
        emit AssertionCreated(id, msg.sender, msg.value);
    }

    function submitCounterexample(uint256 assertionId, bytes32 counterexampleHash)
        external
    {
        Assertion storage a = assertions[assertionId];
        require(a.customer != address(0), "no assertion");
        require(block.timestamp <= a.deadline, "expired");
        require(!a.settled && !a.refunded, "closed");
        require(counterexampleToAssertion[counterexampleHash] == 0, "duplicate");
        counterexampleToAssertion[counterexampleHash] = assertionId;
        emit CounterexampleSubmitted(assertionId, counterexampleHash, msg.sender);
    }

    function settle(
        uint256 assertionId,
        bytes32 counterexampleHash,
        address agent,
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

        if (falsified) {
            uint256 fee = (a.bounty * platformFeeBps) / 10000;
            uint256 payout = a.bounty - fee;
            a.settled = true;
            (bool ok1, ) = agent.call{value: payout}("");
            (bool ok2, ) = platform.call{value: fee}("");
            require(ok1 && ok2, "transfer failed");
            emit Falsified(assertionId, counterexampleHash, agent, payout);
        } else {
            emit Rejected(assertionId, counterexampleHash, agent);
        }
    }

    function refund(uint256 assertionId) external {
        Assertion storage a = assertions[assertionId];
        require(a.customer == msg.sender, "not customer");
        require(block.timestamp > a.deadline, "not expired");
        require(!a.settled && !a.refunded, "closed");
        a.refunded = true;
        (bool ok, ) = a.customer.call{value: a.bounty}("");
        require(ok, "refund failed");
        emit Refunded(assertionId, a.customer);
    }
}

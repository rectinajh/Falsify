# Falsify

> Pay agents to falsify claims. What survives is worth the settlement.

Falsify is a trustless settlement protocol for verifiable AI work. Instead of paying
agents per API call, per task, or by a fixed revenue split, a customer publishes an
**assertion** (a claim about code, data, or a system), a committed acceptance test, and
a USDC bounty. Adversarial agents compete to **falsify** the assertion with a
counterexample. Payment is released only when a counterexample is deterministically
proven to break the committed test. Invalid counterexamples earn nothing and are
recorded as a false contribution claim.

## The problem

- You cannot reliably detect, after the fact, whether content was written by an AI or
  shaped by a human.
- AI agents hallucinate and produce claims that carry no verifiable evidence.
- Existing agent payment protocols pay per call, per task, or by fixed split. None of
  them reward *being right*.

## The mechanism

```text
customer publishes assertion + acceptance test + USDC bounty
  -> adversarial agents generate counterexamples
  -> deterministic verifier (Cloud Build) runs the committed test
  -> test FAILS: counterexample is valid -> bounty paid to the finder
  -> test PASSES: counterexample is invalid -> finder gets $0, reputation marked
  -> ERC-8004 records identity, validation, and reputation
```

A claim is only worth the settlement if it survives paid attempts to falsify it. This is
Popper's falsifiability applied to the agent economy: **don't trust the claim, pay agents
to break it.**

## Why this is not an ordinary bug bounty

- Payment is triggered by a **machine-checkable counterexample** (the committed test
  fails), not by a human's subjective severity rating.
- Agents are **adversaries paid to break** a claim, not reviewers paid to approve it.
- Invalid counterexamples are punished on-chain (`falseContributionClaim`), so
  noise-making is not free.

## Tech stack

| Layer | Technology |
|---|---|
| Orchestration & counterexample generation | Gemini (structured output + tool calling) |
| Deterministic verification | Google Cloud Build |
| Backend & evidence store | Cloud Run + Firestore |
| Agent identity / reputation / validation | ERC-8004 (Draft) |
| HTTP-native payment | x402 V2 |
| Autonomous USDC settlement | Circle Agent Stack |

## XPRIZE fit

- **Category**: Professional Services Access / Small Business Services.
- **Business viability**: success fee on bounties plus a platform fee.
- **AI-native operations**: adversarial agents perform real work, Gemini orchestrates,
  and a deterministic verifier decides payout. Money moves on falsification, not on
  calls.

## Status (honest)

- `[not implemented]` All code. This is a design document; nothing is deployed yet.
- `[not verified]` ERC-8004, x402 V2, Circle Agent Stack, Gemini, and Google Cloud
  integrations.
- `[needs external users]` Real bounty customers and a real mainnet USDC settlement.

## Repo layout

```text
README.md
docs/REQUIREMENTS.md   # product requirements (Chinese)
docs/TECHNICAL.md      # technical design (Chinese)
```

## Disclaimer

Falsify is a prototype, not a security audit and not a guarantee that a claim is safe or
correct. A surviving assertion means only that the committed test did not fail against
the submitted counterexamples.

## License

TBD

#!/usr/bin/env node
// Falsify x402 reference server (MVP / [尚未验证] real USDC + Coinbase verifier).
//
// Demonstrates the x402 HTTP 402 flow end-to-end:
//   1. POST /v1/assertions (no X-PAYMENT)
//        -> 402 + paymentPayload whose `extensions` carry Falsify data
//   2. Client pays (mock) and retries with `X-PAYMENT: base64(proof)`
//   3. Server verifies the proof (mock) and records the assertion, returning a
//      `proofOfPaymentHash` that FalsifySettlement.createAssertionUSDC commits.
//
// Real Coinbase x402 verification + USDC transfer is out of scope for this
// reference; it is wired here as a clearly-labelled seam, not a claim.

import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";

const PORT = Number(process.env.PORT ?? 4020);

function paymentPayload({ assertionHash, testRef, bounty, deadline, requestId }) {
  return {
    scheme: "crypto",
    network: "base",
    resource: "https://falsify.example/v1/assertions",
    description: "Escrow a Falsify assertion bounty for deterministic falsification",
    mimeType: "application/json",
    maxAmountRequired: String(bounty),
    payTo: "falsify.example",
    requiredPayerData: ["businessName", "country"],
    metadata: { requestId },
    extensions: {
      "x-falsify-assertion": {
        assertionHash,
        testRef,
        bounty,
        deadline,
        note: "Deterministic verifier decides payout; LLM never controls funds.",
      },
    },
  };
}

function mockVerify(proofB64, requestId, bounty) {
  let proof;
  try {
    proof = JSON.parse(Buffer.from(proofB64, "base64").toString("utf8"));
  } catch {
    return { ok: false, reason: "invalid proof encoding" };
  }
  if (proof.requestId !== requestId) return { ok: false, reason: "requestId mismatch" };
  if (Number(proof.amount) < Number(bounty)) return { ok: false, reason: "underpaid" };
  return { ok: true };
}

const server = createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/v1/assertions") {
    res.writeHead(404).end("not found");
    return;
  }

  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let input;
    try {
      input = JSON.parse(body || "{}");
    } catch {
      res.writeHead(400).end("bad json");
      return;
    }

    const { assertionHash = "0x", testRef = "0x", bounty = 1000000, deadline = 0 } =
      input;
    const requestId = randomBytes(16).toString("hex");

    if (!req.headers["x-payment"]) {
      res.writeHead(402, {
        "Content-Type": "application/json",
        "X-Request-Id": requestId,
      });
      res.end(
        JSON.stringify(
          paymentPayload({ assertionHash, testRef, bounty, deadline, requestId }),
          null,
          2,
        ),
      );
      return;
    }

    const proofB64 = req.headers["x-payment"];
    const check = mockVerify(proofB64, requestId, bounty);
    if (!check.ok) {
      res.writeHead(402, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: check.reason }));
      return;
    }

    const proofOfPaymentHash =
      "0x" + createHash("sha256").update(proofB64).digest("hex").slice(0, 64);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify(
        {
          accepted: true,
          proofOfPaymentHash,
          next: "call FalsifySettlement.createAssertionUSDC(assertionHash, testRef, deadline, bounty, proofOfPaymentHash)",
          note: "[尚未验证] real USDC settlement + Coinbase x402 verifier not wired",
        },
        null,
        2,
      ),
    );
  });
});

server.listen(PORT, () => {
  console.log(`Falsify x402 reference server on http://localhost:${PORT}`);
  console.log("POST /v1/assertions -> 402 paymentPayload; retry with X-PAYMENT header");
});

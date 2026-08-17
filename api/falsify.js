// Vercel serverless function: correctness-path falsification.
// 1. Calls Gemini (real API call) to generate a counterexample (a, b).
// 2. Runs a DETERMINISTIC pure-JS verifier: the committed test is
//    `targetAdd(a, b) === a + b`. Gemini never decides the verdict.
// This is the Vercel-deployable slice. The Solidity/security path and on-chain
// settlement run in the local backend (app/server.mjs) because Vercel serverless
// cannot execute `forge test`.
const { createHash } = require("node:crypto");
const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.6-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
// Faithful JS mirror of src/Math.sol (the committed target under test).
function targetAdd(a, b) {
  if (a === b) return 0;
  return a + b;
}
function sha256hex(input) {
  return createHash("sha256").update(String(input)).digest("hex");
}
async function geminiCounterexample(assertion) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { called: false, error: "GEMINI_API_KEY is not set" };
  }
  const prompt = `You are an adversarial tester verifying a correctness claim.
Assertion: ${assertion}
Target contract (Solidity, uint256):
function add(uint256 a, uint256 b) public pure returns (uint256) {
  if (a == b) { return 0; }
  return a + b;
}
Find specific non-negative integers (a, b) where add(a, b) is NOT equal to a + b.
Return JSON with exactly these keys:
- a: non-negative integer
- b: non-negative integer
- reasoning: why add(a, b) is wrong for these inputs
- confidence: number from 0.0 to 1.0`;
  const promptHash = sha256hex(prompt);
  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.4 },
    }),
  });
  if (!res.ok) {
    return { called: true, error: `Gemini ${res.status}: ${(await res.text()).slice(0, 300)}` };
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { called: true, error: "Gemini returned non-JSON", raw: text.slice(0, 300) };
  }
  return {
    called: true,
    model: MODEL,
    promptHash: promptHash.slice(0, 16),
    responseTextHash: sha256hex(text).slice(0, 16),
    counterexample: { a: parsed.a, b: parsed.b },
    reasoning: parsed.reasoning,
    confidence: parsed.confidence,
  };
}
module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }
  const { claimType = "correctness", assertion = "add(a, b) returns a + b for all a, b" } =
    req.body ?? {};
  if (claimType === "security") {
    res.status(200).json({
      claimType: "security",
      note:
        "Solidity/security path requires `forge test`; run it locally via app/server.mjs. The Vercel slice serves the correctness path.",
    });
    return;
  }
  const gemini = await geminiCounterexample(assertion);
  const record = {
    id: createHash("sha256").update(`${Date.now()}-${Math.random()}`).digest("hex").slice(0, 8),
    ts: new Date().toISOString(),
    claimType: "correctness",
    assertionHash: sha256hex(assertion).slice(0, 24),
    assertion,
    gemini,
    verdict: null,
  };
  if (gemini.called && !gemini.error && gemini.counterexample) {
    const { a, b } = gemini.counterexample;
    const expected = a + b;
    const actual = targetAdd(a, b);
    record.verdict = {
      result: actual === expected ? "NOT_FALSIFIED" : "FALSIFIED",
      expected,
      actual,
      counterexample: { a, b },
    };
  } else {
    record.error = gemini.error ?? "no counterexample";
  }
  res.status(200).json(record);
};

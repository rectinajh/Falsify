#!/usr/bin/env node
// Gemini adversary agent: generates a counterexample for a correctness claim.
// Writes out/generated/counterexample.json, consumed by scripts/demo.mjs.
// Final validity is decided by the deterministic test, never by Gemini.

import { readFileSync, writeFileSync } from "node:fs";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY is required");
  process.exit(2);
}

const model = process.env.GEMINI_MODEL ?? "gemini-3.6-flash";
const artifactPath = process.env.ARTIFACT ?? "src/Math.sol";
const artifact = readFileSync(artifactPath, "utf8");

const prompt = `You are a tester verifying a correctness claim.

Assertion: Math.add(a, b) returns a + b for all a and b.

Target contract:
${artifact}

Find specific inputs (a, b) where add(a, b) is NOT equal to a + b.

Return JSON with exactly these keys:
- a: a non-negative integer
- b: a non-negative integer
- reasoning: why add(a, b) is wrong for these inputs
- confidence: a number from 0.0 to 1.0`;

const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
  body: JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.4 },
  }),
});

if (!res.ok) {
  console.error(`Gemini error ${res.status}: ${await res.text()}`);
  process.exit(1);
}

const data = await res.json();
const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

let parsed;
try {
  parsed = JSON.parse(text);
} catch {
  console.error("Failed to parse Gemini output as JSON. Raw text:");
  console.error(text.slice(0, 2000));
  process.exit(1);
}

if (parsed.a === undefined || parsed.b === undefined) {
  console.error("Missing a/b in Gemini output. Got:");
  console.error(JSON.stringify(parsed, null, 2).slice(0, 2000));
  process.exit(1);
}

writeFileSync(
  "out/generated/counterexample.json",
  JSON.stringify(
    {
      a: parsed.a,
      b: parsed.b,
      reasoning: parsed.reasoning,
      confidence: parsed.confidence,
    },
    null,
    2,
  ) + "\n",
);

console.log(JSON.stringify(
  {
    a: parsed.a,
    b: parsed.b,
    reasoning: parsed.reasoning,
    confidence: parsed.confidence,
  },
  null,
  2,
));

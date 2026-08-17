#!/usr/bin/env node
// Gemini adversary agent: generates a reentrancy counterexample for Vault.sol.
//
// Requires GEMINI_API_KEY. Optional GEMINI_MODEL (default gemini-2.5-flash).
// The final validity is decided by scripts/verify.mjs, never by Gemini.
//
// Status: [尚未验证] — not run against a live Gemini key yet.

import { readFileSync, writeFileSync } from "node:fs";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY is required");
  process.exit(2);
}

const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const assertion =
  process.env.ASSERTION ?? "The Vault's withdraw() is safe against reentrancy.";
const artifact = readFileSync("src/Vault.sol", "utf8");

const prompt = [
  "You are an adversarial testing agent. Your job is to falsify an assertion",
  "about a Solidity contract by producing an attack contract that makes the",
  "committed property test fail.",
  "",
  `Assertion: ${assertion}`,
  `Committed test: test_reentrancy_counterexample_falsifies_assertion`,
  "",
  "Target contract (Vault.sol):",
  "```solidity",
  artifact,
  "```",
  "",
  "Return ONLY a JSON object with this exact shape:",
  '{"attack_source":"string (full Solidity source of an Attack contract that",
  'imports {Vault} from \"./Vault.sol\", has a payable attack() that deposits then',
  "withdraws, and has a receive() that re-enters withdraw())\",",
  '"reasoning":"string","confidence":0.9}',
  "",
  "Constraints: the attack must target the state update that happens AFTER the",
  "external call in withdraw(). Do not include any markdown fences in the JSON.",
].join("\n");

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
const parsed = JSON.parse(text);

writeFileSync("out/generated/attack.sol", parsed.attack_source + "\n");
console.log(JSON.stringify(
  { reasoning: parsed.reasoning, confidence: parsed.confidence },
  null,
  2,
));

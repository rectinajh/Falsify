#!/usr/bin/env node
// Verdict -> on-chain settle bridge.
//
// Reads verdict.json (written by scripts/verify.mjs), maps the deterministic
// result to a `falsified` boolean, and (when RPC + key are provided) sends the
// settle transaction via `cast`. The validator key never touches this file.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const verdict = JSON.parse(readFileSync("verdict.json", "utf8"));
const falsified = verdict.result === "FALSIFIED";

const rpc = process.env.RPC_URL;
const key = process.env.VALIDATOR_KEY;
const settlement = process.env.SETTLEMENT_ADDRESS;
const assertionId = process.env.ASSERTION_ID ?? "1";
const cex = process.env.COUNTEREXAMPLE_HASH;

if (!cex) {
  console.error("COUNTEREXAMPLE_HASH is required (bytes32)");
  process.exit(2);
}

const args = [
  "send",
  settlement,
  "settle(uint256,bytes32,bool)",
  assertionId,
  cex,
  String(falsified),
];
if (rpc) args.push("--rpc-url", rpc);
if (key) args.push("--private-key", key);

const cmd = `cast ${args.join(" ")}`;

console.log("verdict:", verdict.result, "=> falsified:", falsified);
console.log("assertionId:", assertionId);
console.log("counterexampleHash:", cex);

if (rpc && key && settlement) {
  console.log("\nsending via cast...\n");
  execFileSync("cast", args, { stdio: "inherit" });
} else {
  console.log("\nMissing RPC_URL / VALIDATOR_KEY / SETTLEMENT_ADDRESS.");
  console.log("Run manually (example):\n");
  console.log(cmd);
}

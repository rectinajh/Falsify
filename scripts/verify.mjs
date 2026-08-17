#!/usr/bin/env node
// Deterministic Falsify verifier.
//
// Maps the committed property test's exit code to a verdict:
//   exit 0    -> NOT_FALSIFIED (test passed, assertion held)
//   exit != 0 -> FALSIFIED     (counterexample broke the property)
//
// This is the trust root: the result does NOT depend on any LLM.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const testRef =
  process.env.TEST_REF ?? "test_reentrancy_counterexample_falsifies_assertion";
const counterexampleHash = process.env.COUNTEREXAMPLE_HASH ?? "0x";

let exitCode = 0;
let stdout = "";

try {
  stdout = execFileSync("forge", ["test", "--match-test", testRef, "-vv"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (err) {
  // forge exits non-zero when a test fails. That is the signal, not an error.
  stdout = (err.stdout ?? "").toString();
  exitCode = err.status ?? 1;
}

const result = exitCode === 0 ? "NOT_FALSIFIED" : "FALSIFIED";
const verdict = {
  result,
  exitCode,
  testRef,
  counterexampleHash,
  stdoutHash: createHash("sha256").update(stdout).digest("hex").slice(0, 16),
};

const out = JSON.stringify(verdict, null, 2) + "\n";
writeFileSync("verdict.json", out);
console.log(out);

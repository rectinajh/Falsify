#!/usr/bin/env node
// Runs the deterministic verification for the Math counterexample.
// Reads out/generated/counterexample.json (written by scripts/adversary.mjs).

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ce = JSON.parse(
  readFileSync("out/generated/counterexample.json", "utf8"),
);
const env = {
  ...process.env,
  COUNTEREXAMPLE_A: String(ce.a),
  COUNTEREXAMPLE_B: String(ce.b),
};

let exitCode = 0;
let stdout = "";
try {
  stdout = execFileSync(
    "forge",
    ["test", "--match-test", "test_add_returns_sum", "-vv"],
    { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] },
  );
} catch (err) {
  stdout = (err.stdout ?? "").toString();
  exitCode = err.status ?? 1;
}

const result = exitCode === 0 ? "NOT_FALSIFIED" : "FALSIFIED";
console.log(JSON.stringify(
  { result, counterexample: { a: ce.a, b: ce.b }, exitCode },
  null,
  2,
));

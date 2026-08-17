#!/usr/bin/env node
// Falsify orchestrator + minimal web UI + evidence store.
//
// One deployable loop:
//   publish assertion -> generate counterexample -> deterministic verify -> evidence.
//
// Zero npm dependencies (Node 24 built-ins only). Run with:
//   node --env-file=.env app/server.mjs
//
// The deterministic verifier is `forge test` (Foundry). In production this
// subprocess becomes a Cloud Build step; for a self-contained deploy the image
// includes Foundry (see Dockerfile).

import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const PORT = Number(process.env.PORT ?? 8080);
const DATA_DIR = process.env.DATA_DIR ?? "data";
const EVIDENCE_FILE = join(DATA_DIR, "evidence.jsonl");
const LOG_FILE = join(DATA_DIR, "logs.jsonl");

mkdirSync(DATA_DIR, { recursive: true });

const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.6-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

function sha256hex(input) {
  return createHash("sha256").update(String(input)).digest("hex");
}

function logEvent(event, fields = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ...fields });
  appendFileSync(LOG_FILE, line + "\n");
  console.log("[log]", line);
}

function appendEvidence(record) {
  appendFileSync(EVIDENCE_FILE, JSON.stringify(record) + "\n");
}

function readEvidence() {
  if (!existsSync(EVIDENCE_FILE)) return [];
  return readFileSync(EVIDENCE_FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function runForge(matchTest, env) {
  let exitCode = 0;
  let stdout = "";
  try {
    stdout = execFileSync(
      "forge",
      ["test", "--match-test", matchTest, "-vv"],
      { encoding: "utf8", env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (err) {
    stdout = (err.stdout ?? "").toString();
    exitCode = err.status ?? 1;
  }
  return {
    exitCode,
    result: exitCode === 0 ? "NOT_FALSIFIED" : "FALSIFIED",
    stdoutHash: sha256hex(stdout).slice(0, 16),
  };
}

async function geminiCounterexample(assertion) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { called: false, error: "GEMINI_API_KEY is not set" };
  }

  let artifact = "";
  try {
    artifact = readFileSync(join("src", "Math.sol"), "utf8");
  } catch {
    artifact = "// (artifact unavailable)";
  }

  const prompt = `You are an adversarial tester verifying a correctness claim.

Assertion: ${assertion}

Target contract source:
${artifact}

Find specific non-negative integers (a, b) where Math.add(a, b) is NOT equal to a + b.

Return JSON with exactly these keys:
- a: non-negative integer
- b: non-negative integer
- reasoning: why add(a, b) is wrong for these inputs
- confidence: number from 0.0 to 1.0`;

  const promptHash = sha256hex(prompt);
  const calledAt = new Date().toISOString();
  logEvent("gemini_call", { model: MODEL, promptHash: promptHash.slice(0, 16) });

  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.4 },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    logEvent("gemini_error", { status: res.status });
    return { called: true, error: `Gemini ${res.status}: ${body.slice(0, 300)}` };
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
    calledAt,
    promptHash: promptHash.slice(0, 16),
    responseTextHash: sha256hex(text).slice(0, 16),
    counterexample: { a: parsed.a, b: parsed.b },
    reasoning: parsed.reasoning,
    confidence: parsed.confidence,
  };
}

function html(evidence) {
  const rows = evidence
    .slice()
    .reverse()
    .map(
      (e) => `<tr>
        <td>${e.id}</td>
        <td>${e.claimType}</td>
        <td><strong>${e.verdict?.result ?? "?"}</strong></td>
        <td>${e.gemini?.called ? "yes" : "no"}</td>
        <td>${e.ts}</td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Falsify</title>
  <style>
    body{font-family:system-ui,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;color:#111}
    h1{margin-bottom:.25rem} .muted{color:#666}
    form, .card{border:1px solid #ddd;border-radius:8px;padding:1rem;margin:1rem 0}
    label{display:block;margin:.5rem 0 .25rem;font-weight:600}
    input[type=text],textarea,select{width:100%;box-sizing:border-box;padding:.5rem;font:inherit}
    button{background:#111;color:#fff;border:0;padding:.6rem 1rem;border-radius:6px;cursor:pointer;font:inherit}
    table{width:100%;border-collapse:collapse;font-size:.9rem}
    th,td{text-align:left;border-bottom:1px solid #eee;padding:.5rem}
    code{background:#f4f4f4;padding:.1rem .3rem;border-radius:4px}
  </style>
</head>
<body>
  <h1>Falsify</h1>
  <div class="muted">Pay agents to falsify claims. What survives is worth the settlement.</div>

  <form id="f">
    <label for="claimType">Claim type</label>
    <select id="claimType">
      <option value="correctness">Correctness (Gemini counterexample)</option>
      <option value="security">Security (deterministic attack harness)</option>
    </select>
    <label for="assertion">Assertion</label>
    <textarea id="assertion" rows="2">Math.add(a, b) returns a + b for all a, b.</textarea>
    <button type="submit">Run falsification</button>
  </form>

  <div class="card">
    <h2 style="margin-top:0">Evidence</h2>
    <table>
      <thead><tr><th>id</th><th>type</th><th>verdict</th><th>Gemini</th><th>time</th></tr></thead>
      <tbody>${rows || "<tr><td colspan=5>no runs yet</td></tr>"}</tbody>
    </table>
  </div>

  <script>
    const f = document.getElementById("f");
    f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const body = JSON.stringify({
        claimType: f.claimType.value,
        assertion: f.assertion.value,
      });
      const btn = f.querySelector("button");
      btn.disabled = true; btn.textContent = "Running...";
      try {
        const res = await fetch("/api/falsify", {
          method: "POST", headers: { "Content-Type": "application/json" }, body,
        });
        const data = await res.json();
        alert("verdict: " + (data.verdict?.result ?? data.error ?? "error"));
        location.reload();
      } finally {
        btn.disabled = false; btn.textContent = "Run falsification";
      }
    });
  </script>
</body>
</html>`;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html(readEvidence()));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/evidence") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(readEvidence(), null, 2));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, model: MODEL }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/falsify") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      let input;
      try {
        input = JSON.parse(body || "{}");
      } catch {
        res.writeHead(400).end("bad json");
        return;
      }

      const claimType = input.claimType === "security" ? "security" : "correctness";
      const assertion = String(input.assertion ?? "Math.add(a, b) returns a + b for all a, b.");
      const id = randomUUID().slice(0, 8);

      logEvent("falsify_start", { id, claimType });

      const record = {
        id,
        ts: new Date().toISOString(),
        claimType,
        assertionHash: sha256hex(assertion).slice(0, 24),
        assertion,
        gemini: { called: false },
        verdict: null,
        settlement: null,
      };

      if (claimType === "correctness") {
        record.gemini = await geminiCounterexample(assertion);
        if (record.gemini.called && !record.gemini.error && record.gemini.counterexample) {
          const { a, b } = record.gemini.counterexample;
          record.testRef = "test_add_returns_sum";
          record.verdict = runForge("test_add_returns_sum", {
            COUNTEREXAMPLE_A: String(a),
            COUNTEREXAMPLE_B: String(b),
          });
          record.counterexample = { a, b };
        } else {
          record.error = record.gemini.error ?? "no counterexample";
        }
      } else {
        record.testRef = "test_reentrancy_counterexample_falsifies_assertion";
        record.verdict = runForge(
          "test_reentrancy_counterexample_falsifies_assertion",
          {},
        );
        record.note =
          "security counterexample from deterministic attack harness; Gemini not used to generate exploits";
      }

      appendEvidence(record);
      logEvent("falsify_end", { id, result: record.verdict?.result ?? "error" });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(record, null, 2));
    });
    return;
  }

  res.writeHead(404).end("not found");
});

server.listen(PORT, () => {
  console.log(`Falsify orchestrator on http://localhost:${PORT}`);
  console.log(`evidence -> ${EVIDENCE_FILE}`);
  console.log(`logs     -> ${LOG_FILE}`);
});

#!/usr/bin/env node
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  hydrate,
  createAssertion,
  getAssertion,
  listAssertions,
  setOnChainId,
  addCounterexample,
  addSettlement,
  recordReputation,
  creditEarnings,
  listAgents,
  listSettlements,
  summary,
} from "./store.mjs";

const PORT = Number(process.env.PORT ?? 8080);
const DATA_DIR = process.env.DATA_DIR ?? "data";
const EVIDENCE_FILE = join(DATA_DIR, "evidence.jsonl");
const LOG_FILE = join(DATA_DIR, "logs.jsonl");
const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.6-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

await hydrate();

function sha256hex(input) {
  return createHash("sha256").update(String(input)).digest("hex");
}

function bytes32(input) {
  return "0x" + sha256hex(input).slice(0, 64);
}

function logEvent(event, fields = {}) {
  appendFileSync(LOG_FILE, JSON.stringify({ ts: new Date().toISOString(), event, ...fields }) + "\n");
  console.log("[log]", event, fields);
}

function appendEvidence(record) {
  appendFileSync(EVIDENCE_FILE, JSON.stringify(record) + "\n");
}

function runForge(matchTest, env = {}) {
  let exitCode = 0;
  let stdout = "";
  try {
    stdout = execFileSync("forge", ["test", "--match-test", matchTest, "-vv"], {
      encoding: "utf8",
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
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
  if (!apiKey) return { called: false, error: "GEMINI_API_KEY is not set" };
  let artifact = "";
  try {
    artifact = readFileSync(join("src", "Math.sol"), "utf8");
  } catch {
    artifact = "// artifact unavailable";
  }
  const prompt = `You are an adversarial tester verifying a correctness claim.
Assertion: ${assertion}
Target contract source:
${artifact}
Find specific non-negative integers (a, b) where add(a, b) is NOT equal to a + b.
Return JSON with exactly these keys:
- a: non-negative integer
- b: non-negative integer
- reasoning: why add(a, b) is wrong for these inputs
- confidence: number from 0.0 to 1.0`;
  const promptHash = sha256hex(prompt);
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

function onChain() {
  return Boolean(process.env.SETTLEMENT_ADDRESS && process.env.RPC_URL && process.env.VALIDATOR_KEY);
}

function castSend(to, sig, args, value) {
  const cmd = ["send", to, sig, ...args.map(String), "--rpc-url", process.env.RPC_URL, "--private-key", process.env.VALIDATOR_KEY, "--json"];
  if (value) cmd.push("--value", String(value));
  const out = execFileSync("cast", cmd, { encoding: "utf8" });
  const parsed = JSON.parse(out.trim());
  return parsed.transactionHash ?? parsed.hash;
}

function castCall(to, sig) {
  const out = execFileSync("cast", ["call", to, sig, "--rpc-url", process.env.RPC_URL], { encoding: "utf8" });
  return out.trim();
}

function onChainCreate(assertion, id) {
  if (!onChain() || assertion.currency !== "ETH") return;
  try {
    const deadline = Math.floor(Date.now() / 1000) + 86400;
    castSend(
      process.env.SETTLEMENT_ADDRESS,
      "createAssertion(bytes32,bytes32,uint256)",
      [bytes32(assertion.assertion), bytes32("test"), deadline],
      assertion.bounty,
    );
    const nextId = castCall(process.env.SETTLEMENT_ADDRESS, "nextAssertionId()(uint256)");
    setOnChainId(id, nextId);
  } catch (err) {
    logEvent("onchain_create_error", { message: String(err.stderr ?? err).slice(0, 200) });
  }
}

function onChainSettle(assertion, counterexampleHash) {
  if (!onChain() || !assertion.onChainId) return null;
  try {
    castSend(
      process.env.SETTLEMENT_ADDRESS,
      "submitCounterexample(uint256,bytes32,uint256)",
      [assertion.onChainId, counterexampleHash, 1],
    );
    return castSend(
      process.env.SETTLEMENT_ADDRESS,
      "settle(uint256,bytes32,bool)",
      [assertion.onChainId, counterexampleHash, true],
    );
  } catch (err) {
    logEvent("onchain_settle_error", { message: String(err.stderr ?? err).slice(0, 200) });
    return "tx-error";
  }
}

function runFalsify(assertion) {
  if (assertion.claimType === "security") {
    const verdict = runForge("test_reentrancy_counterexample_falsifies_assertion");
    return {
      verdict,
      testRef: "test_reentrancy_counterexample_falsifies_assertion",
      payload: { attack: "reentrancy" },
      gemini: { called: false },
      note: "security counterexample from deterministic attack harness; Gemini not used to generate exploits",
    };
  }
  return { testRef: "test_add_returns_sum", payload: null, gemini: { called: false }, verdict: null };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("bad json"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj, null, 2));
}

function serveFile(res, path, type) {
  try {
    const content = readFileSync(path, "utf8");
    res.writeHead(200, { "Content-Type": type });
    res.end(content);
  } catch {
    res.writeHead(404).end("not found");
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  if (req.method === "GET" && p === "/") return serveFile(res, join("web", "index.html"), "text/html; charset=utf-8");
  if (req.method === "GET" && p === "/app.js") return serveFile(res, join("web", "app.js"), "text/javascript; charset=utf-8");
  if (req.method === "GET" && p === "/api/health") {
    return sendJson(res, 200, {
      ok: true,
      model: MODEL,
      onChain: Boolean(process.env.SETTLEMENT_ADDRESS && process.env.RPC_URL && process.env.VALIDATOR_KEY),
      capabilities: ["correctness", "security", "settlement"],
    });
  }
  if (req.method === "GET" && p === "/api/summary") return sendJson(res, 200, summary());
  if (req.method === "GET" && p === "/api/assertions") return sendJson(res, 200, listAssertions());
  if (req.method === "GET" && p === "/api/reputation") return sendJson(res, 200, listAgents());
  if (req.method === "GET" && p === "/api/settlements") return sendJson(res, 200, listSettlements());
  if (req.method === "GET" && p === "/api/evidence") {
    const lines = existsSync(EVIDENCE_FILE)
      ? readFileSync(EVIDENCE_FILE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
      : [];
    return sendJson(res, 200, lines);
  }

  if (req.method === "POST" && p === "/api/assertions") {
    const body = await readJsonBody(req);
    const rec = createAssertion({
      assertion: body.assertion ?? "Math.add(a,b) returns a+b for all a,b",
      claimType: body.claimType === "security" ? "security" : "correctness",
      bounty: body.bounty ?? 100,
      currency: body.currency ?? "ETH",
      customer: body.customer,
      signature: body.signature,
    });
    onChainCreate(rec, rec.id);
    logEvent("assertion_created", { id: rec.id, claimType: rec.claimType });
    return sendJson(res, 201, rec);
  }

  const falsifyMatch = p.match(/^\/api\/assertions\/(\d+)\/falsify$/);
  if (req.method === "POST" && falsifyMatch) {
    const id = Number(falsifyMatch[1]);
    const assertion = getAssertion(id);
    if (!assertion) return sendJson(res, 404, { error: "assertion not found" });
    logEvent("falsify_start", { id, claimType: assertion.claimType });

    let gemini = { called: false };
    let verdict = null;
    let testRef = null;
    let payload = null;
    let note = null;

    if (assertion.claimType === "correctness") {
      gemini = await geminiCounterexample(assertion.assertion);
      testRef = "test_add_returns_sum";
      if (gemini.called && !gemini.error && gemini.counterexample) {
        payload = gemini.counterexample;
        verdict = runForge("test_add_returns_sum", {
          COUNTEREXAMPLE_A: String(payload.a),
          COUNTEREXAMPLE_B: String(payload.b),
        });
      }
    } else {
      const r = runFalsify(assertion);
      verdict = r.verdict;
      testRef = r.testRef;
      payload = r.payload;
      note = r.note;
    }

    if (!verdict) {
      return sendJson(res, 200, { error: gemini.error ?? "no counterexample", assertion });
    }

    const hash = bytes32(`${id}:${verdict.stdoutHash}:${JSON.stringify(payload ?? {})}`);
    addCounterexample(id, { hash, agentId: 1, verdict: verdict.result, payload, gemini, testRef });

    if (verdict.result === "FALSIFIED") {
      const bounty = assertion.bounty;
      const fee = Math.round((bounty * 15) / 100);
      const payout = bounty - fee;
      recordReputation(1, "validCounterexamples", 1);
      creditEarnings(1, payout);
      const txHash = onChainSettle(assertion, hash);
      addSettlement({ assertionId: id, counterexampleHash: hash, payout, fee, txHash });
      logEvent("falsified", { id, payout, fee, txHash });
    } else {
      recordReputation(1, "falseClaimRate", -1);
      logEvent("not_falsified", { id });
    }

    const evidence = {
      ts: new Date().toISOString(),
      assertionId: id,
      assertion: assertion.assertion,
      claimType: assertion.claimType,
      gemini,
      verdict,
      testRef,
      note,
    };
    appendEvidence(evidence);
    return sendJson(res, 200, { assertion: getAssertion(id), verdict, gemini, note });
  }

  const settleMatch = p.match(/^\/api\/assertions\/(\d+)\/settle$/);
  if (req.method === "POST" && settleMatch) {
    const id = Number(settleMatch[1]);
    const assertion = getAssertion(id);
    if (!assertion) return sendJson(res, 404, { error: "assertion not found" });
    const cex = assertion.counterexamples.find((c) => c.verdict === "FALSIFIED");
    if (!cex) return sendJson(res, 400, { error: "no falsified counterexample to settle" });
    const txHash = onChainSettle(assertion, cex.hash);
    const s = addSettlement({
      assertionId: id,
      counterexampleHash: cex.hash,
      payout: Math.round(assertion.bounty * 0.85),
      fee: Math.round(assertion.bounty * 0.15),
      txHash,
    });
    return sendJson(res, 200, s);
  }

  res.writeHead(404).end("not found");
});

server.listen(PORT, () => {
  console.log(`Falsify product on http://localhost:${PORT}`);
  console.log(`store -> ${join(DATA_DIR, "store.json")}`);
  console.log(`evidence -> ${EVIDENCE_FILE}`);
});

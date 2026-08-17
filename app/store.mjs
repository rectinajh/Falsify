import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = process.env.DATA_DIR ?? "data";
const STORE_FILE = join(DATA_DIR, "store.json");

let firestore = null;
async function getFirestore() {
  if (process.env.FIRESTORE !== "true") return null;
  if (firestore) return firestore;
  try {
    const { Firestore } = await import("@google-cloud/firestore");
    firestore = new Firestore();
    return firestore;
  } catch (e) {
    console.error("firestore init failed:", e.message);
    return null;
  }
}

let state = {
  assertions: [],
  agents: [],
  settlements: [],
  nextAssertionId: 1,
  nextAgentId: 1,
};

export function load() {
  if (existsSync(STORE_FILE)) {
    try {
      state = JSON.parse(readFileSync(STORE_FILE, "utf8"));
    } catch {
      // corrupt store -> start fresh rather than crash
      state = { assertions: [], agents: [], settlements: [], nextAssertionId: 1, nextAgentId: 1 };
    }
  }
}

function save() {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(STORE_FILE, JSON.stringify(state, null, 2) + "\n");
  if (process.env.FIRESTORE === "true") {
    getFirestore().then((db) => {
      if (db) {
        db.collection("state").doc("main").set({ ...state, updatedAt: Date.now() })
          .catch((e) => console.error("firestore write:", e.message));
      }
    });
  }
}

export async function hydrate() {
  if (process.env.FIRESTORE === "true") {
    const db = await getFirestore();
    if (db) {
      try {
        const doc = await db.collection("state").doc("main").get();
        if (doc.exists) {
          const data = doc.data();
          delete data.updatedAt;
          state = data;
          return;
        }
      } catch (e) {
        console.error("firestore hydrate:", e.message);
      }
    }
  }
  load();
}

export function createAssertion({ assertion, claimType, bounty, currency, customer, signature }) {
  const id = state.nextAssertionId++;
  const rec = {
    id,
    assertion,
    claimType,
    bounty: Number(bounty) || 0,
    currency: currency === "USDC" ? "USDC" : "ETH",
    customer: customer ?? "0xcustomer",
    signature: signature ?? null,
    status: "open",
    createdAt: new Date().toISOString(),
    deadline: null,
    onChainId: null,
    counterexamples: [],
  };
  state.assertions.push(rec);
  save();
  return rec;
}

export function getAssertion(id) {
  return state.assertions.find((a) => a.id === Number(id)) ?? null;
}

export function setOnChainId(id, onChainId) {
  const a = getAssertion(id);
  if (!a) return;
  a.onChainId = Number(onChainId);
  save();
}

export function listAssertions() {
  return state.assertions;
}

export function addCounterexample(assertionId, cex) {
  const a = getAssertion(assertionId);
  if (!a) return null;
  const rec = {
    hash: cex.hash,
    agentId: cex.agentId ?? 1,
    submittedAt: new Date().toISOString(),
    verdict: cex.verdict ?? "pending",
    payload: cex.payload ?? null,
    gemini: cex.gemini ?? { called: false },
    testRef: cex.testRef ?? null,
  };
  a.counterexamples.push(rec);
  if (rec.verdict === "FALSIFIED") a.status = "falsified";
  save();
  return rec;
}

export function addSettlement({ assertionId, counterexampleHash, payout, fee, txHash }) {
  const rec = {
    assertionId: Number(assertionId),
    counterexampleHash,
    payout: Number(payout) || 0,
    fee: Number(fee) || 0,
    txHash: txHash ?? null,
    ts: new Date().toISOString(),
  };
  state.settlements.push(rec);
  save();
  return rec;
}

export function getOrCreateAgent(agentId, name) {
  let agent = state.agents.find((x) => x.id === Number(agentId));
  if (!agent) {
    agent = {
      id: Number(agentId) || state.nextAgentId++,
      name: name ?? `Agent-${state.nextAgentId}`,
      wallet: "0xagent",
      validCounterexamples: 0,
      falseClaimRate: 0,
      earned: 0,
    };
    state.agents.push(agent);
  }
  save();
  return agent;
}

export function recordReputation(agentId, tag, value) {
  const agent = getOrCreateAgent(agentId);
  if (tag === "validCounterexamples" && value > 0) agent.validCounterexamples += 1;
  if (tag === "falseClaimRate" && value < 0) agent.falseClaimRate += 1;
  save();
  return agent;
}

export function creditEarnings(agentId, amount) {
  const agent = getOrCreateAgent(agentId);
  agent.earned += Number(amount) || 0;
  save();
  return agent;
}

export function listAgents() {
  return state.agents;
}

export function listSettlements() {
  return state.settlements;
}

export function summary() {
  const assertions = state.assertions;
  const totalBounty = assertions.reduce((s, a) => s + a.bounty, 0);
  const totalSettled = state.settlements.reduce((s, x) => s + x.payout + x.fee, 0);
  const totalFees = state.settlements.reduce((s, x) => s + x.fee, 0);
  return {
    assertions: assertions.length,
    open: assertions.filter((a) => a.status === "open").length,
    falsified: assertions.filter((a) => a.status === "falsified").length,
    survived: assertions.filter((a) => a.status === "survived").length,
    totalBounty,
    totalSettled,
    totalFees,
    agents: state.agents.length,
  };
}

export function all() {
  return state;
}

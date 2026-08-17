#!/usr/bin/env node
// Spin up a local chain, deploy Falsify contracts, register an agent, and print
// the env vars that make app/server.mjs settle on-chain via `cast`.
// Usage: source <(node scripts/dev-chain.mjs)
import { spawn, execFileSync } from "node:child_process";
const RPC = process.env.RPC_URL ?? "http://localhost:8545";
const KEY = process.env.VALIDATOR_KEY ?? "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
async function rpc(method, params = []) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return res.json();
}
async function chainAlive() {
  try {
    const r = await rpc("eth_chainId");
    return !r.error;
  } catch {
    return false;
  }
}
function deploy(contract, extraArgs = []) {
  const out = execFileSync(
    "forge",
    ["create", contract, "--private-key", KEY, "--rpc-url", RPC, "--broadcast", "--json", ...extraArgs],
    { encoding: "utf8" },
  );
  return JSON.parse(out.trim()).deployedTo;
}
const alive = await chainAlive();
if (!alive) {
  console.error("Starting anvil on :8545 ...");
  spawn("anvil", ["--port", "8545"], { stdio: "ignore", detached: true }).unref();
  await new Promise((r) => setTimeout(r, 2500));
  if (!(await chainAlive())) {
    console.error("anvil failed to start");
    process.exit(1);
  }
}
const deployer = execFileSync("cast", ["wallet", "address", "--private-key", KEY], { encoding: "utf8" }).trim();
const identity = deploy("src/mocks/ERC8004Mock.sol:MockERC8004Identity");
const reputation = deploy("src/mocks/ERC8004Mock.sol:MockERC8004Reputation");
const usdc = deploy("src/mocks/MockUSDC.sol:MockUSDC");
const settlement = deploy("src/FalsifySettlement.sol:FalsifySettlement", [
  "--constructor-args", deployer, deployer, identity, reputation, usdc,
]);
execFileSync(
  "cast",
  ["send", identity, "register(string)", "ipfs://agent-1", "--private-key", KEY, "--rpc-url", RPC],
  { stdio: "ignore" },
);
console.log(`export RPC_URL=${RPC}`);
console.log(`export VALIDATOR_KEY=${KEY}`);
console.log(`export SETTLEMENT_ADDRESS=${settlement}`);
console.log(`export IDENTITY_REGISTRY=${identity}`);
console.log(`export REPUTATION_REGISTRY=${reputation}`);
console.log(`export USDC_ADDRESS=${usdc}`);

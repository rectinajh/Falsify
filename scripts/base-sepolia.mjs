#!/usr/bin/env node
// Run one real USDC settlement on Base Sepolia using Circle testnet USDC.
// Requires BASE_SEPOLIA_RPC and BASE_SEPOLIA_PRIVATE_KEY (a funded wallet).
// Prints every transaction hash + a clickable Basescan link.
import { execFileSync } from "node:child_process";

const RPC = process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org";
const KEY = (process.env.eth_private_key ?? process.env.BASE_SEPOLIA_PRIVATE_KEY)?.trim();
if (!KEY) {
  console.error("BASE_SEPOLIA_PRIVATE_KEY is required");
  process.exit(2);
}

// Circle testnet USDC on Base Sepolia (6 decimals).
const USDC = process.env.BASE_SEPOLIA_USDC ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8" }).trim();
}

function deploy(contract, extraArgs = []) {
  const out = run("forge", [
    "create", contract, "--private-key", KEY, "--rpc-url", RPC, "--broadcast", "--json", ...extraArgs,
  ]);
  return JSON.parse(out).deployedTo;
}

function tx(cmdArgs) {
  const out = run("cast", ["send", ...cmdArgs, "--private-key", KEY, "--rpc-url", RPC, "--json"]);
  const parsed = JSON.parse(out);
  return parsed.transactionHash ?? parsed.hash;
}

function link(hash) {
  return `https://sepolia.basescan.org/tx/${hash}`;
}

const deployer = run("cast", ["wallet", "address", "--private-key", KEY]);

console.log("Deploying to Base Sepolia (using Circle USDC)...");
const identity = deploy("src/mocks/ERC8004Mock.sol:MockERC8004Identity");
const reputation = deploy("src/mocks/ERC8004Mock.sol:MockERC8004Reputation");
const settlement = deploy("src/FalsifySettlement.sol:FalsifySettlement", [
  "--constructor-args", deployer, deployer, identity, reputation, USDC,
]);

console.log("\nDeployed:");
console.log("  settlement:", settlement);
console.log("  identity:  ", identity);
console.log("  reputation:", reputation);
console.log("  usdc (Circle testnet):", USDC);

const h1 = tx([identity, "register(string)", "ipfs://falsify-agent-1"]);
console.log("\nregister agent:", link(h1));

const bounty = 1000000; // 1.00 USDC
const h2 = tx([USDC, "approve(address,uint256)", settlement, String(bounty)]);
console.log("approve settlement:", link(h2));

const assertionHash = "0x237457cf8a0b1cb256d2514b534f34f1355d190c8ab01a44f08727520a30c501";
const testRef = "0x9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const deadline = Math.floor(Date.now() / 1000) + 86400;
const x402Proof = "0x" + "f".repeat(64);
const h3 = tx([settlement, "createAssertionUSDC(bytes32,bytes32,uint256,uint256,bytes32)", assertionHash, testRef, String(deadline), String(bounty), x402Proof]);
console.log("createAssertionUSDC (escrow 1 USDC):", link(h3));

const cexHash = "0x" + "c0".repeat(32);
const h4 = tx([settlement, "submitCounterexample(uint256,bytes32,uint256)", "1", cexHash, "1"]);
console.log("submitCounterexample (agent 1):", link(h4));

const h5 = tx([settlement, "settle(uint256,bytes32,bool)", "1", cexHash, "true"]);
console.log("settle FALSIFIED:", link(h5));

console.log("\nVerification:");
console.log("  deployer USDC (0.85 payout + 0.15 fee = 1.00 back):", run("cast", ["call", USDC, "balanceOf(address)(uint256)", deployer, "--rpc-url", RPC]));
console.log("  settlement USDC balance (should be 0):", run("cast", ["call", USDC, "balanceOf(address)(uint256)", settlement, "--rpc-url", RPC]));

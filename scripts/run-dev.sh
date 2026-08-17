#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Deploy contracts on a local chain (starts anvil if not already running) and
# export RPC_URL / VALIDATOR_KEY / SETTLEMENT_ADDRESS into this shell.
eval "$(node scripts/dev-chain.mjs)"
# Run the product server in the foreground. .env supplies GEMINI_API_KEY.
exec node --env-file=.env app/server.mjs

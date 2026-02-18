#!/usr/bin/env bash
# verify.sh — Verify all Clawbada contracts on Basescan.
# Usage: bash contracts/script/verify.sh [network]
#   network: "base-sepolia" (default) or "base"
#
# Requires:
#   - BASESCAN_API_KEY set in environment or .env
#   - deployments/<network>.json written by Deploy.s.sol
#   - jq installed

set -euo pipefail

NETWORK="${1:-base-sepolia}"
DEPLOYMENT_FILE="deployments/${NETWORK}.json"

if [ ! -f "$DEPLOYMENT_FILE" ]; then
    echo "Error: $DEPLOYMENT_FILE not found. Run Deploy.s.sol first."
    exit 1
fi

if ! command -v jq &> /dev/null; then
    echo "Error: jq is required. Install with: brew install jq"
    exit 1
fi

# Load .env if present
if [ -f .env ]; then
    set -a
    source .env
    set +a
fi

if [ -z "${BASESCAN_API_KEY:-}" ]; then
    echo "Error: BASESCAN_API_KEY not set."
    exit 1
fi

# Determine chain ID and verifier URL
if [ "$NETWORK" = "base-sepolia" ]; then
    CHAIN_ID=84532
    VERIFIER_URL="https://api-sepolia.basescan.org/api"
    RPC_URL="${BASE_SEPOLIA_RPC_URL:-https://sepolia.base.org}"
elif [ "$NETWORK" = "base" ]; then
    CHAIN_ID=8453
    VERIFIER_URL="https://api.basescan.org/api"
    RPC_URL="${BASE_RPC_URL:-https://mainnet.base.org}"
else
    echo "Error: Unknown network '$NETWORK'. Use 'base-sepolia' or 'base'."
    exit 1
fi

# Read addresses from deployment JSON
read_addr() {
    jq -r ".contracts.$1" "$DEPLOYMENT_FILE"
}

DEPLOYER=$(jq -r ".deployer" "$DEPLOYMENT_FILE")
DEV_WALLET="${DEV_WALLET:?DEV_WALLET not set}"

TREASURY=$(read_addr "Treasury")
LOBSTER_NFT=$(read_addr "LobsterNFT")
BATTLE_VRF=$(read_addr "BattleVRF")
CLAW_TOKEN=$(read_addr "ClawToken")
TEAM_MANAGER=$(read_addr "TeamManager")
FAUCET=$(read_addr "Faucet")
MINING_POOL=$(read_addr "MiningPool")
BREEDING_LAB=$(read_addr "BreedingLab")
EVOLUTION_LAB=$(read_addr "EvolutionLab")
REPAIR_SHOP=$(read_addr "RepairShop")
MARKETPLACE=$(read_addr "Marketplace")
BATTLE_ARENA=$(read_addr "BattleArena")

# Faucet close time — we can't recover the exact value from the deployment JSON,
# so we read it from the contract if available. For verification, pass 0 and
# rely on the constructor args being auto-detected from the creation tx.
# In practice, --verify during deploy handles this automatically.

echo "=== Verifying Clawbada contracts on $NETWORK ==="
echo ""

COMMON_ARGS="--chain-id $CHAIN_ID --verifier-url $VERIFIER_URL --etherscan-api-key $BASESCAN_API_KEY --watch"

verify() {
    local name=$1
    local addr=$2
    local args=$3
    echo "Verifying $name at $addr..."
    forge verify-contract "$addr" "contracts/$name.sol:$name" \
        $COMMON_ARGS \
        --constructor-args "$args" || echo "  Warning: $name verification failed (may already be verified)"
    echo ""
}

# Tier 0
verify "Treasury" "$TREASURY" \
    "$(cast abi-encode 'constructor(address,address)' "$DEPLOYER" "$DEV_WALLET")"

verify "LobsterNFT" "$LOBSTER_NFT" \
    "$(cast abi-encode 'constructor(address,string)' "$DEPLOYER" 'https://api.clawbada.com/metadata/lobster/')"

verify "BattleVRF" "$BATTLE_VRF" \
    "$(cast abi-encode 'constructor(address)' "$DEPLOYER")"

verify "ClawToken" "$CLAW_TOKEN" \
    "$(cast abi-encode 'constructor(address,address,address)' "$DEPLOYER" "$DEPLOYER" "$TREASURY")"

# Tier 1
verify "TeamManager" "$TEAM_MANAGER" \
    "$(cast abi-encode 'constructor(address,address)' "$DEPLOYER" "$LOBSTER_NFT")"

# Faucet close time: read from the contract
FAUCET_CLOSE_TIME=$(cast call "$FAUCET" "closeTime()(uint256)" --rpc-url "$RPC_URL" 2>/dev/null || echo "0")
verify "Faucet" "$FAUCET" \
    "$(cast abi-encode 'constructor(address,address,address,uint256)' "$DEPLOYER" "$LOBSTER_NFT" "$CLAW_TOKEN" "$FAUCET_CLOSE_TIME")"

verify "MiningPool" "$MINING_POOL" \
    "$(cast abi-encode 'constructor(address,address,address,address)' "$DEPLOYER" "$CLAW_TOKEN" "$LOBSTER_NFT" "$TEAM_MANAGER")"

verify "BreedingLab" "$BREEDING_LAB" \
    "$(cast abi-encode 'constructor(address,address,address)' "$CLAW_TOKEN" "$LOBSTER_NFT" "$TREASURY")"

verify "EvolutionLab" "$EVOLUTION_LAB" \
    "$(cast abi-encode 'constructor(address,address,address)' "$CLAW_TOKEN" "$LOBSTER_NFT" "$TREASURY")"

verify "RepairShop" "$REPAIR_SHOP" \
    "$(cast abi-encode 'constructor(address,address,address)' "$CLAW_TOKEN" "$LOBSTER_NFT" "$TREASURY")"

verify "Marketplace" "$MARKETPLACE" \
    "$(cast abi-encode 'constructor(address,address,address)' "$CLAW_TOKEN" "$LOBSTER_NFT" "$TREASURY")"

# Tier 2
verify "BattleArena" "$BATTLE_ARENA" \
    "$(cast abi-encode 'constructor(address,address,address,address,address,address)' "$DEPLOYER" "$CLAW_TOKEN" "$LOBSTER_NFT" "$TEAM_MANAGER" "$TREASURY" "$BATTLE_VRF")"

echo "=== Verification complete ==="

# Clawbada Protocol Security Audit Report

**Repository:** blocksurfing/clawbada <br>
**Researchers:** Bube, Georgibuilds <br>
**Date:** Oktober 14, 2026


---

## 1. Disclaimer

This report reflects a best effort manual review of the in scope contracts as of the reviewed state of the repository. It is not a guarantee that the code is free of vulnerabilities, nor a warranty of security or correctness. Findings are based on the code and documentation available at review time, any subsequent changes to the contracts, their configuration, or their deployment scripts are outside the scope of this report. The protocol's `DEFAULT_ADMIN_ROLE` (the Safe) and other privileged roles (`SEASON_ADMIN_ROLE`, `PAUSER_ROLE`, `ELIGIBILITY_ROLE`, `MINTER_ROLE`, `BURNER_ROLE`) are treated as trusted.

## 2. Protocol Summary

Clawbada is an on-chain lobster-battling game built around a fixed-supply ERC-20 (`$GOLD`, `GoldToken`) and ERC-1155 lobster NFTs (`LobsterNFT`).

- **`GoldToken`** — `$GOLD`, `ERC20Burnable` and `AccessControl`. Fixed `MAX_SUPPLY` of 1B tokens: 295M minted once at genesis (125M LP, 100M Treasury, 70M Faucet) and 705M reserved for `MiningPool`, which is the only address holding `MINTER_ROLE` after deployment.
- **`MiningPool`** — seasonal $GOLD emission engine. Players run "expeditions" that mint rewards against an hourly demand-driven glide (`currentBaseReward`, re-peggedup to ±30%/epoch via permissionless `repeg()`), bounded by a per-epoch spend cap and an independent, monotonic lifetime cap (`MINING_ALLOCATION = 705_000_000e18`,`TOK-M1`) that is immune to `totalSupply()` fluctuations caused by burns.
- **`BattleArena`** — commit-reveal PvP battles with staked $GOLD, VRF-seeded combat (secret-mixed drand beacon, see `BattleVRF`/`battle-seed.ts`), anti-grief deposits on pre-reveal forfeiture and damage accrual gated against repairs.
- **`TeamManager`** — team composition and lobster locking, a shared `active` boolean is written by both `MiningPool` and `BattleArena` under `ACTIVITY_ROLE`.
- **`BreedingLab`** / **`EvolutionLab`** — request/fulfillment flows that mint or burn lobster NFTs and charge $GOLD fees through `Treasury`.
- **`RepairShop`** — prices damage repair as a bps share of `MiningPool.currentBaseReward()`.
- **`Marketplace`** — lobster listing/sale with `buyLobster(listingId, maxPrice)` front-running protection.
- **`Faucet`** — eligibility-gated $GOLD/lobster claims via a commit-reveal DNA roll split across `claimLobsters`/`finalizeClaim`.
- **`Treasury`** — central fee splitter: burns 85% of every protocol fee, sends 15% to a dev wallet.
- **`PauseSwitch`** — a single emergency stop gating only money-in entry points (`createBattle`/`deposit`, `startExpedition`, `requestBreed`, `evolve`, `listLobster`/`buyLobster`, `repair`, `claimLobsters`/`claimGold`), exits are never pausable so in-flight funds cannot be trapped.

## 3. Scope

| File | Description |
|---|---|
| `contracts/GoldToken.sol` | `$GOLD` ERC-20, fixed supply, role-gated mint |
| `contracts/MiningPool.sol` | Seasonal emission engine, expeditions, demand glide, lifetime mining cap |
| `contracts/BattleArena.sol` | Commit-reveal PvP, stakes, settlement, damage |
| `contracts/BattleVRF.sol` | Drand-beacon randomness helper |
| `contracts/TeamManager.sol` | Team composition, lobster locking, shared activity flag |
| `contracts/BreedingLab.sol` | Breeding requests, offspring minting |
| `contracts/EvolutionLab.sol` | Lobster evolution via fuel burn |
| `contracts/RepairShop.sol` | Damage repair priced off the mining peg |
| `contracts/Marketplace.sol` | Lobster listing/sale |
| `contracts/Faucet.sol` | Eligibility-gated claims, commit-reveal DNA roll |
| `contracts/Treasury.sol` | Central fee splitter / burn sink |
| `contracts/LobsterNFT.sol` | ERC-1155 lobster NFT, DNA/evolution tiers |
| `contracts/libraries/` | Shared libraries |

## 4. Findings Summary

| ID | Title | Severity
|---|---|---|
| M-01 | `RepairShop::repair` lacks a `maxCost` guard, quoted price can drift `±30%` before execution | Medium |
| L-01 | Repair prices have no floor, crowd pressure compresses the repair peg and a trusted admin override can brick repairs entirely |Low |
| I-01 | Misleading error names in `ERC-1155` receiver functions | Informational |
| I-02 | No recovery mechanism for accidental token transfers | Informational |
| I-03 | Redundant `devAmount > 0` check | Informational |
| I-04 | Redundant `IERC20` casting in `Treasury::processFee` | Informational |
| I-05 | `GoldToken::mint` caps circulating supply can't pass lifetime 1B | Informational |

## 5. Findings

## Mediums

### [M-01] `RepairShop::repair` lacks a `maxCost` guard, quoted price can drift `±30%` before execution

### Description

`RepairShop::repair` computes the cost at execution time: `repairRate(tier)` reads `miningPool.currentBaseReward()` and multiplies by the tier's bps share and the full computed cost is then pulled from the user via `safeTransferFrom` against their standing allowance. The peg is a lazily-updated stored value `currentBaseReward()` "may lag one epoch behind the pending re-peg" and the permissionless `repeg()` (or any pool touch that triggers `_repegIfNeeded`) steps it by up to `±30%` at each hourly epoch boundary (`REPEG_MAX_STEP_BPS = 3000`). There is no `maxCost` parameter, so a repair quoted at the pre-boundary rate can execute at a price up to 30% higher (or lower) than quoted. Marketplace already solved the identical problem under `M-04: buyLobster` takes a maxPrice and reverts `PriceExceedsMaximum` when the executed price exceeds it.

### Impact

The issue leads to slippage for users. A `repair tx` that crosses an epoch boundary where the glide steps up can charge up to 30% more than the user quoted, drawn from an open allowance. Unlike `Marketplace M-04`, there is no profiting `counterparty` a third party calling `repeg()` to raise the price on a pending repair gains nothing. Downward steps mean users can also overpay relative to the new rate, though only the up-direction needs bounding. The window is bounded and predictable: `repeg()` rolls a single step, so calling it before submitting makes the post-boundary price fully knowable.

### Recommendation

Add a `maxCost` parameter to repair and revert (e.g., `CostExceedsMax`) when `cost > maxCost`, mirroring the `buyLobster/PriceExceedsMaximum` pattern. Optionally document that integrators can call `repeg()` first to pin the quoted price one step ahead.

---

## Lows

### [L-01] Repair prices have no floor, crowd pressure compresses the repair peg and a trusted admin override can brick repairs entirely

### Description

`RepairShop::repair` and `RepairShop::repairRate` price all repairs as a fixed bps share of the live mining peg: `repairRate = currentBaseReward() × REPAIR_RATE_BPS[tier] / 10_000 ([0, 40, 120, 320])`. The peg is demand driven `_glideStep` can step `baseReward` down up to 30% per hourly epoch (`REPEG_MAX_STEP_BPS = 3000`) when crowd demand pushes the re-peg target below the lower clamp. Unlike the battle stake peg which anchors `stakeReference` to 20% of the genesis 1,250 GOLD and caps it at genesis the repair peg has no genesis anchor, no lower bound above zero and no minimum cost beyond Treasury's `AmountBelowMinimum` floor. Two consequences follow:

1. Organic compression (player-driven). Sustained demand ratchets the rate down up to 30%/epoch compounding, making repairs progressively cheaper during the busiest seasons, exactly when damage accrual is highest and the sink matters most.
2. Admin triggered bricking. `setBaseReward` accepts any nonzero value. `setBaseReward(1)` yields `rate == 0`, then `repair()` reverts `RewardPegUnset`, intermediate dust values produce `cost < 10,000 wei` that leads to `AmountBelowMinimum`. Since lobsters above 79 damage cannot enter battles (`MAX_DAMAGE_FOR_BATTLE`), repairs reverting locks damaged lobsters out of the game until the peg recovers or a new season opens. Revert thresholds: `baseReward < 250 / 84 / 32 wei` for Evolved / Elite / Apex.

### Impact

The player-driven branch is real but bounded. The epoch spend cap (`EPOCH_SPEND_CAP_BPS`, ~2× fair share minted per epoch) means the demand required to keep stepping −30% grows as `1/baseReward`, reaching the dust/revert thresholds would need ~10^18 expeditions/hour, far beyond any realistic population and `_glideStep` additionally holds the rate when `remaining < baseReward` (D-19c). The peg cannot organically reach zero it bottoms out well above dust, so the impact is cheaper repairs under crowding (a weakened cost sink), not free or impossible repairs. The catastrophic branch (all repairs reverting, >79-damage lobsters locked out) is reachable only through a Safe-held `setBaseReward` call, trusted per the admin model, but the absence of any lower bound means a single misconfiguration can brick the shop with no on-chain guard, an inconsistency given that the sibling stake peg already carries a genesis anchor.

### Recommendation

Mirror the stake peg's anchor design so the repair rate can neither collapse under crowding nor be zeroed by a single admin call. Preferred: `rate = ((launchBaseReward × fixedShare) + (currentBaseReward × (1 − fixedShare))) × bps / 10_000` (e.g., 20–30% genesis-anchored, matching `stakeReference's 20/80` pattern). Independently add a nonzero lower bound to `setBaseReward` (or floor `repairRate/cost` directly, e.g., `cost = max(cost, 10_000))` so no admin call can push the rate into the `RewardPegUnset/AmountBelowMinimum` bands, hardening against misconfiguration without changing the trusted admin model. If `repairRate` is floored above zero, the `RewardPegUnset` branch becomes unreachable and can be dropped.

---

## Informationals

### [I-01] Misleading error names in `ERC-1155` receiver functions

### Description

`Marketplace::onERC1155Received()`, `onERC1155BatchReceived()` receiver functions revert with semantically wrong errors: `ZeroAddress()` used when sender is wrong token contract (not a zero address issue), `NotLobsterOwner(0)` used when operator is wrong (ownership is irrelevant here), `ZeroPrice()` used when `supply != 1` (price has nothing to do with value), `onERC1155BatchReceived` always reverts with `ZeroAddress()` regardless of context. This severely hampers debugging and off-chain tooling interpretation.

### Recommendation: 

Define specific custom errors: `UnauthorizedTokenContract(address sender)`, `UnauthorizedOperator(address op)`, `InvalidSupply(uint256 value)`, `BatchTransfersNotSupported()`. Replace misleading reverts accordingly.

---

### [I-02] No recovery mechanism for accidental token transfers

### Description

The comments correctly state: "Treasury does NOT accumulate tokens". However, in practice, accidents happen. Without a recovery function, any `ERC20` tokens accidentally sent to this contract are permanently locked.

### Recommendation: 

Add a standard, owner-only recovery function for ERC20 tokens. This does not violate the "no accumulation" design, it merely provides an escape hatch for human error:
```solidity
function recoverERC20(IERC20 token, address recipient, uint256 amount) external onlyOwner {
    token.safeTransfer(recipient, amount);
}
```

---

### [I-03] Redundant `devAmount > 0` check

### Description

In `Treasury::processFee()` the code includes:
```solidity
if (devAmount > 0) {
    IERC20(address(goldToken)).safeTransfer(devWallet, devAmount);
}
```
Given the guard `amount >= BPS_DENOMINATOR (10,000)` and `DEV_BPS = 1500`, the minimum possible `devAmount` is mathematically guaranteed to be `10,000 - 8,500 = 1,500`. Therefore, `devAmount` will never be `0` when this line is reached. The check is dead code.

### Recommendation

Remove the `if (devAmount > 0) `wrapper to save minimal gas and improve code clarity. The transfer can be called unconditionally.

---

### [I-04] Redundant `IERC20` casting in `Treasury::processFee`

### Description

`Treasury::processFee()`, the state variable `goldToken` is already typed as `IGoldBurnable`, which inherits from `IERC20`. The using `SafeERC20` for `IERC20` directive applies to it directly. Casting it via `IERC20(address(goldToken))` is redundant.

### Recommendation

```solidity
goldToken.safeTransferFrom(msg.sender, address(this), amount);
// ...
goldToken.safeTransfer(devWallet, devAmount);
```

---

### [I-05] `GoldToken::mint` caps circulating supply can't pass lifetime 1B 

### Description

The dev comment in `GoldToken::mint` states that the `totalSupply` can't pass 1B, but each call to the `burn` function decreases the `totalSupply` and in principle the total minted tokens can be more than 1B, but this is not true in practice.

### Recommendation
Change the comment above the `GoldToken::Mint` function to describe the intended design.

---

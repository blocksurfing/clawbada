# Independent contract audits — findings and approved fixes

**Plain-language summary.** External auditors are reviewing the contracts. Everything they raise is logged here
with the owner's decision. **No contract change is made while an audit is open**: approved fixes queue in this
list and land together in one PR after the audit closes, so the auditors always review a stable target and
every fix is traceable to the finding and the decision behind it.

**Rules (owner, 2026-10-09)**
1. One row per finding, in the order raised. The ID is permanent.
2. A finding gets one of: **approved fix** (queued), **no change** (with the reason), **decision pending**.
3. Nothing in `contracts/` moves until the audit's status below is **closed**. Then the queued fixes ship as one
   batch PR, each commit naming its ID, with `forge test -j 4` and the CI slither command green.
4. Deploys are a separate decision (none to Sepolia yet — see `docs/runbooks/testnet-deploy.md`).

## Audits

| Audit | Auditors | Scope | Opened | Status |
|---|---|---|---|---|
| A1 | Bube, Georgibuilds (external) | all contracts at `main` as of 2026-10-08 (`9f022d4`) | 2026-10-08 | **closed 2026-10-17** — final report dated 2026-10-14, filed as [`2026-10-14-independent-audit-a1-report.md`](./2026-10-14-independent-audit-a1-report.md): 1 Medium, 1 Low, 5 Informational; the batch below is approved and ships as one PR |

## Findings

| ID | Audit | Raised | Contract | Finding | Our assessment | Decision | Status |
|---|---|---|---|---|---|---|---|
| IA-01 | A1 | 2026-10-08 (Bube) | `GoldToken` | `mint` caps **circulating** supply (`MAX_SUPPLY − totalSupply()`), so burns hand headroom back to the minter and tokens minted over the token's lifetime can exceed 1B; the `@dev` comment ("exceed 1B total") reads as a lifetime cap | Correct reading. Unreachable today (genesis 295M + MiningPool's own 705M lifetime cap = 1B exactly, and MiningPool is the only minter after Configure) but a future `MINTER_ROLE` grant could re-mint burned supply, undoing the deflation players paid for. The tokenomics promise is a fixed 1B ever | **Approved fix** (owner, 2026-10-09): lifetime cap in the token | **Shipped** — PR #214 (`totalMinted`) |
| IA-02 | A1 | 2026-10-14 report **M-01** | `RepairShop` | `repair(lobsterId, points)` prices at execution from `MiningPool.currentBaseReward()`, which the hourly glide can step up to ±30 %; there is no `maxCost`, so a repair quoted before an epoch boundary can execute up to 30 % dearer. `Marketplace.buyLobster` already carries `maxPrice` for the same reason (M-04) | Confirmed. Through our own API the harm is smaller than the report says: the API approves **exactly** the quoted cost, so a step **up** makes the transfer fail on allowance (the player is not overcharged, the repair simply fails and must be re-quoted); a step **down** leaves a dangling allowance. An agent with a standing open allowance can be overcharged by up to 30 %. No counterparty profits. Fix is cheap and mirrors the marketplace | **Approved fix** (owner, 2026-10-17): `repair(lobsterId, points, maxCost)`, revert `CostExceedsMax(cost, maxCost)`; API/web pass the quoted cost; docs say "quote, then repair with that quote as the ceiling" | **Shipped** — PR #214 |
| IA-03 | A1 | 2026-10-14 report **L-01** | `RepairShop`, `MiningPool` | Repair prices are a pure bps share of the live peg with no floor: (a) under crowding the peg compresses and repairs get cheaper exactly when damage is highest; (b) `setBaseReward` accepts any non-zero value, so `setBaseReward(1)` makes every repair revert (`RewardPegUnset` / Treasury `AmountBelowMinimum`) and locks every lobster above 79 damage out of battle until the peg recovers. The stake peg already has a 20 % genesis anchor; the repair peg has none | (a) is **by design**: TOK-G1 pegs repair costs to the mining rate so a battle's cost stays a fixed share of a battle's income whatever the population; the stake peg got its anchor for a different reason (bracket stability for matchmaking). The auditors' own bound shows the glide cannot organically reach dust (demand would have to grow as 1/baseReward; the glide also holds when the budget left is below one reward). (b) is a real one-call misconfiguration risk with no on-chain guard. The auditors' recommended anchor (20/80 like stakes) is an **economics change** that would decouple repair cost from mining income — the token-flow model (WP5) is the place to decide that, not a hardening batch | **Approved fix — floor only** (owner, 2026-10-17): `MIN_BASE_REWARD = 1e18` (one $GOLD) as the lower bound of `setBaseReward` and of the glide's clamp (replacing the `next = 1` dust floor), which keeps the smallest repair (Evolved, 40 bps) at 0.004 $GOLD, far above Treasury's 10 000-wei floor, so `RewardPegUnset` becomes unreachable and is removed. The repair peg keeps tracking mining income; the 20/80 anchor question goes to the token-flow model (WP5) | **Shipped** — PR #214 |
| IA-04 | A1 | 2026-10-14 report **I-01** | `Marketplace` | `onERC1155Received` / `onERC1155BatchReceived` revert with borrowed errors (`ZeroAddress` for a foreign token, `NotLobsterOwner(0)` for a wrong operator, `ZeroPrice` for `value != 1`, `ZeroAddress` for any batch) | Confirmed; debugging and tooling read the wrong reason | **Approved fix** (owner, 2026-10-17): `UnauthorizedTokenContract(address)`, `UnauthorizedOperator(address)`, `InvalidSupply(uint256)`, `BatchTransfersNotSupported()`; `test/Marketplace.t.sol` (3 asserts) and `test/PauseGates.t.sol` follow | **Shipped** — PR #214 |
| IA-05 | A1 | 2026-10-14 report **I-02** | `Treasury` | No way to recover tokens sent to the Treasury by mistake; the contract is designed to hold nothing, so anything that lands there is stuck | Confirmed. A bare Safe-only sweep of **$GOLD** would give the Safe discretion over protocol money that the 85/15 promise says nobody has | **Approved fix — two parts** (owner, 2026-10-17): `recoverERC20(token, to, amount)` for the Safe, **refused for $GOLD**; and a permissionless `sweepGold()` that routes any stray $GOLD through the normal 85 % burn / 15 % dev split. Human error is recoverable, the promise stays mechanical | **Shipped** — PR #214 |
| IA-06 | A1 | 2026-10-14 report **I-03**, **I-04** | `Treasury` | `if (devAmount > 0)` can never be false once `amount ≥ 10 000` (dev share ≥ 1 500 wei); `IERC20(address(goldToken))` casts are redundant because `IGoldBurnable` already extends `IERC20` | Confirmed, cosmetic | **Approved fix** (owner, 2026-10-17): drop the guard and the casts | **Shipped** — PR #214 |
| IA-07 | A1 | 2026-10-14 report **I-05** | `GoldToken` | The `mint` comment says total supply can never pass 1B; burns make that untrue for lifetime mints | Same root as IA-01; the lifetime counter makes the comment true and IA-01 rewrites it | **Folded into IA-01** | **Shipped** — PR #214 |
| IA-08 | own backlog (meat-grinder REPAIR-I1) | — | `RepairShop` | `repair` does not check `TeamManager.isLocked`, so a lobster can be repaired while mining or in a live battle | Our own open informational; harmless today (damage only gates battle **entry**, and the server reads damage at settlement), but the batch is the natural place to close it | **No change — by design** (found while planning the batch, 2026-10-17, owner-approved plan): there is no `TeamManager.isLocked`; a lobster is locked by `LobsterNFT` for as long as it sits in a team (`createTeam` locks, `disbandTeam` unlocks), and battle damage is only ever written to team lobsters — a lock gate on `repair` would force every player to disband a team before repairing. `FuzzRepairShop.test_repair_lockedLobster_allowed` asserts today's policy on purpose; repairing mid-battle or mid-expedition changes nothing the protocol relies on (damage only gates battle entry, settlement adds its damage on top). REPAIR-I1 closes as won't-fix | Closed — won't fix |

### The batch (approved 2026-10-17; shipped as PR #214)

Commits named by ID: IA-01 (+ IA-07), IA-02, IA-03, IA-04, IA-05 (+ IA-06); IA-08 was withdrawn (see its row). Beyond `contracts/` and `test/`: IA-02 changes the
`repair` ABI (`packages/chain` ABI + `apps/api` repair route pass the quoted cost as `maxCost`; the web repair page and the agents
book follow), IA-03 adds a constant the mining docs mention. Gate: `forge test -j 4` and the CI slither command green; deploys stay a
separate decision (none to Sepolia yet).

### IA-01 — lifetime mint cap in `GoldToken`

**The change (≈ 20 lines + tests).**
- `uint256 public totalMinted`, seeded by the constructor's LP + treasury mints and advanced by every `mint`.
- `mint` checks `MAX_SUPPLY − totalMinted` (error unchanged: `ExceedsMaxSupply(requested, available)`).
- `remainingMintable()` returns `MAX_SUPPLY − totalMinted`, so it no longer grows after a burn.
- The `@dev` comment says **lifetime**: burned tokens are never re-minted by any minter.
- Tests: `test/fuzz/FuzzGoldToken.t.sol` — the burn test's "remainingMintable increases after burn" assertion
  flips to "unchanged", plus the auditor's scenario (burn, then mint past the lifetime cap → revert);
  `test/invariant/InvariantProtocol.t.sol` — `invariant_supply_plus_remaining_equals_max` becomes
  `totalMinted + remainingMintable == MAX_SUPPLY`, and a new invariant `totalMinted ≤ MAX_SUPPLY`.
- Docs: the `Fixed max supply` lines in `.claude/CLAUDE.md`, `docs/GAME_DESIGN_RATIONALE.md` and
  `docs/HERMES_HANDOFF.md` gain "lifetime: burned tokens are never re-minted".

**Why not now.** It changes an invariant the auditors are reviewing against; it lands with the rest of the
batch when A1 closes.

**What was told to the auditor (2026-10-09).** That the reading is right, why it is unreachable today, and that
the token will be hardened to a lifetime counter with his scenario as a test.

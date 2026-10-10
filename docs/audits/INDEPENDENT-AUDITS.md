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
| A1 | External team (Discord: Bube et al.) | all contracts at `main` as of 2026-10-08 (`9f022d4`) | 2026-10-08 | **open** |

## Findings

| ID | Audit | Raised | Contract | Finding | Our assessment | Decision | Status |
|---|---|---|---|---|---|---|---|
| IA-01 | A1 | 2026-10-08 (Bube) | `GoldToken` | `mint` caps **circulating** supply (`MAX_SUPPLY − totalSupply()`), so burns hand headroom back to the minter and tokens minted over the token's lifetime can exceed 1B; the `@dev` comment ("exceed 1B total") reads as a lifetime cap | Correct reading. Unreachable today (genesis 295M + MiningPool's own 705M lifetime cap = 1B exactly, and MiningPool is the only minter after Configure) but a future `MINTER_ROLE` grant could re-mint burned supply, undoing the deflation players paid for. The tokenomics promise is a fixed 1B ever | **Approved fix** (owner, 2026-10-09): lifetime cap in the token | Queued — after A1 closes |

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

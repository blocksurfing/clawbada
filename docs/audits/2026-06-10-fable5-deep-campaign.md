# Clawbada Fable 5 Deep Adversarial Campaign

Run window: 2026-06-10 → 2026-06-11
Orchestration: multi-agent workflow (`fable5-deep-audit-campaign`), 91 Fable 5 agents, ~8.7M tokens
Cross-references: [`2026-05-01-v3-s1-campaign.md`](./2026-05-01-v3-s1-campaign.md), [`2026-04-15-adversarial-campaign.md`](./2026-04-15-adversarial-campaign.md), [`2026-03-06-manual-contract-audit.md`](./2026-03-06-manual-contract-audit.md)

## What this campaign was

A deliberately deeper re-run of the V3/S1 security work, structured to find what the prior single-contract passes structurally could not: **cross-contract composition bugs** and **incomplete-fix variants** of already-closed findings. Where the April/May campaigns leaned on Codex red-team agents (which hit the documented empty-output bug and were replaced with in-house lens analysis), this run used a Fable 5 fan-out with adversarial self-verification.

**Pipeline:**
1. **Recon** — one agent digested all ~60 prior findings + `OPEN RISK` NatSpec into a known-findings reference, injected into every hunter so they wouldn't re-report knowns.
2. **Hunt** — 51 parallel auditors: 45 contract×lens units (each contract assigned a lens panel scaled to risk — BattleArena and BreedingLab got all five lenses; small contracts two) + 6 cross-contract scenario agents (lock lifecycle, value conservation, role blast-radius, NFT authority, battle lifecycle, tokenomics/launch).
3. **Dedup** — one agent merged duplicate root causes across hunters.
4. **Verify** — every novel candidate faced 2–3 adversarial skeptics (a refuter, an exploit-constructor required to write the concrete call sequence, and for H/M an independent severity calibrator). 2 confirming votes required to survive.

**Funnel:** 35 raw findings → 27 claimed-novel → 17 unique after dedup → **4 confirmed / 8 refuted / 5 matched to known-accepted**. Zero candidates went unverified.

## Headline result

No new High or Medium severity bug survived adversarial verification. The protocol's core value-flow (stakes, escrow, fee split, mint/burn caps, NFT authority) held up under cross-contract scrutiny — the April/May hardening is sound. The campaign's real yield is two **design-gap** findings worth fixing and a cluster of **latent S2-replay parity traps** that must be reconciled before the on-chain `BattleResolver.replay()` roadmap can be trusted.

## Findings table

| ID | Severity | Status | Contract | Title |
|----|----------|--------|----------|-------|
| **F5-01** | Low (claimed Med) | **Fixed (2026-06-12), merged to main #17 (2026-09-04)** | BattleArena | Team-reveal is sequential on-chain + non-reveal is a neutral forfeit, letting a second mover dodge unfavorable matchups for 5% against honest first-revealers |
| **F5-02** | Low (claimed Med) | **Fixed, merged #22 (2026-09-05)** | BreedingLab | Outcome-selective breeding re-roll via expire+cancel (the *don't-finalize* variant of B-02, uncovered by the try/catch fix) |
| **F5-03** | Info | **Fixed, merged #22 (2026-09-05)** | BreedingLab | `getBreedCostPerParent(5, …)` panics with array OOB instead of a clean revert; duplicate multiplier table |
| **F5-04** | Info | **Fixed, merged #21 (2026-09-05)** | BattleResolver | VRF roll constants off-by-one (inclusive range 301 ≠ `VRF_RANGE` 300) + no canonical on-chain roll mapping; one doc comment already prescribes the wrong mapping |
| S2-parity cluster | Info | **Fixed + parity KAT lock, merged #21 (2026-09-05)** | BattleResolver / BattleVRF | Four individually-non-exploitable on/off-chain divergences that will desync `replay()` (see S2 section) |

Five further candidates verified as **known/accepted** (re-confirmations, no action): the Faucet `setCloseTime`+`sweepUnclaimed` god-key composition (C-05 class), the TM-02 dual-role burned-lobster settlement brick, soulbound→tradeable value via evolution fuel (documented onboarding flow), mining emissions bypassing Treasury (documented "pure issuance, not a fee event"), and the library not modelling distance/Defend terms (documented S2 scope). Details in the appendix.

---

## F5-01 — Team-reveal matchup dodge

**Severity:** Low (hunter claimed Medium; verifier panel split refuted-Low / confirmed-Med / confirmed-Low)
**Status:** Open — fix recommended
**File:** `contracts/BattleArena.sol`

**Issue.** In the `TeamReveal` phase the two players reveal in **separate, sequential on-chain transactions**. `revealTeam()` (line ~392) stores `teamId` and emits `TeamRevealed` on the *first* reveal — at which point the revealer's full composition is publicly readable (`getBattle → teamIdA`, `TeamManager.getTeam → lobsterIds`, `LobsterNFT.getDNA/getEvolutionTier/getDamage → class, purity, tier, damage`). The window is `TEAM_REVEAL_WINDOW = 20s` (~100 Base blocks). Critically, one-sided non-reveal here routes to the **neutral** `_forfeit` (lose only the 5% anti-grief, stake refunded) at `_handleRevealTimeout` (line 1114) — **not** `_forfeitAsLoss`, the BA-H1 "withholding a reveal is a loss, not a cheap exit" fix that *was* applied to the Active-phase move reveal (`_handleActiveTimeout`, lines 1143/1146).

A second mover can therefore withhold its reveal, read the opponent's exact comp, and bail on losing matchups for a flat 5% instead of revealing into a fight it will probably lose. This contradicts the spec's explicit guarantee — *"Prevents counter-picking — neither side sees the other's team first"* (CLAUDE.md Battle Flow phase 3) — because the power score shown at match-found (tier-sum 3–9) does not reveal class composition, which is what drives the rock-paper-scissors advantage.

**Why it's Low, not Medium (the verifier panel's correction).** The exploit is mechanically real but the impact is bounded:
- **No fund loss to any honest player.** In a dodge, the first-revealer is refunded in *full* (stake + anti-grief). The only party who pays is the dodger (5%). Nothing is stolen or frozen — the harm is adverse selection / wasted time, not value transfer.
- **Rational-vs-rational EV is zero, not positive.** Two rational agents both wait → mutual non-reveal → `_cancelBattle(MutualTimeout)` → both fully refunded. So against the stated threat model (rational profit-maximizing agents) no positive-EV grief exists; the "griefing is always negative EV" invariant is not broken.
- The positive-EV edge exists **only against naive/honest first-revealers** — most relevantly humans via Base App, who can't withhold strategically. The class signal is also a soft 1.25/0.80 damage multiplier, not a deterministic win predictor, so the edge is modest.

**Recommended fix (either, or both):**
1. Apply BA-H1's loss treatment to the team-reveal path too — make a one-sided team non-reveal a `_forfeitAsLoss` rather than a neutral `_forfeit`, so dodging costs ~100% of stake (matching the move-reveal phase). *Caveat:* the 20s window is tight; a benign RPC hiccup would then cost a human their full stake. Consider a longer team-reveal window if adopting this.
2. Enforce genuine simultaneity — e.g., both players submit reveals but neither is materialized/readable until both have landed (or fold team reveal into the existing commit so the on-chain order can't leak comp). This directly restores the spec guarantee and is human-safe.

Either way, align the docs: the spec currently over-promises "simultaneous reveal" that the sequential on-chain flow does not deliver.

**Remediation (2026-06-12, branch `fix/f5-01-team-reveal-simultaneity`, commit `d9de105`).** Took option 2 (genuine simultaneity), chosen over option 1 to avoid penalising honest fumbles (human accidents or an agent losing connectivity in the reveal window). `revealTeam` (player-submitted, sequential) is replaced by `revealTeams(battleId, teamIdA, saltA, teamIdB, saltB)` gated to `RESOLVER_ROLE`: it verifies both commit hashes, validates and power-binds both teams, and locks both atomically — neither team's identity reaches the chain until both are bound in one transaction (raw-storage reads included). The resolver already knows both teams from matchmaking and cannot forge one (each commit hash binds its `(teamId, salt)`). Because reveal is now all-or-nothing, the reveal-window timeout is a costless mutual cancel with full refunds — a dropped connection never costs a player their stake. New regression tests: `test_F5_01_revealTeams_onlyResolver`, `test_F5_01_revealTimeout_isCostlessMutualCancel`. Spec aligned in `.claude/CLAUDE.md` and `docs/gitbook/battle.md`. Gates: default 852/852, deep invariants 25/25 (seed `0xc1a88ada`), Slither `--fail-medium` clean.

**Off-chain follow-up (NOT yet done).** The contract now requires the server (RESOLVER_ROLE) to submit `revealTeams` with both salts, and clients must stop self-submitting reveals. Pending edits: regenerate the ABI (`packages/chain/src/abis/battle-arena.ts`); update the combat route (`apps/api/src/routes/game/combat/index.ts`) to collect both salts and submit `revealTeams`, holding salts server-side until the battle is Active; update the web client (`apps/web/src/lib/api.ts`, `apps/web/src/components/game/battle-moves.tsx`) to hand the salt to the server rather than reveal directly. Until this lands, the on-chain fix is in place but battles cannot be revealed through the existing app flow.

---

## F5-02 — Outcome-selective breeding re-roll (don't-finalize variant of B-02)

**Severity:** Low (hunter claimed Medium; verifiers: confirmed-Med / confirmed-Low / known-Low)
**Status:** Fixed — merged to main in #22 (2026-09-05). A committed breed is final: `cancelExpiredRequest` closes the request but refunds neither the fee nor the breed slot, so selective non-finalization gains nothing. Follow-up: `LobsterNFT.decrementBreedCount` now has no caller and can be removed.
**File:** `contracts/BreedingLab.sol`

**Issue.** The breeding outcome is fully deterministic before finalize: `seed = keccak256(blockhash(targetBlock), requestId)`, offspring DNA a pure function of cached `dnaA/dnaB` + seed. Once `targetBlock` is mined the requester can compute the exact offspring (class, purity, legend bit) off-chain **before deciding whether to finalize**. `finalizeBreed` is permissionless but carries no caller reward, so in practice nobody finalizes someone else's request. A breeder can thus keep good rolls (finalize) and discard bad ones (never finalize; let the 256-block window lapse; call `cancelExpiredRequest`).

`cancelExpiredRequest` (lines 210–239) restores `breedCount` on both parents and **never resets `_lastBreedTime`**. Because the per-breed cost is computed from the *current* `breedCount` (`_collectFeeAndUpdateParents`, line 242), every discarded cycle is recharged at the cheapest ×1 tier — the escalating schedule (×1/×1.5/×2.5/×4/×8) never escalates for discards, and the 5-breed lifetime cap stops being a roll-limiter (a slot is consumed only on a *kept* roll). Net: a breeder fishes a single prized pair for legend (0.3%) / high-purity offspring at the flat minimum fee.

**This is the variant the B-02 fix missed.** B-02 (April) was the *contract-requester* `onERC1155Received`-revert veto, closed with a try/catch that consumes the request even when the recipient hook reverts. That fix only fires when `finalize` is actually called — it does nothing against an EOA that simply never calls finalize. This path needs no malicious contract or hook.

**Why it's Low / bounded:**
- The only in-contract throttle is the 48h cooldown, which `cancelExpiredRequest` does *not* reset — so abuse is capped at ~1 roll / 48h / pair (~30 rolls/season → ~9% legend chance per pair vs the intended ~1.5% over 5 breeds).
- Every roll **burns a real fee** (deflationary, protocol-positive). The 5-offspring *supply* cap per pair is intact; only quality-selection among kept slots is gamed.
- **An accepted operational mitigation already exists** (P-03, March): finalize is permissionless precisely so a keeper finalizes pending requests within the ~8.5-min window — which the breeding API must run anyway to deliver offspring. With the keeper live, an EOA's abstain loses the race (mint succeeds, `finalized = true`, no cancel possible) and the attack is neutralized. The residual risk is the keeper being down or censored.

**Recommended fix (optional, defense-in-depth so it doesn't depend on the keeper):** track roll attempts separately from kept breeds — e.g., escalate cost on a counter that `cancelExpiredRequest` does *not* restore, or charge a non-refundable roll fee on `requestBreed` that the cancel path doesn't unwind. Either makes selective re-rolling cost-escalating rather than flat.

---

## F5-03 — `getBreedCostPerParent` panics at `breedCount == 5`

**Severity:** Info
**Status:** Fixed — merged to main in #22 (2026-09-05). `_breedCostPerParent` reverts `BreedCountOutOfRange(breedCount)` at `MAX_BREEDS`; the dead `BREED_MULTIPLIERS` storage table is removed.
**File:** `contracts/BreedingLab.sol`

The external pure helper `getBreedCostPerParent(uint8 breedCount, …)` forwards `breedCount` straight into a fixed `uint256[5]` table (`_breedCostPerParent`, line ~298). `breedCount == 5` is a legitimate on-chain value (every maxed parent reports `getBreedCount() == 5`), so an integrator pricing a maxed parent's hypothetical next breed gets `Panic(0x32)` (array OOB) instead of a domain error like `BreedLimitReached`. The agent-facing breeding API (`apps/api/src/routes/game/breeding.ts`) does exactly this read-then-price pattern and survives only because the off-chain TS mirror has its own bounds guard the on-chain helper lacks. All state-changing paths pre-validate `breedCount < 5`, so there's no fund risk — purely an external-view robustness gap, the same caller-boundary class that got NatSpec on BattleResolver's R-helpers but was never applied here.

Secondary: the public `BREED_MULTIPLIERS` array (line 31) is never read by the charging logic, which uses a duplicated literal table — a future edit to one but not the other would silently diverge advertised vs charged multipliers.

**Fix:** add an explicit `breedCount >= MAX_BREEDS` guard with a domain revert in the helper, and either delete `BREED_MULTIPLIERS` or have the charging logic read it.

---

## F5-04 + S2-parity cluster — the on-chain/off-chain divergence traps that will break `replay()`

The single most valuable thing this campaign surfaced is not one bug but a **theme**: the S2 roadmap (`BattleResolver.replay()` — deterministic on-chain re-execution for trust-minimal dispute resolution) has accumulated several silent divergences between the Solidity library, the off-chain TS engine, and the docs. None is exploitable today (there is no on-chain roll/replay consumer yet — S1 resolves via `adminResolveDispute`), which is why the verifier panel correctly refuted most of them as non-attacks. But each one will make an honest replay disagree with the canonical battle stream, the exact failure mode S2 exists to prevent. They must **all** be reconciled before `replay()` can be trusted, and ideally pinned with cross-implementation known-answer tests.

| Trap | Where | What diverges |
|------|-------|--------------|
| **F5-04 — VRF roll off-by-one** (confirmed Info) | `BattleResolver.sol:58-61`; `hash.ts:116-123`; `FuzzBattleResolver.t.sol:62` | `VRF_RANGE = 300` but the documented inclusive range [850,1150] is **301** values. No library function exports the roll mapping, so each consumer reinvents it. The two shipped consumers happen to agree on the correct `% 301`, **but `hash.ts`'s own doc comment prescribes `% VRF_RANGE` (`% 300`)** — which diverges for ~300/301 of draws and can never emit 1150. A replay implementer following the comment or the natural reading of the constant desyncs every roll. |
| **Salt encoding mismatch** (refuted Med — real, not an attack) | `BattleResolver.sol:269` vs `hash.ts:86-88` | On-chain `deriveRandom(uint256, bytes32)` hashes a 64-byte preimage (bytes32 salt zero-padded); off-chain hashes `32 + len(salt)` bytes with string salts. Same logical inputs → different digests. No cross-impl known-answer test exists. |
| **TS mirror missing the hardening guards** (refuted Info) | `battle-resolver.ts` vs `BattleResolver.sol` | The Solidity library has the S-03 (armor==0), R-03 (ratio overflow), R-06 (proc-chance cap) guards; the authoritative TS port has **none of the three**. Divergent outputs at the boundaries those guards cover. |
| **`scaleStats` tier clamp** (refuted Info) | `BattleResolver.sol:121-126` | Out-of-range tier (4–255) silently clamps to Apex, while sibling functions revert `InvalidClassId`. Inconsistent and undocumented in the caller-boundary NatSpec. |
| **`BattleVRF.deriveRandomness` additive salt** (refuted Info) | `BattleVRF.sol:70-74` | Salt documented/implemented as `battleId + round + action` — distinct draw coordinates collide (e.g. (9,4,0)/(10,3,0)/(10,2,1) all sum to 13). Predictable salt-space, no preimage separation. |

**Recommendation:** before any `replay()` work, (a) add a canonical `deriveVrfRoll` to the library and delete the per-consumer mappings; (b) fix the `hash.ts:118` comment and pin `VRF_RANGE` semantics; (c) unify salt encoding across Solidity/TS; (d) port R-03/R-06/S-03 into the TS engine; (e) replace the additive VRF salt with a collision-free encoding; (f) gate the whole library behind a cross-implementation known-answer test suite (Solidity ⇄ TS) run in CI.

---

## Refuted (verified non-attacks)

Eight candidates were killed by the verifier panel. The notable ones are listed in the S2 cluster above (real observations, not attacks). The rest: a claimed Active-phase mutual-cancel void of an in-progress battle (the load-bearing "winner abstains naturally" step doesn't hold — settle gates on `lastVerifiedRound`); `sweepUnclaimed` stranding residual pre-mint in Treasury/MiningPool (both reject/can't-spend, but that's the *point* — burn-equivalent, not loss); season-budget views over-reporting near the 705M cap (views are season-scoped by design; the lifetime cap still hard-reverts in `startExpedition`); and the TOK-H1 reserve guard living only in the deploy script (true, but the deploy script *does* enforce it with a zero-balance assert — constructor-level enforcement would be belt-and-suspenders, filed as a hardening nicety not a finding).

## Known / accepted re-confirmations (no action)

- **Faucet `setCloseTime` + `sweepUnclaimed` composition** → C-05 god-key class. Both are `DEFAULT_ADMIN_ROLE`; a compromised admin can shorten the window then sweep. No unprivileged path; funds are the protocol-owned 70M pre-mint, not user CLAW. Accepted.
- **TM-02 burned-lobster settlement brick** → dual-role (LOCKER+BURNER) compromise bricks `_applyDamage` and freezes escrow. Real but needs two roles; the TM-01 fix was deliberately scoped to the single-role team-deletion case. Accepted dual-role bar.
- **Soulbound → tradeable via evolution fuel** → claim 5 soulbound + 7K CLAW, breed a tradeable Base offspring (soulbound parents breed tradeable offspring, by spec), evolve it with soulbound fuel (NatSpec explicitly permits soulbound fuel) into a tradeable Evolved NFT. Every step is documented intended behavior (it *is* the onboarding flow); the literal sybil property (soulbound NFTs can't transfer) still holds. Design-intent.
- **Mining emissions bypass Treasury 85/15** → documented and deliberate ("mining is pure issuance, not a fee event"; MiningPool isn't authorized on Treasury and couldn't call `processFee` if it tried). Only residual is an editorial doc line listing "mining settlement" under the fee split. Design-intent.
- **Library doesn't model distance_mult / DEFEND_REDUCTION_BPS** → those terms live caller-side in the off-chain engine; the library header and GAME_DESIGN_RATIONALE explicitly scope hex/distance into the deferred S2 `replay()` extension with mandated parity testing. Design-intent (and folds into the S2 cluster above).

## Closure (2026-09-05)

Every code finding in this report is fixed and merged to `main`: F5-01 in #17 (atomic resolver-submitted `revealTeams`), the S2-parity cluster with F5-04 in #21 (canonical `vrfRollFromRandom` / `VRF_SPAN`, TS mirror guards, fail-closed `scaleStats`, `deriveRandomness` salt fix, and a Solidity⇄TS known-answer lock — which caught the 2026-08 balance-constant drift on first rebase, as designed), and F5-02 + F5-03 in #22. Each PR passed the full contracts-audit workflow (10k-run fuzz, 500×100 invariants, Slither `--fail-medium`) and the ABI-freshness gate. Remaining items are operational, not code: widen `TEAM_REVEAL_WINDOW` before mainnet (A13), exercise the reveal watcher against a live chain (A14), remove `LobsterNFT.decrementBreedCount`.

## Sign-off

No new H/M survived verification — the value-flow core is sound. Recommended actions, in priority order:
1. **F5-01** — close the team-reveal dodge (loss-on-non-reveal and/or true simultaneity) and fix the spec's "simultaneous reveal" over-promise.
2. **S2-parity cluster + F5-04** — reconcile all on/off-chain divergences and add a cross-implementation known-answer test suite *before* `BattleResolver.replay()` engineering begins. This is the gating prerequisite for the S2 trust-minimization roadmap.
3. **F5-02** — optionally add cost-escalation on roll attempts so selective re-rolling can't depend on the keeper being up.
4. **F5-03** — trivial: bounds-guard the breed-cost helper and de-duplicate the multiplier table.

Per the agreed policy, this is report-first: no code changed. Fixes to be implemented as stacked PRs with regression tests on review/approval.

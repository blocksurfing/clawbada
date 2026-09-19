# Post-June delta deep dive — adversarial audit of everything changed since the Fable 5 campaign (2026-09-19)

**Plain-language summary.** The contracts themselves held up well: no way was found for an outsider to steal or lock escrowed funds, and the fund-conservation, state-machine and lock-pairing reviews came back clean. The one serious problem is not in Solidity at all. **Battle randomness is not secret**: every battle is seeded with a public drand number and the client is handed enough to look it up, so a player can foresee every crit, damage roll and enhanced Special for the whole match. A proof using the real server and game code recovered the seed from a normal player snapshot and won 67.5% of 200 mirror games that should be 50/50. That must be fixed before any staked battle exists. Beyond it there are seven Medium issues — four about how the new server-authoritative settlement interacts with the dispute backstop, one faucet cap, one boost-table bug, one API login weakness — and twenty Low hardening items, mostly deploy-script and edge-case economics.

**Decision needed from the owner:** none to start. Fix order is below; two fixes change game rules and will be brought for a decision when reached (what a dispute is allowed to freeze, and whether draws count toward boost qualification).

## Why this audit ran

The last adversarial campaign ([2026-06-10 Fable 5](./2026-06-10-fable5-deep-campaign.md)) examined the contracts at commit `b3eecde`. Since then ten contract files changed (+532 / −389 lines): the F5-01/02/03 fixes (written *after* that audit, so never adversarially read), the S2-parity cluster, TOK-G1 auto-glide with glide-pegged repair rates, the burn-only faucet, the battle-rank mining boost, and the BattleArena V3 settle rewrite, which deleted the on-chain round loop and made the contract pay a result the resolver proposes. The two newest changes had only self-authored single-contract surface notes. Nothing in the Unity viewer, sound, or practice-battle work touches a contract.

## Method

Workflow run `wf_2715080f-4ef`, 49 agents on Fable 5.1, code at `7ca5451`.

1. **Find** — 12 independent finders, one per surface and lens: fund conservation, state machine and time, dispute system, hot-key and rational-agent economics, atomic team reveal, mining reward arithmetic, glide/boost/repair peg, role matrix and deploy scripts, cross-contract lock invariants, the smaller contracts in final form, on-chain/off-chain binding, and test coverage of the new surfaces. 60 raw findings.
2. **Consolidate** — true duplicates merged, never dropped: 41 distinct findings.
3. **Verify** — every non-Info finding went to a skeptic instructed to *refute* it against the current code and to default to refuted when it could not establish the claim. High findings got a second skeptic on reachability and economics. The final severity is the most conservative surviving view.
4. **Prove** — surviving High findings got an executable proof.
5. **Critic** — a completeness critic listed what nobody examined, examined the top gaps itself (one new finding, C-01), and its findings were verified the same way.

The nine already-known items (20-second reveal window, reveal watcher never run on a live chain, dead `decrementBreedCount`, unused `MAX_ROUNDS`, no domain separator in commit hashes, `RepairShop.repair` missing `isLocked`, no pause, salt-encoding divergence, stale staking line in the design doc) were given to every agent and excluded unless a worse consequence was found.

## Results

| | |
|---|---|
| Surfaces examined | 12 of 12 |
| Raw → distinct findings | 60 → 41 |
| Confirmed by a skeptic | 28 |
| Contested (defect real, impact weaker or unproven) | 4 |
| Refuted | 0 |
| Info observations, unverified by design | 10 |

Severity after verification: **High** 1, **Medium** 7, **Low** 20, **Info** 4. No finding was refuted outright, but skeptics lowered the severity of 10 of them.

| ID | Severity | Claimed | Status | Where | Finding |
|---|---|---|---|---|---|
| [D-01](./2026-09-19-post-june-delta-findings.md#d-01) | High | High | confirmed | contract + off-chain | Battle randomness is the raw, already-public drand beacon: any player can reconstruct the seed and foresee every crit, variance roll and enhanced proc |
| [C-01](./2026-09-19-post-june-delta-findings.md#c-01) | Medium | Medium | confirmed | off-chain | API login signature is not bound to any site, chain or nonce, and a session token can be renewed forever: one phished signature lets an opponent forfe |
| [D-02](./2026-09-19-post-june-delta-findings.md#d-02) | Medium | High | confirmed | contract | Compromised Faucet ELIGIBILITY hot key exceeds its documented 70M blast radius: lobster claims are uncapped and free lobsters mine the 705M pool with  |
| [D-04](./2026-09-19-post-june-delta-findings.md#d-04) | Medium | Medium | confirmed | contract | A 10% dispute bond (250 CLAW at Low) lets either participant -- including the proposed winner -- freeze the opponent's payout AND lock their whole tea |
| [D-05](./2026-09-19-post-june-delta-findings.md#d-05) | Medium | Medium | confirmed | contract | The 5-per-24h dispute rate limit also caps an honest player's veto, and upheld disputes never give the slot back: under a lying RESOLVER (or a buggy e |
| [D-06](./2026-09-19-post-june-delta-findings.md#d-06) | Medium | Medium | confirmed | contract | A stolen RESOLVER key can settle a battle the instant teams are revealed, so the dispute window (5 min at Low) runs out while the honest battle is sti |
| [D-07](./2026-09-19-post-june-delta-findings.md#d-07) | Medium | Medium | confirmed | contract + off-chain | The public battle API publishes the first revealer's teamId and salt before the on-chain atomic reveal, turning the costless reveal-timeout cancel int |
| [D-09](./2026-09-19-post-june-delta-findings.md#d-09) | Medium | Medium | confirmed | contract | Staging next week's boost table overwrites each team's live entry, so every re-posted team mines with 0% boost until activation -- the role policy and |
| [D-03](./2026-09-19-post-june-delta-findings.md#d-03) | Low | Medium | confirmed | contract | Draws pay no protocol fee but still count as a battle 'played' for the mining boost, so two cooperating wallets can farm boost qualification (and park |
| [D-08](./2026-09-19-post-june-delta-findings.md#d-08) | Low | Medium | contested | contract | A compromised MATCHMAKER key can do more than 'spam-create battles': deposit(battleId) binds no consent to stake, opponent or power, and the honest AP |
| [D-10](./2026-09-19-post-june-delta-findings.md#d-10) | Low | Medium | confirmed | contract | Faucet lobster DNA is fully predictable and grindable by any eligible wallet; the documented EOA-only whitelist mitigation does not work |
| [D-11](./2026-09-19-post-june-delta-findings.md#d-11) | Low | Medium | confirmed | contract | A mistyped or wrong-chain GOVERNANCE_SAFE permanently bricks admin on all 7 AccessControl contracts: Handoff grants and revokes in one run with no pro |
| [D-12](./2026-09-19-post-june-delta-findings.md#d-12) | Low | Medium | confirmed | contract + off-chain | Settlement hashes cover only data the server wrote, so a fabricated log verifies cleanly and the multisig cannot tell a real forfeit or timeout from a |
| [D-13](./2026-09-19-post-june-delta-findings.md#d-13) | Low | Low | confirmed | contract | The last depositor chooses when the 30-second commit clock starts and can make an honest opponent lose the 5% anti-grief deposit at no cost to themsel |
| [D-14](./2026-09-19-post-june-delta-findings.md#d-14) | Low | Low | confirmed | contract | A junk team commit (or invalidating the team after commit) converts the slashable commit-timeout into the costless reveal-timeout: deliberate pre-batt |
| [D-15](./2026-09-19-post-june-delta-findings.md#d-15) | Low | Low | confirmed | contract | In V3 the 5% anti-grief deposit is never slashed for in-battle misconduct: the off-chain 3-timeout/resign forfeit settles as an ordinary loss, so deli |
| [D-17](./2026-09-19-post-june-delta-findings.md#d-17) | Low | Low | confirmed | contract | Queued team is not bound on-chain or in the API: a multi-team player can counter-pick after the opponent's identity and power are published, and a sin |
| [D-18](./2026-09-19-post-june-delta-findings.md#d-18) | Low | Low | confirmed | contract | Glide day count excludes the current day: a crowded season is paced over 59 days, the budget runs dry a day early and nobody can mine on day 60; one b |
| [D-19](./2026-09-19-post-june-delta-findings.md#d-19) | Low | Low | confirmed | contract | The on-chain glide (epoch-0 blind spot, one-day demand lag, -30%/day clamp) was never modelled: a demand step drains most of the season budget before  |
| [D-20](./2026-09-19-post-june-delta-findings.md#d-20) | Low | Low | confirmed | contract | startSeason does not bound totalEmission by the remaining 705M lifetime allocation, so the glide paces against a budget that cannot be minted |
| [D-21](./2026-09-19-post-june-delta-findings.md#d-21) | Low | Low | confirmed | contract | A committed breed is forfeited entirely after the 256-block (~8.5 min) blockhash window, and the keeper the F5-02 fix relies on does not exist in the  |
| [D-22](./2026-09-19-post-june-delta-findings.md#d-22) | Low | Low | contested | contract | A third-party finalizeBreed caller can starve the offspring mint of gas so the try/catch permanently consumes a victim's breed (contract requesters wi |
| [D-23](./2026-09-19-post-june-delta-findings.md#d-23) | Low | Low | confirmed | contract | Handoff's 'deployer fully de-privileged' check misses ClawToken MINTER_ROLE and hot roles, and never checks that Configure finished or that the check  |
| [D-24](./2026-09-19-post-june-delta-findings.md#d-24) | Low | Low | confirmed | contract | After Handoff prints 'complete', the deployer hot key still owns Treasury, can overwrite the Safe's pending transfer and freeze payouts, and still hol |
| [D-25](./2026-09-19-post-june-delta-findings.md#d-25) | Low | Low | contested | contract + off-chain | The role matrix after Handoff contradicts the engine: season auto-rollover signs startSeason with the OPERATOR hot key, which no longer has -- and mus |
| [D-26](./2026-09-19-post-june-delta-findings.md#d-26) | Low | Low | confirmed | contract | Mainnet hot-key separation checks leave out BOOST_ADMIN, ELIGIBILITY_OPERATOR and the Safe, while the server defaults every role to one shared OPERATO |
| [D-27](./2026-09-19-post-june-delta-findings.md#d-27) | Low | Low | confirmed | contract + off-chain | No rules or engine version is committed or recorded, so after a balance patch an honest log no longer replays and the verification code can be chosen  |
| [D-28](./2026-09-19-post-june-delta-findings.md#d-28) | Low | Low | confirmed | contract + off-chain | The settle job is enqueued non-atomically and never reconciled, so a lost enqueue or dead job turns a finished battle into a full refund after 3 hours |
| [D-16](./2026-09-19-post-june-delta-findings.md#d-16) | Info | Low | contested | contract | Dispute windows are pure wall-clock time, so a Base sequencer stall longer than the window removes the veto for battles settled just before it |
| [D-29](./2026-09-19-post-june-delta-findings.md#d-29) | Info | Low | confirmed | contract | Protocol-wide invariant suite never exercises repair since the glide peg shipped |
| [D-30](./2026-09-19-post-june-delta-findings.md#d-30) | Info | Low | confirmed | contract | Glide re-peg (TOK-G1) has no fuzz or invariant test; four branches are untested |
| [D-31](./2026-09-19-post-june-delta-findings.md#d-31) | Info | Low | confirmed | contract | Power binding and team-contention reverts in the rewritten revealTeams are never tested |

## Fix plan

Nothing is deployed, so every contract change is free today. Fixes are grouped so that pull requests do not collide in the same file.

1. **Battle randomness (D-01), first.** Seed = hash(drand round fixed by rule *after* the reveal, per-battle server secret, battle id). The secret's hash is committed on-chain in `revealTeams` and the secret is disclosed and checked in `settle`, so neither a player nor the operator can know or choose the rolls in advance, and a dispute can still reproduce them. Stop shipping seed-derived values to clients. Related: D-27 (commit a rules version), D-12.
2. **BattleArena dispute and settle hardening (D-04, D-05, D-06, D-13, D-14, D-15, D-16).** A minimum time before `settle`, dispute slots returned when a dispute is upheld, and a narrower team lock while a dispute is open. *Owner decision:* what a dispute may freeze.
3. **MiningPool (D-09, D-18, D-19, D-20, D-03).** Key the boost table by epoch so staging never touches the live row; fix the glide day count; bound a season by the remaining lifetime allocation. *Owner decision:* whether draws count as battles played.
4. **Faucet and breeding (D-02, D-10, D-21, D-22).** A hard cap on faucet lobsters; unpredictable faucet DNA; breed finalisation edge cases.
5. **API (D-07, C-01, D-17, D-28).** Keep revealed team ids and salts out of public reads until the on-chain reveal; replace the bare login string with EIP-4361; bind the queued team; reconcile lost settle jobs.
6. **Deploy and handoff scripts (D-11, D-23, D-24, D-25, D-26, D-08).** Prove the Safe exists before revoking; include minter and hot roles in the de-privilege check; transfer Treasury ownership inside the handoff; separate every hot key.
7. **Tests (D-29, D-30, D-31).** Invariant and fuzz coverage for repair under the peg, the glide, and the rewritten reveal.

Full write-ups — what goes wrong, the attack, the evidence, the suggested fix, each skeptic's reasoning and what limits the attack — are in **[2026-09-19-post-june-delta-findings.md](./2026-09-19-post-june-delta-findings.md)**.

## Info observations (not adversarially verified)

- **D-32** Dispute tuning loose ends: proposals never expire and cannot be cancelled; the bond is read at dispute time, not settle time; an upheld dispute pays no penalty despite the docs — contracts/BattleArena.sol:643-658 and 690-705 (enact*); :528 (bond read at dispute); :594-596 (refund only)
- **D-33** Minor state-machine loose ends: a zero commit hash emits TeamCommitted without committing; emergencyWithdraw is unreachable before handleTimeout — contracts/BattleArena.sol:372-393, 748-759
- **D-34** BOOST_ADMIN blast radius is slightly wider than documented: renewable TTL, can zero honest boosts, indirectly moves baseReward and repair prices, and power is not range-checked — contracts/MiningPool.sol:382-392 (setTeamBoosts validates only bps); :397-403 (activateBoostEpoch has no minimum interval)
- **D-35** Faucet closure and the burn-only pre-commitment rest on an unconstrained, event-less setCloseTime: the window can be shortened, burned, and re-opened; only three example tests cover the burn path — contracts/Faucet.sol:76-78 (setCloseTime: no bounds, no monotonicity, no event); :159-164 (burnUnclaimed gated only on closeTime)
- **D-36** Marketplace 2.5% fee is voluntary: lobsters transfer freely, so agents can settle sales through any zero-fee swap contract — contracts/Marketplace.sol:145-178 (fee taken only inside buyLobster); contracts/LobsterNFT.sol:289-318 (_update restricts only soulbound and
- **D-37** No invariant test exercises MiningPool and BattleArena against the same teams, so the shared 'active' flag's mutual exclusion is only proven by reading the code — contracts/TeamManager.sol:137-141 (single shared active flag, two ACTIVITY_ROLE writers)
- **D-38** GovernanceHandoff.t.sol checks a hand-built fixture, not what Deploy.s.sol and Configure.s.sol actually produce — contracts/test/GovernanceHandoff.t.sol:17-36; contracts/test/helpers/BaseSetup.t.sol:147-183
- **D-39** Binding-layer observations: ABI matches the contract; stale indexer 'forfeit_loss' inference; doc drift on signature/VRF; notes on the settlement hash design — apps/indexer/src/watchers/battle-watcher.ts:497-501, 306-309
- **D-40** Boost-bound invariant I-6 compares every reward against the highest base ever seen, so it rarely binds — contracts/test/invariant/InvariantMiningPool.t.sol:114-125
- **D-41** Arena conservation invariant cannot reach the forfeit or one-sided-deposit paths, and its ghost counters are never asserted — contracts/test/invariant/handlers/BattleArenaHandler.sol:125-145 (both commits in one call); :93-108 (both deposits in one call)

## What was examined and found sound

### BattleArena fund conservation

Scope: BattleArena fund conservation at /Users/alepore/Clawbada-engine, HEAD 7ca5451. Read-only review; I did not run forge.

I read contracts/BattleArena.sol in full (1,064 lines) and Treasury.sol in full. I also read the relevant parts of MiningPool.sol, TeamManager.sol, LobsterNFT.sol, EvolutionLab.sol and Configure.s.sol, the invariant suite, the V3 engine's draw logic, the settle job, and the indexer and boost draw handling.

**Conservation: I found no double-pay, wrong-party payment, stranded funds or dust.**

Inflows. There are exactly two.
- `deposit()` pulls stake + 5% antiGrief (BattleArena.sol:359-361). Per-player `depositA`/`depositB` flags prevent a double deposit.
- `disputeBattle()` pulls the bond, snapshotted to `disputeBondPaid` (529-535).

Outflows, per battle.
- Win (893-950): fee 0.2S to Treasury, winner 1.8S + g, loser g. Total 2S + 2g, exact.
- Draw (907-919): two refunds of (S + g). Exact, no fee. See the Medium finding.
- `_cancelBattle` (991-1011): refunds S + g per deposit flag. Reached from the Deposit timeout, the both-uncommitted commit timeout, the reveal timeout, ACTIVE_WINDOW expiry and `emergencyWithdraw`.
- `_forfeit` (1013-1037): reachable only from TeamCommit, where both players have necessarily deposited. g goes to Treasury, S to the forfeiter, S + g to the other player. Total 2S + 2g.
- Bond (584-605): struct fields are cleared first (CEI), then the bond is refunded or slashed exactly once, and only together with the payout.

Every terminal path sets the phase to Settled or Cancelled before any transfer. Every token-moving entrypoint is `nonReentrant`. `handleTimeout` rejects terminal phases (715), so nothing can pay twice.

Rounding.
- `STAKE_BRACKETS` are constructor constants with no setter (2,500 / 10,000 / 50,000 e18).
- `createBattle` rejects any other stake, so an odd stake is unreachable. The 5% and 10% computations are exact and leave no dust.
- Treasury sends the burn remainder to dev (Treasury.sol:113-114).
- Bonds between 1 and 9,999 wei are blocked at propose time (BA-M3, 683).

ACTIVE_WINDOW.
- `settle` is allowed when timestamp <= deadline. `handleTimeout` requires timestamp > deadline (488 vs 721). The two are mutually exclusive, so there is no settle/cancel race inside a block.
- The cancel path releases both teams and refunds in full.
- A player cannot force the expiry. The maximum stall is 100 turns x 60s, about 100 minutes, against a 3-hour window.
- The loser-cancels-after-resolver-outage case is already documented in the delta note, and I found no new consequence.

Payout brick risks checked.
- `_applyDamage` and `_releaseTeam` tolerate deleted teams (TM-01).
- `setDamage` reverts on a burned lobster. Team lobsters are locked, and EvolutionLab refuses locked fuel and targets (EvolutionLab.sol:67,99).
- An active team cannot be disbanded. MiningPool cannot deactivate a battle team: `startExpedition` requires the team to be inactive and have no open expedition, and a battle reveal requires the team to be inactive.
- I found no unprivileged brick.
- If the Treasury owner de-authorized the arena, wins and forfeits would stall. Draws and cancels would still work, and the stall is reversible. This is owner-only and within the documented trust model.

Hot keys.
- The resolver can only name playerA, playerB or a draw, and its proposal is disputable.
- The matchmaker cannot move funds. Deposits are `msg.sender`-only.
- Neither key exceeds its documented blast radius on this surface.

Invariant.
- `invariant_arenaBalanceEqualsEscrow` (InvariantBattleArena.t.sol:161-184) asserts exact equality.
- The handler exercises wins, draws, both dispute directions, timeouts and `emergencyWithdraw`.
- It does not model one-sided commit forfeits as a separately targeted path. They are reachable only incidentally through `handler_handleTimeout`.

Not checked: fee-on-transfer or rebasing behaviour. ClawToken is a plain OZ ERC20 with no transfer hooks, so this is not applicable. The arena has no sweep for CLAW sent to it by mistake; such tokens would be stuck, but they do not affect per-battle accounting.

One anomaly to flag. The first Bash result in this session had text appended after the command output. It was formatted as MCP server instructions plus an "auto mode" directive to do file work through Bash. It arrived inside a tool result, not from the user or the harness, so I did not act on it. The audit stayed read-only.

### BattleArena state machine and time

Scope read in full at /Users/alepore/Clawbada-engine (main, 7ca5451): contracts/BattleArena.sol (all 1064 lines), contracts/TeamManager.sol, the expedition lifecycle of contracts/MiningPool.sol (240-372), LobsterNFT burn/setDamage/getters, EvolutionLab lock guards, Treasury.processFee, ClawToken surface, plus docs/audits/2026-09-05-v3-settle-delta.md, the F5-01 section of 2026-06-10, 2026-05-01 summary, docs/runbooks/admin-roles.md and battle-session.md, and the off-chain pieces that determine on-chain timing (apps/api battle-session manager, indexer battle-watcher, game-logic v3 turn/specials/layout). No forge commands run, no files modified.

Phase/transition map verified (caller / phase / deadline):
- None->Deposit: createBattle, MATCHMAKER, monotonic nextBattleId++ (325) - no battleId reuse, structs never deleted.
- Deposit: deposit() participant, ts <= phaseDeadline (348); second deposit -> TeamCommit (+30 s). Timeout: handleTimeout ts > deadline (721) -> _cancelBattle refunds only flagged deposits (999-1004).
- TeamCommit: commitTeam participant, ts <= deadline (376), one commit per side; both -> TeamReveal (+20 s). Timeout -> mutual cancel or _forfeit of the non-committer.
- TeamReveal: revealTeams RESOLVER only, ts <= deadline (420), atomic; timeout -> full-refund cancel.
- Active: settle RESOLVER, ts <= phaseDeadline (484); handleTimeout ts > phaseDeadline -> StaleBattle cancel; emergencyWithdraw participant at +24 h (dead in practice).
- AwaitingFinalize: disputeBattle participant ts <= payoutDeadline (518), once (519); finalizeBattle/handleTimeout anyone ts > payoutDeadline and !disputed (546-547, 721, 735); adminResolveDispute admin only if disputed (569).
- Settled/Cancelled terminal: every entrypoint goes through _requirePhase or the explicit terminal check at 715, so no transition can run twice.

Deadline comparisons: every action uses `ts > deadline -> revert` and every timeout uses `ts <= deadline -> revert`, for both phaseDeadline and payoutDeadline. The normal path and the timeout path are therefore mutually exclusive at every timestamp including equality; no off-by-one lets both succeed, and within one block ordering decides with a consistent end state. ACTIVE_WINDOW: a resolver cannot settle after expiry (484), a player cannot force the Active timeout while a settle is still valid (721), and settle() makes no external call so a player cannot make it revert; stake brackets are constructor-only (283-285) so _stakeBracket in settle/dispute cannot start reverting for in-flight battles. Worst-case honest battle length (100 turns x 60 s, non-consecutive stalling) is ~100 min < 3 h, so a player cannot stall a loss into a StaleBattle refund without a server outage (accepted in the delta note).

Sticky states: none reachable by an unprivileged actor. _executePayout/_cancelBattle cannot be bricked by players: locked lobsters cannot be burned or evolved (LobsterNFT.sol:153, EvolutionLab.sol:67,99), active teams cannot be disbanded (TeamManager.sol:108), MiningPool can only clear `active` for a team with a live expedition and cannot start one on an active team (MiningPool.sol:253-254, 321-331), so the shared `active` flag cannot be flipped under a battle; deleted-team tolerance (962, 986) holds; ClawToken is plain OZ ERC20 (no hooks, pause or blacklist) so push payouts cannot be refused; bond floor (682) keeps Treasury.processFee from reverting on slash. The only sticky state is the documented disputed+AWOL-admin case (I report its undocumented team-lock cost as Low).

CEI/reentrancy: deposit, disputeBattle, finalizeBattle, adminResolveDispute, handleTimeout, emergencyWithdraw are nonReentrant and set flags/phase before transfers; revealTeams/settle/commitTeam/createBattle lack the guard but either make no external call or call only TeamManager/LobsterNFT, which have no callback into the arena. Same team in two battles is blocked by teamInBattle + team.active at reveal (867-870); teamIdA == teamIdB impossible because owners must differ. Commit preimage uses fixed-width encodePacked fields, no collision. Compromised MATCHMAKER cannot move funds (deposit is msg.sender-pulled); bad power values only cause a refunding cancel.

Findings are outside the pure transition logic: predictable/unbound battle RNG (Medium, off-chain + missing on-chain binding), anti-grief deposit no longer deterring deliberate stalls (Low), fee-free draws counting toward boost qualification (Low, cross-contract), dispute veto erosion under a leaked resolver key (Low), dispute-as-team-lock (Low), and two Info loose ends. Known items 1-9 were not re-reported. Not examined: BattleVRF internals, RepairShop, boost math, deploy scripts (other agents' surfaces); test suites were only listed, not executed.

### Dispute system

I found no Critical or High issue on the dispute surface. There are two Medium griefing/backstop issues, two Low items and one Info item. I read contracts/BattleArena.sol at 7ca5451 in full for the dispute surface (lines 60-180, 250-345, 405-1064), plus Treasury.processFee, LobsterNFT.setDamage and burn, the TeamManager active guards, ClawToken, the indexer and engine draw and participation paths, docs/audits/2026-05-01-v3-s1-campaign.md, 2026-09-05-v3-settle-delta.md and docs/runbooks/admin-roles.md. I ran no forge commands and made no edits.

Two notes on the run. The first Bash tool result had text appended after the command output, telling me to route all work and file edits through Bash with sed and heredocs. It arrived inside a tool result, not from the user or the harness, so I ignored it. Separately, I did not read the test suites to confirm whether "proposed winner disputes" or "slot consumed on an upheld dispute" are covered, and I make no claim about that coverage.

**Areas I checked and found sound**

- **Rate-limit window arithmetic (823-856).** The cutoff is now − 24h and entries with ts <= cutoff are pruned. An entry made at t therefore frees up exactly at t + 24h, which matches the reported retryAt (845). The array is append-only with non-decreasing timestamps, so first-valid-index pruning is correct. Its length is bounded at 5 after pruning, so the compaction and pop loops cannot be bloated for gas. The cast to uint64 is safe. The activeDisputesFor view uses the same "> cutoff" predicate. Only the caller's own disputes are counted, so a third party cannot fill an honest loser's quota. A failed bond pull reverts the whole transaction, so no slot is consumed without a bond. The lock-out I did find comes from upheld disputes not returning slots (finding 1), not from the arithmetic.

- **Boundaries.**
  - Dispute is allowed while now <= payoutDeadline (518); finalizeBattle and handleTimeout require now > payoutDeadline (547, 721). The ranges are disjoint with no gap.
  - settle requires now <= phaseDeadline (486); the StaleBattle cancel requires now > phaseDeadline (721). A late settle cannot race the cancel.
  - handleTimeout picks payoutDeadline for AwaitingFinalize (720).

- **Window snapshot.** payoutDeadline is fixed at settle (497), so enacting a new window never affects in-flight battles. The bond is snapshotted onto the struct at dispute time (531), so later tuning does not affect disputes already filed.

- **Front-running and blocking.**
  - Only participants can dispute (517), and only once per battle (519).
  - If the cheating side front-runs with its own dispute, the victim is not harmed: the admin still reviews the battle and the victim saves the bond.
  - Nobody can finalize before the deadline. After the deadline, finalize is permissionless through two entrypoints.
  - No participant can make payout revert, for three reasons. ClawToken has no hooks, blocklist or pause. Lobsters in an active team are locked and cannot be burned (LobsterNFT.sol:153, EvolutionLab.sol:67 and :99), so setDamage's existence check cannot be tripped. Active teams cannot be disbanded (TeamManager.sol:108), and a deleted team is tolerated by _applyDamage and _releaseTeam (954-989).
  - Only the Treasury owner de-authorizing the arena could block payouts that carry a fee. That is a governance action, out of scope for an unprivileged actor.

- **Fund flows in every adminResolveDispute branch.**
  - Upheld dispute (the admin changes the winner, either damage array or either hash): the bond is refunded to the disputer.
  - Rejected dispute (exact match): the bond goes to Treasury at 85/15.
  - Win outcome: the fee is 10% of 2 × stake, the winner gets 1.8 × stake plus their anti-grief, and the loser gets their anti-grief back. This sums to the escrow.
  - Draw, whether proposed or decided by the admin: both players get stake + anti-grief, no fee is taken, and damage is applied per player slot.
  - Win changed to a draw, or a draw changed to a win, both set disputerWon correctly.
  - A zero bond skips routing cleanly (587).
  - The BA-M3 floor (680) keeps the slash above the Treasury minimum. The default bonds are far above that floor.
  - The disputer and bond fields are cleared before any transfer (582-585). adminResolveDispute is nonReentrant, and the phase is set to Settled before external calls (902).

- **Tuning.** Propose and enact are DEFAULT_ADMIN-only, and bracket bounds are checked. The window must be between 60 s and 1 day / 3 days / 7 days by bracket. The bond must be 0, or at least 10,000 wei, and at most 20% of the bracket stake. Re-proposing resets the timer, and enact clears the pending values. Remaining weaknesses are in the Info finding.

- **Already-known items.** The AWOL-admin escrow trap is acknowledged in the NatSpec (55-57); I did not re-report it, and finding 2 is a distinct, cheaper variant that needs only the normal SLA. I also did not re-report items 1 to 9 from the task's known list.

### Hot keys and rational-agent economics in battle

Six findings: five Medium, one Low. The Solidity escrow logic is sound. The material problems sit where the contract's rules meet the off-chain stack and the mining boost. I worked read-only on /Users/alepore/Clawbada-engine at 7ca5451 and did not run forge.

**What I read**
- contracts/BattleArena.sol, all 1,064 lines.
- The battle-facing parts of TeamManager.sol and MiningPool.sol (startExpedition, claimExpedition, adminReleaseExpedition, boost).
- The roles, burn, setDamage and lock paths of LobsterNFT.sol, and Treasury.processFee.
- docs/runbooks/admin-roles.md, battle-session.md and boost-epoch.md.
- Both self-authored surface notes (2026-09-03, 2026-09-05), plus the 2026-05 and 2026-06 audit tables to avoid re-reporting.
- The off-chain pieces the contract's safety arguments depend on: the API combat routes, engine reveal-watcher, indexer battle-watcher, the boost epoch job, and the game-logic v3 turn, draw, damage, layout and serialize code.

**Checked and found sound**
- **Compromised RESOLVER, extraction per battle.**
  - settle (474-498) only accepts playerA, playerB or 0 as winner, so the thief must be a depositing participant.
  - The most it can take is the opponent's stake, which nets about 0.8 × stake after the fee.
  - It cannot forge a team: commit hashes bind battleId, player, teamId and salt (424-428).
  - It cannot move funds outside _executePayout or _cancelBattle, and cannot settle after ACTIVE_WINDOW (486).
  - A false draw or false damage can be disputed, and the bond is refunded on any changed field (587-592).
  - This matches the documented blast radius, except for the rate-limit ceiling reported as a finding.
  - It can force a multisig action on every battle it touches; there is no batch resolve. That is an operational load, not a loss of funds.
- **Compromised MATCHMAKER.**
  - It cannot deposit for a user and cannot lock teams or lobsters, because createBattle touches no player state.
  - Its power values must be true or revealTeams reverts into a refund (438-441).
  - The consent gap is reported as a finding.
- **The payout cannot be blocked by the loser.**
  - Lobsters in a team are locked, so burn reverts (LobsterNFT:153).
  - TeamManager has no edit function and disbandTeam reverts while the team is active.
  - Mining and battle share one active flag, and each side refuses to start while it is set (MiningPool:253-254, BattleArena:872-875).
  - claimExpedition can only clear the flag for a team with a live expedition, which cannot exist during a battle.
  - A deleted team is tolerated (958, 981).
  - All fee amounts clear the Treasury minimum.
- **Dispute and finalize timing.** A dispute is allowed while block.timestamp <= payoutDeadline and finalize only when it is greater (518, 551), so the two cannot overlap.
- **One dispute per battle.** The bond is a snapshot, routed exactly once, and cleared before any transfer.
- **Every path from Deposit, TeamCommit, TeamReveal and Active ends in full refunds or a one-sided anti-grief slash.** I saw no way to be paid twice. I relied on the repo's exact-conservation invariant rather than re-running it.
- **Free option at the reveal timeout.**
  - With no leak it is worth nothing: the opponent's address and power are known before deposit, and a teamId cannot change composition.
  - It gains value only through the API leak reported as a finding.
- **ACTIVE_WINDOW race.** The longest a player can stall is about 100 minutes, because three consecutive timeouts forfeit. The residual risk is a resolver outage, which is already documented.

**Accepted or already known**
- **Paid wash battles are an accepted cost.** Win-trading with a declared winner costs the 10% fee and is only flagged in telemetry. I treat that as design. The free draw path is the new problem.
- **Dispute-lock griefing.**
  - A loser can freeze the winner's payout and team until the admin acts, for the price of a bond (250 at Low).
  - That is the known AWOL-admin and dispute-stall class.
  - The only new consequence is that a locked team may miss the boost floor.
  - I judged it not worth raising the severity because the griefer's own team is locked too.
- **Pre-deposit no-show griefing costs nothing, by design.** Cancel-rate throttling is deferred.

**Not examined**
- MiningPool glide and boost arithmetic, BattleVRF, BattleResolver maths and the deploy scripts. Other agents own these.
- The WebSocket authentication of turn submissions.
- Whether the matchmaker enforces that the queued team equals the committed team. It does not appear to, since the reveal-team route checks only the hash, but Elo expected-score maths limits the rating gain.

### Team commit and atomic reveal (F5-01 final form)

I read the current main code at 7ca5451 in /Users/alepore/Clawbada-engine: `contracts/BattleArena.sol` in full, `TeamManager.sol`, `LobsterNFT.sol`, the expedition paths in `MiningPool.sol`, the lock guards in `EvolutionLab.sol` and `BreedingLab.sol`, and the role grants in `script/Configure.s.sol`. I also read the off-chain half of F5-01: the API `battle-writes.ts` and `battle-reads.ts`, `matchmaker/match.ts`, the engine `reveal-watcher.ts`, the db schema, and the e2e agent and web salt generation. No forge commands were run.

There are three findings: one Medium (the public battle API leaks the first revealer's team and salt before the on-chain reveal) and two Low (same-power counter-picking because the queued team is not bound, and the 5% anti-grief deposit being avoidable).

**What I checked and found sound**

1. **Reveal validation** (`revealTeams`, BattleArena.sol:411-461, and `_validateTeamForBattle`, :860-888).
   - Both commit hashes are checked against `keccak(battleId, player, teamId, salt)`. The encoding is fixed-width, so there is no packed-encoding ambiguity.
   - The player address is inside the preimage, so copying the opponent's commit hash cannot be opened.
   - A zero hash is treated as "not committed" and is harmless.
   - Each team must exist, be owned by the right player, not be in another battle, and not be active (which covers mining). Every lobster must be tier >= 1 and damage <= 79. Current power must equal the createBattle snapshot.
   - Both teams are validated before any state write, and both are locked in the same transaction.
   - The same player cannot be on both sides (:315). `teamIdA == teamIdB` is impossible because the two owners differ.
   - The resolver cannot forge a team because it needs the preimage.

2. **One team in two battles: not possible.**
   - `teamInBattle` and `team.active` are both checked at :867-870 and both set at :445-448, atomically.
   - A second battle that committed the same team simply cannot be revealed and cancels with refunds.
   - Mining and battle are mutually exclusive through the shared `active` flag (MiningPool.sol:253 and :302). Absent a compromised ACTIVITY_ROLE, neither side can clear the other's flag: `claimExpedition` and `adminReleaseExpedition` only touch a team that has an expedition.

3. **Lock and unlock lifecycle.**
   - Lobsters are locked at `createTeam` and unlocked only at `disbandTeam`. TeamManager is the sole LOCKER_ROLE holder (Configure.s.sol:91).
   - Teams are marked active at reveal and released on every exit: `_executePayout` for win and draw (reached from `finalizeBattle`, `handleTimeout` in AwaitingFinalize, and `adminResolveDispute`), and `_cancelBattle` for ACTIVE_WINDOW expiry and `emergencyWithdraw`.
   - `_forfeit` is now reachable only from the commit timeout, where no team is bound yet.
   - Deposit, commit and reveal timeouts never have a locked team to release, which is correct.
   - The only indefinite lock is a disputed battle with an absent admin, which is the documented open risk.

4. **What TeamManager allows during a live battle: nothing harmful.**
   - `disbandTeam` reverts while the team is active. There is no function to swap a team member.
   - Team lobsters are locked, so they cannot be transferred or listed (`_update`), burned as fuel, evolved (EvolutionLab.sol:67 and :99) or bred (BreedingLab.sol:287).
   - As a result a teamId's power and membership cannot change, and `_applyDamage` always hits the lobsters that fought.
   - The only mutation allowed mid-battle is `RepairShop.repair`, which is known item 6. I found no new consequence, because damage is only read at reveal.

5. **Between commit and reveal the team is not reserved** (this is tracker item X3, viewed from the contract side).
   - The owner can disband the team or send it mining, and the reveal then reverts, producing a free mutual cancel.
   - This is equivalent to simply withholding the salt, which F5-01 explicitly accepted. I reported it only as the Low finding that the anti-grief slash can always be avoided.
   - Damage cannot be raised by anyone except BattleArena settlement of that same team, so a third party cannot sabotage someone else's reveal.

6. **Hot keys on this surface.**
   - MATCHMAKER can only create battles that players must voluntarily fund.
   - RESOLVER can withhold a reveal, which gives a free cancel and no fund movement. It can also see both teams early, which the design accepts. It cannot bind a team a player did not commit.
   - Nothing on this surface exceeds the documented blast radius.

7. **Salt generation.**
   - The web client uses `crypto.getRandomValues` for salts, which is fine.
   - The e2e agent uses `keccak` of `Date.now` and `Math.random` (scripts/e2e/lib/agent.ts:116). That is weak as a seed for the Phase 3 agent kit, but brute-forcing it is impractical, so I did not file it.

**What I did not examine**

- The battle-session manager's start-of-battle read path.
- WebSocket payloads, beyond confirming that the reveal-team route itself broadcasts nothing.
- Settle, dispute and boost economics, which belong to other surfaces.

### MiningPool reward arithmetic and caps

Verdict for this surface: both hard caps hold, and reservations cannot diverge from mints. The three problems I found are in pacing and in the boost staging flow; all three are Low severity and none lets anyone over-mint or take funds.

I read contracts/MiningPool.sol in full at HEAD 7ca5451 (518 lines). I also read the parts it touches: TeamManager create/disband/setTeamActive, RepairShop pricing, ClawToken mint/burn, the role grants in Configure.s.sol and Handoff.s.sol, the 2026-09-03 boost surface note, the role policy in admin-roles.md, the boost-epoch runbook, gitbook mining.md, the off-chain model packages/game-logic/src/v3/season.ts, and the glide and boost unit tests in test/MiningPool.t.sol. I ran no forge commands. I wrote one throwaway Python port of the glide rule in the scratchpad to quantify the pacing findings.

What I checked and found sound:

1. **Reserve equals mint, so they cannot diverge.** The reward is computed, checked against both caps, added to season.totalMinted and lifetimeMinted, and minted into the pool's own balance, all inside startExpedition (MiningPool.sol:276-286). claimExpedition only transfers expedition.reward (line 335).
   - There is no claim deadline, season check or re-pricing at claim. A claim after the season ends, or during a gap between seasons, pays exactly the locked amount.
   - In-flight expeditions survive startSeason untouched: the struct stores its own season and reward.
   - Abandoned expeditions just sit in escrow. adminReleaseExpedition burns them after 4 h + 7 d and deliberately leaves both counters incremented (lines 117-120, 369), so a burn cannot reopen either cap.
   - There is no sweep or withdraw function, so the pool's balance is always at least the sum of unclaimed rewards.

2. **Cap checks bind on the boosted amount.** Both checks at lines 279 and 281 run on the final `reward`, after the boost and tier multiply. A boost cannot breach the season cap or the 705M lifetime cap.
   - ClawToken.MAX_SUPPLY cannot block mining within the 705M allocation: the premints total 295M, only MiningPool holds MINTER_ROLE (Configure.s.sol:74-77), and burns only add headroom.
   - A revert at 279 or 281 rolls back the earlier writes to epochWeightServed and the re-peg.

3. **Arithmetic.** boostedBase = baseReward * (10000 + bps) / 10000 truncates by less than 1 wei, in the protocol's favour. Multiplying by weights 1/3/10/25 afterwards keeps reward % weight == 0. The maximum magnitudes are nowhere near overflow. `power` as uint8 is at most 9. Demand is credited as weight * (BPS + bps), which matches the spend exactly; trailing = sum / BPS floors by less than one unit.

4. **Glide manipulation by unprivileged actors.** The only ways to move trailing demand are to start expeditions or to abstain.
   - Starting expeditions is ordinary mining, and each start pays the caller and is bounded by the caps.
   - Abstaining costs a full day's income for at most +30% the next day, capped at launch, so it loses money.
   - A team cannot fit 7 starts into one epoch, because 6 four-hour expeditions fill the day exactly. Shifting starts across the epoch boundary gains nothing.
   - repeg() gives no advantage over the lazy path, apart from the exact-boundary-second oddity noted in finding 1.
   - baseReward cannot get stuck at the 1-to-3 wei range, where a +30% step rounds to no change, because reaching it takes about 132 consecutive -30% steps and a season has 60 epochs.
   - setBaseReward above launch snaps back at the next re-peg (test at test/MiningPool.t.sol:1138).

5. **Boost binding.** Teams are immutable (TeamManager has only create and disband, and nextTeamId never reuses ids, lines 84 and 128-129), so a boost entry cannot be moved to other lobsters under the same teamId. One teamId can have only one active expedition, so a boost cannot be multiplied across expeditions. Power only changes through evolution, which zeroes the boost. Base-tier lobsters count as 0 Power, but every reachable Power and mine-tier combination pays less than or equal to the band where the rank was earned, so there is no laundering gain. A compromised BOOST_ADMIN is limited to +50% for chosen teams, paid from the same budget, which is the documented blast radius (admin-roles.md:126-131). Finding 3 does not extend it.

6. **Mutual exclusion with battle.** MiningPool and BattleArena both refuse an already-active team (MiningPool.sol:253, BattleArena.sol:870). MiningPool's claim cannot unlock a team that is bound to a battle, because the same flag blocked the battle from starting. The teamExists tolerance added for M-01 is still in both claim and adminRelease.

7. **First-expedition or faucet exemption.** No staking or exemption code exists anywhere in MiningPool. This is the known documentation error (item 9) and creates no new issue.

Not covered: BattleArena, RepairShop beyond its price read, the engine's boost job code, and runtime behaviour. I did not run forge, per the rules.

### Auto-glide, boost epochs and the repair peg

This was a read-only review at commit 7ca5451 in /Users/alepore/Clawbada-engine. I found one Medium issue, two Low and two Info. There is no Critical or High on this surface, and the documented +50% blast radius for a stolen BOOST_ADMIN key holds. No build or tests were run.

Files read in full:
- contracts/MiningPool.sol (518 lines) and contracts/RepairShop.sol (113 lines)
- docs/audits/2026-09-03-boost-surface.md and docs/runbooks/boost-epoch.md

Read in part:
- contracts/TeamManager.sol and contracts/LobsterNFT.sol (tier setter and getter)
- docs/runbooks/admin-roles.md (SEASON_ADMIN and BOOST_ADMIN sections)
- the glide and boost tests in test/MiningPool.t.sol
- apps/engine/src/boost/epoch-job.ts (stage and activate ordering)
- packages/game-logic/src/v3/season.ts (the glide model)
- role wiring in contracts/script/Configure.s.sol and Handoff.s.sol, by grep

**Glide (TOK-G1) — what holds:**
- **`repeg()` cannot be steered by timing or spamming.**
  - `_repegIfNeeded` runs at most once per epoch (MiningPool.sol:469).
  - `startExpedition` calls it before locking any reward (line 273), so no expedition can be priced on the stale rate inside a new epoch.
  - Its inputs are fixed at the epoch boundary: `remaining` and the previous epoch's demand. The single exception is the exact-boundary block, reported in the Low finding on the day count.
- **Demand cannot be faked.** Every credited weight unit costs exactly one `baseReward` of real mint. The credit on line 275 is rolled back by the budget reverts at 279 and 281. Expeditions cannot be cancelled, and a team can start at most 6 per epoch.
- **Starving or bursting demand does not pay.** Skipping a day loses more than the 30% step can return. With a fixed budget, an alternating whale's share strictly falls (worked through in the Info finding on the unmodelled glide).
- **No arithmetic traps.**
  - `remainingDays` is at least 1 (line 480).
  - `trailing` is at least 1 once any expedition has started, because `epochWeightServed` is at least 10,000; when it is 0 the function returns early (line 476).
  - `SEASON_DURATION - elapsed` cannot underflow, because both callers first require an active season (lines 247 and 449).
- **Reward floor.** `next` is floored at 1 wei. Within a 60-day season the rate cannot fall below roughly `launch × 0.7^59`, about 9e11 wei, so RepairShop's zero-rate revert (`RewardPegUnset`) is unreachable in-season.
- **Season rollover.** `startSeason` resets every glide field (lines 209-218). Old-season expeditions stay claimable, because rewards are escrowed at start.
- **`setBaseReward` override.**
  - It is governance-only (SEASON_ADMIN, multisig).
  - A value above launch snaps back at the next repeg (pinned by test at MiningPool.t.sol:1138).
  - A low value is pulled back up by 30% per day, so the override lasts less than a day by design.
  - An absurdly large value would overflow `old * 13_000` in `_repegIfNeeded` and block `startExpedition` and `repeg` until reset. I treat that as admin error, not a finding.

**Boost table — what holds:**
- **Epoch gating.**
  - The requested epoch must be `current` or `current+1`, and epoch 0 is rejected (line 384).
  - Activation must be exactly `current+1` (line 399).
  - A stale entry can never come back to life, because epochs only increase and the match is exact (line 503).
- **TTL.** The boundary is exact: the boost reads 0 from `activatedAt + 10 days` onward (line 501).
- **Batch cap.** At most 200 rows per call, as pure storage writes with no external calls.
- **Power binding.**
  - A team's lobsters are fixed for the life of its ID: TeamManager has only create and disband, and `nextTeamId` only increases (TeamManager.sol:61-129).
  - An entry therefore cannot be moved onto other lobsters, and a disbanded ID is never reused.
  - Power can only change through evolution (capped at tier 3, LobsterNFT.sol:184-188), and any change zeroes the boost.
  - The `uint8` power sum cannot overflow; its maximum is 9.
- **Budget.** The boosted reward passes through the same season-budget and 705M lifetime checks. The reward stays an exact multiple of the tier weight. Glide demand and spend are scaled the same way, so the boost is not double-counted.
- **A stolen BOOST_ADMIN key stays inside the documented radius.** The most it can take is +50% on the attacker's own mining, paid for by diluting everyone else. The nuances are in the Info finding on the blast radius.

**RepairShop peg — what holds:**
- The rate is read at call time from `currentBaseReward()`. Timing a repair around a repeg moves the price by at most 30% per day, and never above `320 bps × launch`, which is 40 CLAW per point.
- An unprivileged player cannot make repair nearly free: the only path to a collapsed rate is sustained real demand or an exhausted budget.
- Before season 1 the rate is 0 and `repair` reverts `RewardPegUnset`. That is safe; it blocks repairs but does not make them free.
- Between seasons the rate is frozen at the last value, then jumps to whatever launch reward the admin passes to `startSeason`.
  - That gives a predictable repair-timing opportunity.
  - It is priced by the admin's choice of launch reward, so it is a design matter, not a bug.
- The MiningPool address is fixed in the constructor with no setter, so the peg source cannot be swapped.
- Reentrancy: `repair` is `nonReentrant`, and its only external calls go to Treasury and LobsterNFT, both trusted.

**Not examined:**
- BattleArena, the EvolutionLab locking rules, and the known `isLocked` gap in RepairShop. These are other agents' surfaces or on the already-known list.
- The invariant handlers, which I only surveyed.
- The off-chain rating and ladder computation.

### Role matrix and deploy scripts

**Scope.** I read Deploy.s.sol, DeployHelpers.s.sol, Configure.s.sol and Handoff.s.sol in full, plus every AccessControl and Ownable use across the 12 contracts. I also read GovernanceHandoff.t.sol, BaseSetup.t.sol, admin-roles.md, deploy.md (API/web deployment only, nothing about contracts), the faucet, role and handoff coverage in the prior audits, and the engine's signer selection and season manager. All code was read from /Users/alepore/Clawbada-engine at commit 7ca5451. I ran no forge commands.

**Tool-output note.** The first Bash result had extra text appended after the command output. It was styled as system/MCP instructions and told me to do all file reads and edits through Bash with sed and heredocs. It arrived inside a tool result, not from the user, so I did not act on it and kept to the read-only rules.

**Role matrix after Deploy.**
- The deployer holds DEFAULT_ADMIN on ClawToken, LobsterNFT, TeamManager, MiningPool, BattleArena, BattleVRF and Faucet, and owns Treasury.
- The deployer holds 125M CLAW (the LP allocation). TREASURY_RESERVE_ADDRESS holds 100M.
- BreedingLab, EvolutionLab, RepairShop and Marketplace have no admin, owner or setters.

**Role matrix after Configure.**
- ClawToken MINTER_ROLE: MiningPool only. The deployer gets an ephemeral grant, mints 70M to the faucet, and is revoked.
- LobsterNFT roles:
  - MINTER: Faucet and BreedingLab.
  - LOCKER: TeamManager.
  - EVOLVER and BURNER: EvolutionLab.
  - DAMAGE: BattleArena and RepairShop.
  - BREED: BreedingLab.
- TeamManager ACTIVITY: MiningPool and BattleArena.
- MiningPool: SEASON_ADMIN goes to the deployer, BOOST_ADMIN to the env address.
- BattleArena: MATCHMAKER and RESOLVER go to the env addresses.
- BattleVRF: OPERATOR goes to the env address.
- Faucet: ELIGIBILITY goes to the deployer.
- Treasury: the token is set, and BreedingLab, Marketplace, EvolutionLab, RepairShop and BattleArena are authorized.

**Role matrix after Handoff.**
- The Safe holds DEFAULT_ADMIN on all 7 contracts and SEASON_ADMIN.
- ELIGIBILITY_OPERATOR holds ELIGIBILITY.
- The deployer keeps Treasury ownership until the Safe calls acceptOwnership, and keeps the 125M CLAW.
- On testnet only, the deployer also keeps whichever hot roles defaulted to it.

**What I checked and found sound.**
- **No hot key can grant roles.** A grep for _setRoleAdmin returns nothing, so DEFAULT_ADMIN is the sole admin of every role.
- **CLAW minting.** Only MiningPool mints after Configure. Anyone can burn their own tokens (ERC20Burnable). Treasury, MiningPool.adminReleaseExpedition and Faucet.burnUnclaimed also burn.
- **Supply arithmetic.** 125M + 100M + 70M + 705M equals the 1B cap exactly, so the faucet pre-mint does not eat the mining allocation.
- **Minting past 705M.** Headroom that burns reopen under MAX_SUPPLY is reachable only by a Safe-granted minter. That is the accepted C-05 class. MiningPool itself is bound by lifetimeMinted.
- **Configure re-runs.** Treasury.setClawToken reverts on a second run (TokenAlreadySet) and is Configure's first call, so a full re-run aborts before the second 70M mint or a second startSeason. startSeason also reverts with SeasonStillActive.
- **Mainnet env checks.** They correctly require matchmaker, resolver, vrfOperator, boostAdmin and reserve, and require reserve and devWallet to differ from the deployer. Testnet fallbacks are gated on chainid != 8453. Unknown chain IDs revert in _networkName.
- **.env.example placeholders.** The '0x' placeholders make vm.envOr fail to parse, so they do not silently default to the zero address.
- **TOK-H1.** The assertion is present: Treasury's balance must be 0 and the reserve recipient must not be Treasury.
- **Stale deployment files.** A stale deployments/<network>.json pointing at addresses with no code makes Configure and Handoff revert at the high-level call's extcodesize check. The e2e harness backs up base-sepolia.json.
- **Treasury.** processFee pulls only from msg.sender, so a rogue authorized account cannot take third-party funds.

**Minor notes not filed as findings.**
- Faucet closeTime is fixed at Deploy time (7 days, against the documented 6d23h), while the Season 1 clock starts at Configure. A gap between the two silently shortens the faucet window. The admin can correct it with setCloseTime.
- Handoff's _loadEnv needlessly re-requires the hot-key env variables on mainnet.
- Configure's closing log miscounts the role grants.
- The README deploy command uses a stale script path.
- BaseSetup still grants ClawToken MINTER_ROLE to Faucet.

### Cross-contract lock and NFT invariants

Scope read in full at /Users/alepore/Clawbada-engine (main, 7ca5451): contracts/LobsterNFT.sol, TeamManager.sol, Marketplace.sol, EvolutionLab.sol, RepairShop.sol, BreedingLab.sol (request/finalize/cancel/validate), MiningPool.sol (expedition lifecycle, boost, glide), BattleArena.sol (create/deposit/commit/revealTeams/settle/dispute/finalize/adminResolve/handleTimeout/emergencyWithdraw/_executePayout/_applyDamage/_releaseTeam/_cancelBattle/_forfeit), Faucet.sol claims, contracts/script/Configure.s.sol role wiring, invariant test inventory, prior audits and runbooks. TeamManager and LobsterNFT are byte-identical to the last audited commit (git diff --stat b3eecde..HEAD shows no change to either).\n\nEvery lock/unlock call site: LobsterNFT.setLocked is called only by TeamManager.createTeam (TeamManager.sol:95) and disbandTeam (:114); LOCKER_ROLE is granted only to TeamManager (Configure.s.sol:91). Team.active is written only by MiningPool (start :302, claim :330, adminRelease :365) and BattleArena (revealTeams :447-448, _releaseTeam :987); ACTIVITY_ROLE is granted only to those two.\n\nConcluded sound, with reasons:\n1. No permanently frozen NFT on any unprivileged exit path. Mining: claimExpedition has no season dependency and tolerates a deleted team; adminReleaseExpedition is the key-loss backstop. Battle: every terminal path (draw, win, cancel, forfeit, reveal timeout, ACTIVE_WINDOW stale cancel, emergencyWithdraw) reaches _releaseTeam exactly once because the phase is set terminal first and teamRevealedA/B are only ever set together in revealTeams. Deposit/commit/reveal-timeout paths never locked a team, so they have nothing to release. The only unbounded lock is the disputed state (known; new consequence reported above).\n2. No double-lock where one unlock frees both. MiningPool refuses to start if team.active (:253) or an expedition is linked (:254); BattleArena refuses to reveal if teamInBattle or team.active (:867, :870). Each contract only clears the flag for a team it activated itself, so by induction a team is never simultaneously mining and battling; team IDs are never reused (nextTeamId++), so a stale release cannot hit a new team.\n3. A committed lobster cannot be transferred, sold, burned, evolved or bred: team membership sets locked at creation, teams have no edit function (only create/disband), disband reverts while active, and locked is checked in _update for single AND batch transfers (LobsterNFT.sol:293-304), in burn (:153), in EvolutionLab for target and fuel (:67, :99) and in BreedingLab (:287). Because team lobsters cannot evolve, a team's Power is immutable for the life of its teamId, so the F-04 power binding and the Power-bound boost entries cannot be gamed by editing a live team.\n4. Between commitTeam and revealTeams the team is NOT locked; a player can disband it or send it mining so revealTeams reverts. Outcome is identical to withholding the salt: costless mutual cancel, which is the documented F5-01 design (fable5 report line 58). No information is gained, so no new consequence.\n5. Marketplace: listing escrows the token (owner becomes Marketplace), so a listed lobster cannot be teamed, bred, evolved, used as fuel or repaired by the seller (all check ownerOf == msg.sender); locked/soulbound tokens cannot be listed because the escrow transfer reverts in _update; the receiver hook only accepts self-initiated single transfers and rejects batches (Marketplace.sol:214-233), so operators cannot blackhole tokens. No state of an escrowed lobster can be mutated by anyone (breed count, tier, damage all require ownership or team membership).\n6. Pending breed request: parents are not locked, but DNA and generation are cached in the request (BreedingLab.sol:123-150) and finalize never re-reads the parents, so selling or burning a parent after requestBreed is harmless; offspring always goes to the requester.\n7. Soulbound: enforced in _update for both safeTransferFrom and safeBatchTransferFrom regardless of approvals; mint/burn are the only exemptions and burn is role-gated to EvolutionLab which checks ownership. Soulbound-to-tradeable value via evolution fuel/breeding and smart-wallet ownership transfer are previously accepted design items, not re-reported. L-01 amount==1 guard blocks the zero-value ownerOf hijack and duplicate-id batch tricks fail on balance.\n8. Hot keys vs NFTs: RESOLVER cannot lock an arbitrary victim's team because revealTeams needs the preimage of a hash the player committed from their own address and the team must be owned by that player (BattleArena.sol:424-427, 862-864); MATCHMAKER cannot lock anything (createBattle touches no team). Resolver-proposed damage is bounded to 100 and disputable. Nothing here exceeds documented blast radius.\n9. Nothing in the RepairShop class that is worse: the only other lobster mutators without an isLocked check are BattleArena.setDamage (intentionally on locked team lobsters) and the dead decrementBreedCount (known). Repairing during the AwaitingFinalize window cannot dodge damage because damage is applied additively at payout, capped at 100.\n\nNot examined (other agents' surfaces): glide/boost economics, Treasury, BattleVRF, BattleResolver math, deploy/handoff ordering, off-chain services. One economic observation passed along without analysis: RepairShop rates are a bps of MiningPool.currentBaseReward (RepairShop.sol:71-73), so when the season budget runs out and the glide decays 30%/day the repair sink shrinks toward zero with it; and repair reverts RewardPegUnset if the rate rounds to 0 (needs baseReward < 250 wei, not reachable within one 60-day season by the clamp alone).

### Breeding, evolution, repair, faucet, market, treasury in final form

I read the current code at /Users/alepore/Clawbada-engine (HEAD 7ca5451) and ran no forge commands. All gas figures in the findings are estimates from the source, not measurements.

**Files read in full:** BreedingLab.sol, EvolutionLab.sol, RepairShop.sol, Faucet.sol, Marketplace.sol, Treasury.sol, ClawToken.sol, LobsterNFT.sol, DNALib.sol, BattleVRF.sol, TeamManager.sol, Configure.s.sol.

**Files read in part:**
- MiningPool.sol: startExpedition, claimExpedition, the glide re-peg and the season functions.
- BattleArena.sol: team validation, payout, damage application and team release.
- Deploy.s.sol, DeployHelpers.s.sol and Handoff.s.sol: the treasury, faucet and role wiring.
- docs/runbooks/admin-roles.md and the prior audits in docs/audits/.

**BreedingLab — sound except for the two Low findings (expiry forfeit, gas-starved mint):**
- **No outcome-selective re-roll or slot refund survives F5-02.**
  - cancelExpiredRequest (223-241) only sets `finalized`. It refunds neither the fee nor the breed slot.
  - LobsterNFT.decrementBreedCount has no caller in contracts/.
  - Rejecting the mint through a reverting receiver hook still spends the request, the fee and both slots (184, 198-203).
- **Entropy cannot be chosen by the requester.**
  - The seed is keccak(blockhash(requestBlock+2), requestId), unknown when the breeder commits.
  - requestId is a global counter, so the requester does not pick it.
  - Only the sequencer could influence it, and the sequencer is outside the threat model.
- **The B-01 boundary is correct.** Both finalize and cancel use `<=` against targetBlock (169, 231).
- **The F5-03 boundary is correct.**
  - getBreedCostPerParent reverts cleanly at breedCount >= 5.
  - State-changing paths are gated earlier by _validateParent.
- **Cost schedule and generation multiplier are correct.**
  - Each parent is priced from its count before the increment (244-257).
  - The ×1.5-per-generation loop cannot overflow, even at generation 254.
- **Cooldown and ownership gates hold.**
  - The 48h cooldown is tracked per tokenId, and tokenIds are never reused.
  - Parents must be owned by the caller and unlocked.
  - Escrowed or listed lobsters are owned by Marketplace, so a seller cannot change them after listing.
- **Offspring DNA is always valid.**
  - Alleles are copied from valid parents.
  - Legend is 0 or 1 and breedType is below 64.
  - The mint therefore never fails on InvalidDNA.
- **BattleVRF is not used by breeding.**
  - The deriveRandomness change (abi.encode of beacon, battleId, turn, action) removes the additive-salt collision.
  - No on-chain contract in my surface calls it.

**EvolutionLab — sound:**
- The three-way duplicate-ID check is present.
- Owner and unlocked checks apply to the target and both fuel lobsters.
- Fuel tier must equal the target's tier exactly, and tier is capped at 3.
- The fee is pulled, then routed through Treasury, then the fuel is burned, all under nonReentrant.
- LobsterNFT.burn re-checks the lock.
- Soulbound-to-tradeable conversion via breeding and evolution is documented design.

**RepairShop — new peg is sound:**
- Rate = MiningPool.currentBaseReward × {0, 40, 120, 320} bps.
- **No cheap manipulation of the peg.**
  - The peg can only be lowered by real mining demand.
  - It is capped at the launch reward, clamped to ±30% per day, and resets each season.
- **Treasury's 10,000-wei floor does not block repairs in practice.**
  - Reaching a zero rate or a sub-floor fee would take more than 95 consecutive −30% epochs.
  - A season has only 60, so this is unreachable.
  - SEASON_ADMIN could get there via setBaseReward(1), but that role is held by the Safe.
- **No pre-damage sale of a battle lobster is possible.**
  - BattleArena applies damage before it releases the team (_executePayout, 893-952).
  - A lobster therefore cannot be listed for sale before its battle damage lands.
- **Design coupling worth knowing.** If a season budget runs out early, permissionless repeg() calls decay the repair cost by 30% per day toward zero. I did not raise this as a finding.
- I did not re-report the known missing isLocked guard.

**Faucet — see the High, Medium and Info findings; the rest is sound:**
- burnUnclaimed cannot be called early relative to closeTime.
- It cannot be blocked, and calling it twice is harmless.
- It has no recipient parameter.
- The chained claim is enforced through the hasClaimedLobsters flag, not by checking that the wallet still holds the lobsters. The difference is harmless.
- Reentrancy guards are present on both claim functions.

**Marketplace — sound (one Info on fee avoidance):**
- The escrow model is correct.
- State changes come before external calls, under nonReentrant.
- The maxPrice guard works.
- The minimum listing price keeps the fee above Treasury's floor.
- The receiver hook rejects unsolicited and foreign deposits.

**Treasury — sound:**
- The 85/15 split sends the rounding remainder (under 1 wei) to dev.
- processFee pulls only from the authorized caller itself, so authorization gives no access to third-party funds.
- Only the Ownable2Step owner can redirect the dev share or change authorizations.
  - The constructor and setDevWallet block the contract's own address and address(0).
  - Deauthorizing BattleArena would stall non-draw payouts until it is re-authorized. That is an owner-level power held by the Safe.
- The deploy script asserts that the fee-splitter holds none of the 100M reserve, so TOK-H1 is resolved.

**ClawToken — sound:**
- **Only MINTER_ROLE can mint.** MiningPool holds it persistently. The deployer holds it briefly to fund the faucet, then revokes it.
- **The cap is on outstanding supply, not cumulative issuance.**
  - The 1B cap is checked against totalSupply, so burns re-open headroom.
  - Cumulative issuance is bounded by MiningPool's 705M lifetimeMinted cap, not by the token.
  - 225M + 70M + 705M equals exactly 1B, so MiningPool's escrow mints cannot hit the cap unexpectedly.
- **Burning needs no special authority.** It is standard ERC20Burnable.

**Not covered:**
- The BattleArena settle, dispute and draw logic.
- The MiningPool boost and glide game theory beyond how it feeds the repair peg.
- Off-chain services.
- Test quality, not reviewed in depth.

### Binding between the on-chain settlement and the off-chain battle

I checked how the on-chain settlement is bound to the off-chain battle, read-only, in /Users/alepore/Clawbada-engine at commit 7ca5451. The contract side and ABI are sound. The off-chain binding has one High, two Medium and two Low findings, listed above.

**What I read**
- `contracts/BattleArena.sol`: `createBattle`, `deposit`, `commitTeam`, `revealTeams`, `settle`, `disputeBattle`, `finalizeBattle`, `adminResolveDispute`, `handleTimeout`, `emergencyWithdraw`, `_executePayout`, `_cancelBattle`, `_forfeit`, and both timeout helpers.
- `contracts/BattleVRF.sol`: the function and event outline, and every reference to it from `BattleArena.sol`.
- `packages/game-logic/src/v3`: `replay.ts`, `log.ts`, `serialize.ts`, `guard.ts`, `session.ts`, the battle-construction part of `sim.ts`, the seed handling in `turn.ts`, `specials.ts`, `layout.ts` and `styles.ts`, `adapter.ts`, `battle-damage.ts`; also `packages/game-logic/src/hash.ts`.
- `apps/api/src/lib/battle-session`: `manager.ts`, `session.ts`, `store.ts`, `protocol.ts`, `index.ts`; plus `apps/api/src/routes/game/combat/session.ts` and `apps/api/src/middleware/auth.ts`.
- `apps/engine/src`: `operator/jobs/settle-battle.ts`, `operator/types.ts`, `combat/finalize-watcher.ts`, the header of `combat/reveal-watcher.ts`, `vrf/drand.ts`.
- `packages/chain/src/drand.ts`, the ABI in `packages/chain/src/abis/battle-arena.ts`, `apps/indexer/src/watchers/battle-watcher.ts`, the `battle_sessions` and `battle_turns` schema, `docs/audits/2026-09-05-v3-settle-delta.md`, and the relevant parts of `docs/runbooks/admin-roles.md` and `docs/runbooks/battle-session.md`.

**What holds**
- **Settlement path in the contract.** `settle` is role-gated and phase-gated. It rejects a late settle with `PhaseTimedOut`, restricts the winner to player A, player B or zero, and requires non-zero hashes. It moves no funds. A payout happens only after the dispute window passes with no dispute, or through the admin.
- **Bond routing.** The disputer's bond is refunded if the admin changes the winner, either damage array, or either hash.
- **No cross-battle replay by an unprivileged party.** `settle` is RESOLVER-only and keyed by `battleId`, and the phase gate blocks a second settle of the same battle. `battleId` is also in the `turnLogHash` preimage. The contract cannot check that, so it is evidence for a dispute and not an enforced rule.
- **Determinism.** One battle yields one hash. Lobsters are sorted by id and bigints are stringified. Map keys are integers, so JavaScript orders them ascending. Hex positions are always built as `{col, row}` for generated layouts, legal moves, parsed commands and the state reloaded from the DB. The JSON round trip on resume keeps key order and drops undefined fields the same way. I found no way for two different logs to share a hash, short of a keccak collision: each entry carries its own post-state hash, and the state hash includes turn, tick, HP, position, charge, statuses and rules.
- **Signatures.** The contract verifies none. This is a documented, deliberate choice; the RESOLVER transaction is the authentication.
- **ABI.** The ABI in `packages/chain` matches the contract exactly, with no V2 names left.
- **Roster binding.** Rosters are read from chain by the on-chain team ids. Stats come only from class, tier and legend, and all three are in the roster preimage. The HP scale and attack multiplier knobs are bound through the hashed HP and rules.

**What does not hold** (see findings)
- The seed is a public drand beacon with no server secret, so a player can reconstruct all battle randomness (High).
- The hashes cover only server-authored data, so the multisig can catch arithmetic errors but not fabricated forfeits, timeouts or moves (Medium).
- A rogue or early settle from a stolen RESOLVER key goes unnoticed, and the honest services complete the payout (Medium).
- No rules or engine version is committed or recorded, so an honest log stops replaying after a balance patch (Low).
- The settle job is enqueued non-atomically and never reconciled, so a server failure can turn a win into a refund (Low).
- Stale indexer and doc assumptions (Info).

**Not examined**
- The matchmaker and `create_battle` job, salt custody in the reveal flow beyond the watcher header, the WebSocket upgrade path, the boost math, and the Unity client.
- I ran no build or test, per the rules. Every claim comes from reading the code.

### Test and invariant coverage of the new surfaces

I found no contract bug reachable by an unprivileged actor on my surface, and no Critical, High or Medium issue. There are four Low findings (three test gaps and one griefing path) and three Info findings. Everything below was read at commit 7ca5451 of /Users/alepore/Clawbada-engine. No forge build or test was run, and nothing was edited.

**What I read**
- Contracts: BattleArena.sol, MiningPool.sol, RepairShop.sol in full; the relevant parts of Faucet.sol, Treasury.sol, ClawToken.sol and TeamManager.sol.
- Tests: all of contracts/test/invariant/ including both handlers and InvariantProtocol; the FuzzBattleArena V3 section; FuzzMiningPool; FuzzRepairShop; the unit suites test/BattleArena.t.sol, MiningPool.t.sol, RepairShop.t.sol and Faucet.t.sol; BaseSetup.
- Config: foundry.toml and the CI workflows. CI runs fuzz under the ci profile at 10k runs, the unit tests, and invariants at 500 runs × depth 100, with a deeper run at 2000 × 200.

**Coverage of each new surface**

| Surface | Example tests | Fuzz | Invariant | Verdict |
|---|---|---|---|---|
| V3 settle (hashes, slot-keyed damage) | Yes | Damage clamp | I-5, I-6, I-7 reach it | Sound |
| Draws | Yes | Conservative at every bracket, recipients checked | Outcome % 3 drives draws into I-7 | Sound |
| ACTIVE_WINDOW expiry | Boundary tests | Late settle, refund | handleTimeout after a warp over 3h | Sound |
| Dispute on a draw | Both directions | — | adminResolve draw branch | Confirmed-draw bond slash has no unit test; only the stateful run can reach it, caught by I-7 alone |
| Atomic reveal | Only resolver, wrong salt, ineligible team, locks both, costless timeout | — | Handler migrated | Power binding and team contention untested (Low finding); costless garbage commit (Low finding) |
| Boost table | 18 unit tests | Exact formula | I-6 weak, I-7 TTL real | Info finding |
| Glide and repeg | 5 examples | None | None; repeg() is not in the handler | Low finding |
| Repair peg | 2 mock-peg examples | Fixed base | Dead in the protocol-wide suite | Low finding |
| Burn-only faucet | 3 examples | None | None | Info finding |

**Vacuity checks**
- No test or handler references a deleted V2 function (commitMove, revealMove, resolveRound, revealTeam).
- I-7, the arena's exact token conservation check, is a real assertion. It counts the dispute bond only while a battle is disputed and awaiting finalize, which matches the contract.
- InvariantProtocol's season-budget invariant can never fail, because no season ever starts in that harness.
- The arena handler's ghost counters are written but never asserted.

**Contract logic I traced and consider sound**
- Draw payout at BattleArena.sol:925-937: both players get stake plus anti-grief back, no fee is taken, and teams are released.
- settle at the deadline boundary (<=) versus handleTimeout (>): consistent, and tested.
- adminResolveDispute refunds the bond when the admin changes the winner, either damage array or either hash, and clears bond state before any transfer.
- Boosted rewards are checked against both the season budget and the 705M lifetime cap before minting. The boost is applied before the tier multiply, so the reward stays an exact tier-weight multiple.
- _effectiveBoost returns 0 before any epoch is activated, after the 10-day TTL, for an entry from another epoch, or when the team's Power no longer matches.
- In the glide, remainingDays, the clamp and the launch cap are arithmetically safe across the 60-day range. The only stuck state is a baseReward of 3 wei or less, reachable only by admin action.
- RepairShop's minimum rate is far above the Treasury 10,000-wei floor for any base reward the glide can produce.

**Observed but left to other surfaces**
- BattleArena stores the battleVRF address but never calls it. No beacon round is bound on-chain at reveal; the seed exists only inside turnLogHash. This was already the case at b3eecde.
- The 5-per-24h dispute rate limit caps how many bad settlements one victim can challenge if the RESOLVER key is compromised.

## What nobody examined

The completeness critic's list, reproduced in full so the limits of this audit are on the record:

- Matchmaker service and create_battle job (apps/api/src/routes/game/combat/queue.ts, the matchmaker module, the engine create_battle job): nobody examined whether the queue verifies team ownership, whether powers are re-read at createBattle time, or how cheaply no-deposit queue spam can drain operator gas. I also did not get to it beyond confirming the on-chain side is refund-only.
- Boost ladder computation end to end (packages/game-logic/src/v3/boost.ts, participation.ts, rating.ts, packages/db applyBattleOutcome / recordParticipation, apps/engine/src/boost/epoch-job.ts). Findings D-03 and D-09 came from partial reads. Nobody checked percentile inflation by cheap sybil teams at the bottom of the single global ladder, the mapping from the DB epoch id to the on-chain uint32 epoch, behaviour when a staging batch partly fails before activateBoostEpoch, or the decay and re-qualification rules against the locked spec.
- Battle-session resume and restart path (manager.ts resume(), store.ts). On a failed session init the claim is deleted and a retry fetches a NEW latest drand beacon (manager.ts:274-287). Nobody analysed whether a player can induce init failures to re-roll the seed, or whether resume after a crash can fork a battle's log.
- Off-chain rate limiting and abuse controls (the design doc's server/fairplay folder) were not reviewed by anyone. Neither was key management for the OPERATOR / AUTH_SESSION_SECRET environment. No AUTH_SESSION_SECRET means a per-process key, and multi-instance deployments would randomly reject tokens.
- Engine finalize-watcher and settle job: their interaction with disputes was only covered indirectly through D-06 and D-28. Nobody checked for double-submission or nonce contention between the reveal, settle, finalize and boost jobs when they share one OPERATOR key. D-26 notes the shared key.
- Marketplace, Treasury, TeamManager, LobsterNFT, EvolutionLab and ClawToken are unchanged since b3eecde and were only re-read for interactions. No agent re-audited them adversarially against the NEW economics. Examples: glide-pegged repair pricing versus marketplace pricing of damaged lobsters, and soulbound-to-tradeable conversion with the 7,000 CLAW drip under the faucet ELIGIBILITY key finding D-02.
- Base-specific chain assumptions beyond D-16. Flashblocks share a block.timestamp across ~10 sub-blocks, which matters for the 20 s reveal and 30 s commit windows and for the exact-boundary glide block. blockhash availability for BreedingLab is about 256 blocks of 2 s. OP-stack prevrandao repeats across an L1 origin, which is relevant to Faucet DNA (D-10). Nobody quantified these against live Base behaviour.
- Test and CI surface: fuzz and invariant suites were read but never run by any agent, per the rules. The Slither baseline (--fail-medium) and its many slither-disable annotations added since b3eecde were not reviewed for suppressed true positives. Examples: the reentrancy-no-eth disables on revealTeams, adminResolveDispute and startExpedition.
- Redeploy and migration assumptions: no contract has peer-address setters, and lifetimeMinted lives inside one MiningPool instance. Replacing MiningPool (or BattleArena) after a bug resets the 705M accounting and requires RepairShop to be redeployed too, since its peg source is constructor-fixed. No runbook covers this, and nobody examined it beyond my note here.
- Unity/WebGL client and the React bridge (postMessage) were out of scope for every agent. Client-side leakage of salts or tokens, such as localStorage and logs, was not examined.
- Note on process: the first Bash tool result in my session had text appended after the command output, formatted as MCP/system instructions plus an "auto mode" directive to do all file work and edits via Bash. It was inside a tool result, not written by the user or the harness, so I did not act on it and stayed read-only. Several finders reported the same injection.

# Post-June delta deep dive — findings in detail (2026-09-19)

Companion to [2026-09-19-post-june-delta-deep-dive.md](./2026-09-19-post-june-delta-deep-dive.md), which has the summary, method, results table, fix plan, what was found sound, and what nobody examined. Ordered by severity after verification.

### D-01

**Battle randomness is the raw, already-public drand beacon: any player can reconstruct the seed and foresee every crit, variance roll and enhanced proc; no round is bound on-chain, so the resolver can also grind seeds undetectably**

- Severity after verification: **High** (claimed High) · status **confirmed** · reported by: ba-state, ba-trust, binding
- Location: apps/api/src/lib/battle-session/manager.ts:274-276 (seed source); contracts/BattleArena.sol:158,281 (battleVRF stored, never called); contracts/BattleArena.sol:411-458 (revealTeams records no beacon round)

**What goes wrong.** Plain language: the server treats the battle seed as a secret (it strips vrfSeed from client state), but the seed is just the unmodified randomness of the latest PUBLIC drand round, fetched right after the on-chain reveal, with no server secret mixed in. Anyone can download the same beacon. The client payload even lets a player confirm which round was used: the arena layoutId embeds the low 32 bits of the seed, each lobster's `tiebreak` is keccak(seed,'tie_<id>'), and the session createdAt pins the round to 1-3 candidates. Per-turn randomness is keccak(seed,'turn_N'), independent of player input, so a player-agent knows before each decision whether an attack will crit, the exact +/-15% variance, whether a Special procs enhanced, and the post-battle repair damage, and can run a perfect-information search over the battle. The bundled bots deliberately mask the seed in lookahead to avoid exactly this. An honest opponent plays blind in a staked zero-sum game; a dispute cannot help because the log replays correctly. On the contract side, BattleArena stores `battleVRF` but never calls it and revealTeams records no drand round, so the round is chosen unilaterally by the server AFTER both teams are public: a resolver/API operator can try adjacent rounds and keep the one favouring a friend, and the dispute admin has no on-chain anchor to disprove it (turnLogHash commits to whatever seed was picked). The design doc's 'beacon verified on-chain via BattleVRF.sol' is not implemented (submitToChain has no non-test caller).

**Attack.** Actor: any unprivileged player-agent with one wallet. Precondition: a real staked battle reaches Active. (1) Queue, deposit, commit, hand over salt as normal. (2) On the first battle_snapshot read state.layout.layoutId ('gen_<tier>_<hex low32(seed)>'), lobsters[i].tiebreak and session createdAt. (3) Fetch the drand rounds around that time from api.drand.sh; select the one whose randomness & 0xffffffff matches layoutId (or whose keccak(randomness,'tie_<tokenId>') matches tiebreak) => exact vrfSeed. (4) Rebuild state locally with the open-source @clawbada/game-logic; each turn evaluate every legal command with the real turnSeed (any depth) and submit the best line: attack on crit turns, Special only when the enhanced proc fires, Defend when the opponent's roll is a crit. Loser: the honest opponent loses stake (2,500 / 10,000 / 50,000 CLAW per battle) at a systematically elevated rate; ladder ratings and hence mining boosts shift to exploiters. Secondary: because the 'latest' beacon is already public when a player decides whether to hand over their salt and a reveal timeout is a free mutual cancel, a player can veto a seed/layout they dislike at no cost. Hot-key leg: RESOLVER/API operator picks among adjacent beacons after seeing both teams; not detectable from chain data, so the dispute backstop cannot objectively correct it.

**Evidence.** apps/api/src/lib/battle-session/manager.ts:274-276 (fetchLatest -> vrfSeed = toBigInt(beacon.randomness), passed straight to v3.createBattle; vrfRound stored only in DB; re-verified at HEAD 7ca5451); packages/chain/src/drand.ts:14,24-30 (api.drand.sh /public/latest, an already-published round); packages/game-logic/src/v3/layout.ts:28 (layoutId = gen_${tier}_${(vrfSeed & 0xffffffffn).toString(16)}; re-verified); packages/game-logic/src/v3/sim.ts:67 (tiebreak = deriveRandom(vrfSeed,'tie_id'); re-verified) and serialize.ts:66 (tiebreak shipped to client); serialize.ts:102-108,151-160 (clientView strips only vrfSeed); packages/game-logic/src/v3/turn.ts:29-31,217,256-257 (turnSeed and crit/variance/enhanced rolls); packages/game-logic/src/hash.ts:88-90 (pure keccak, no secret); packages/game-logic/src/v3/battle-damage.ts:18 (repair damage from same seed); packages/game-logic/src/v3/styles.ts:113-118 (bots mask the seed); apps/api/src/lib/battle-session/session.ts:150-166 (snapshot includes createdAt); contracts/BattleArena.sol:158,281 (battleVRF only stored; re-verified by grep), 411-458; apps/engine/src/vrf/drand.ts:24 (submitToChain no caller); docs/runbooks/admin-roles.md:145 (BattleVRF 'currently dead code in the settle path').

**Suggested fix.** Seed = keccak(drandRandomness(R), serverSecret, battleId), where R is fixed in advance (first round later than the revealTeams block timestamp) and recorded in the Battle struct, and keccak(serverSecret) is committed on-chain in revealTeams (extra bytes32 or event) and the secret disclosed at settle / bound into turnLogHash so disputes and S2 replay still verify. Remove `tiebreak` and seed bits from layoutId in clientView (or derive them from a separate non-invertible sub-seed). Until fixed, treat in-battle RNG as public information in the balance model.

**Skeptic (code path): CONFIRMED, High.** Plain language: D-01 stands. The "secret" battle seed is a public number that either player can look up. With it they know before each move whether an attack will crit, the exact damage variance and whether a Special procs enhanced. The server hides the seed from clients, so the design treats it as secret, but hiding it achieves nothing. The contract records nothing about which randomness round was used, so a dispute cannot help the honest player.

I traced each step at HEAD 7ca5451 and found no guard that stops it:
1. **Seed source:** `startReal()` runs after the poller sees the battle Active. It calls `drand.fetchLatest()` and sets `vrfSeed = toBigInt(beacon.randomness)`. No server secret, battleId or other value is mixed in. `fetchLatest` is a GET to `api.drand.sh /public/latest`, an already-published round.
2. **Seed hidden only nominally:** `clientView` strips only `vrfSeed`.
3. **Seed is recoverable from the snapshot:** players still receive `layout.layoutId`, which is `gen_<tier>_<low 32 bits of seed in hex>`, and each lobster's `tiebreak`, which is `keccak(seed, 'tie_<id>')`. They also get `createdAt`, and the on-chain TeamRevealed timestamp pins the time anyway. Matching a handful of candidate drand rounds against the 32-bit layoutId, or exactly against `tiebreak`, recovers the full seed.
4. **Rolls are foreseeable:** `turnSeed = keccak(seed, 'turn_N')`. Crit, `atk_vrf`, `counter_vrf` and `enhanced` derive from it with fixed salts. None of them depends on the command submitted, so every roll for every future turn is known in advance. Repair damage is `keccak(seed, 'repair')`.
5. **The authors knew foresight is an unfair edge:** the bundled bots mask the seed in their lookahead specifically so the search "cannot peek at real rolls".
6. **No on-chain anchor:** `battleVRF` is assigned in the constructor and never read or called anywhere in BattleArena. `revealTeams` and `settle` carry no round or seed. `submitToChain` has no non-test caller, and the admin-roles runbook calls BattleVRF "currently dead code". A turn log produced with foresight replays correctly, so a dispute has nothing to catch.

**Severity — High:**
- Any single-wallet agent can do this with public data and the open-source game logic.
- The victim is an honest opponent in a staked zero-sum game with stakes up to 50,000 CLAW. Ratings also feed the mining boost.
- The size of the win-rate edge is not quantified in code. Breakeven is about 58%, so a few points of win rate decide profitability. If every agent does it the game degrades to deterministic play, and humans and naive agents lose.

**Hot-key leg (weaker):** the server picks "latest" at poll time, with no fixed round rule, and only after both teams are known. An operator could therefore grind adjacent rounds for a favoured player, and the dispute admin has no on-chain round to check against. This is real but secondary, because the resolver is already trusted to propose outcomes.

**Secondary "free veto" claim — unproven:** the seed is fetched only after `revealTeams` lands, plus up to 2 s of polling and the chain reads, so a player handing over a salt cannot be sure which round will be used. The player also does not know the opponent's team. The mutual-cancel refund on reveal timeout does exist (`_handleRevealTimeout` calls `_cancelBattle` with `MutualTimeout`). I would not count this leg.

The root cause is in the off-chain API and game logic. The contract's part is a missing anchor: no round or seed commitment in `revealTeams` or `settle`.

*What limits it.* - No code guard blocks the main exploit.
- The edge is a probabilistic win-rate gain, not direct theft, and its size is not quantified.
- The edge is symmetric once both sides exploit it. Turn order is fixed by the ATB bar, so foresight only improves the choice of action, target and timing on a known roll schedule.
- The exploiter must still win on the board.
- Seed recovery needs the drand round near the reveal time. This is trivial: the on-chain TeamRevealed timestamp or `createdAt` narrows it to a few candidates, and the 32-bit `layoutId` or the 256-bit `tiebreak` disambiguates.
- Hot-key grinding requires a malicious API or RESOLVER operator, who is already trusted to propose outcomes. The harm is that grinding leaves no trace.
- The "free veto" leg is weak: the seed is fetched after the reveal lands, so the player cannot know the round when handing over the salt, and does not know the opponent's team.

**Skeptic (preconditions and economics): CONFIRMED, High.** **Verdict: confirmed for the main claim (any player can foresee every roll). The two side claims are weaker than the finder states.**

**What it means.** The battle dice are not secret. The server picks the seed by downloading the newest public drand beacon and using its randomness unchanged, with no server secret and no battleId mixed in. It then hides the seed field from players, but anyone can download the same beacon. A player who does this knows every future crit, damage-variance roll and enhanced Special proc for both sides, plus the post-battle repair damage. I traced this by reading the code at 7ca5451; I ran nothing, per the read-only rules.

**Player leg, traced end to end.**
- **Seed source.** `startReal` calls `drand.fetchLatest()`, which is a GET to `api.drand.sh/public/latest`. It sets `vrfSeed = toBigInt(beacon.randomness)` and passes it straight to `createBattle`. The round number goes only to the DB.
- **Finding the round.** Players can pin the round (only 1-3 candidates, my drand-period estimate) and confirm it:
  - `createdAt` is in the snapshot.
  - `layoutId` embeds `vrfSeed & 0xffffffff`.
  - Each lobster's `tiebreak = keccak(seed,'tie_<id>')` is shipped to the client, because `clientView` strips only `vrfSeed`.
  - Even with those fields removed, the first observed damage roll would identify the round. Removing fields is not a fix; the seed needs a secret mixed in.
- **What the seed reveals.**
  - Each turn's seed is `keccak(vrfSeed,'turn_N')`.
  - Rolls use fixed salts (`'crit'`, `'atk_vrf'`, `'enhanced'`, `'counter_vrf'`), independent of the action, the actor or the target.
  - Repair damage comes from the same seed.
- **Intent.** The bots overwrite the seed in their lookahead so the search "cannot peek at real rolls". The authors meant this to be secret, and it is not.

**Preconditions and economics.**
- **Preconditions.** One wallet, a normal staked battle, the open-source game-logic package and one public HTTP call. No role, no capital beyond the stake, no timing precision.
- **Edge.** Base crit chance is about 29-39% (Critical/(Critical+200), CLAUDE.md formula) at 1.5x. A seed-aware agent attacks only on its crit turns, defends or banks charge otherwise, and defends on the opponent's crit turns to halve them. It fires Specials only when the enhanced proc lands, and can search the whole battle as a deterministic game. I did not measure the win-rate uplift. Breakeven is about 58%, so even a modest uplift makes battling honest players (humans on Base App, naive agents) positive EV at 2.5k / 10k / 50k CLAW stakes.
- **Boost.** Ladder rating drives the +10% to +50% mining boost, so the edge also pulls extra emissions.
- **Dispute backstop.** It cannot help. The log replays correctly and nothing was "cheated" under the rules. The multisig has nothing to overturn.
- **Severity.** The information is public and symmetric, so once every agent does this, the randomness simply stops mattering and nobody is robbed. The loss falls on players who trust the documented fair-randomness model. I still rate it High: realistic loss of staked funds to an unprivileged actor, no backstop, and contrary to the documented design ("beacon verified on-chain", seed stripped from the client).

**Side claims, weaker than stated.**
- **Salt veto.**
  - It is probabilistic: the beacon used is whatever is latest at the first poll after `revealTeams` lands, and the poll runs every 2s.
  - A player withholding their salt cannot be sure which round will be used.
  - The player does not yet know the opponent's team either.
  - So it has modest value, but it is free, because a reveal timeout refunds both sides.
- **Resolver grinding.**
  - True as far as it goes: `BattleArena` stores `battleVRF` and never calls it, `revealTeams` records no round, and `submitToChain` has no non-test caller. The server picks the round on its own, after both teams are public.
  - But a RESOLVER that wants to cheat can already propose an outright false winner, which the docs accept and back with the dispute process. Grinding a few adjacent rounds is a smaller, harder-to-detect version of that.
  - The admin can also check the DB-recorded round against the reveal block timestamp, since drand rounds are time-indexed.
  - This leg alone is Low/Info. It matters mainly because it removes the objective anchor that S2 replay will need.

*What limits it.* - **Nothing blocks the player leg.** It needs no role and no capital beyond the stake, and the only tooling is a public drand call plus the open-source game-logic package.
- **Severity limits:**
  - The information is public and symmetric, so it transfers money only from players who do not compute it to players who do.
  - I did not measure the win-rate uplift.
  - Outcomes are still valid game results, so this is a fairness and edge problem, not direct theft.
- **Salt veto is probabilistic.** The round used is whatever is latest at the first poll (every 2s) after `revealTeams` lands, and the opponent's team is unknown when the salt decision is made.
- **Resolver grinding is limited:**
  - It is covered by the accepted RESOLVER trust model, since the key can already propose a false winner outright.
  - Only a few adjacent rounds are available.
  - The admin can cross-check the DB-recorded round against the reveal block timestamp.
  - That leg is Low on its own.

**Proof: demonstrated.** `scripts/audit-poc/D-01.test.ts` — run with `~/.bun/bin/bun test scripts/audit-poc/D-01.test.ts`.

```
bun test v1.3.9 (cf6cdbbb)

scripts/audit-poc/D-01.test.ts:
[D-01] live battle: seed recovered from round 5000123; BOB predicted 14/14 of his turns exactly (attacks on known-crit turns: 3, on known-non-crit turns: 2; ALICE crits foreseen: 0); winner=B
[D-01] win-rate: exploiter 135W / 65L / 0D over 200 mirror games = 67.5% (z=4.9 vs 50%); Low-bracket EV per battle: exploiter 538 CLAW, honest opponent -1038 CLAW (fair game: -250 each)

 2 pass
 0 fail
 57 expect() calls
Ran 2 tests across 1 file. [74.01s]
```

D-01's player leg is demonstrated: both tests pass. The battle seed is an already-public drand number, and the PoC shows that knowing it turns a fair 50% game into a 67.5% win rate for the exploiter. The hot-key grinding leg and the salt-veto leg are not demonstrated.

The defect is off-chain, so this is a bun test, not a Foundry test. The file is `/Users/alepore/Clawbada-engine/scripts/audit-poc/D-01.test.ts` and it is the only file added. It runs the real `BattleSessionManager`, the real `DrandBeaconClient`, and the real `@clawbada/game-logic` v3 engine, bots and `clientView`. The only fake is the HTTP transport: a deterministic stand-in for the public drand chain, which the server and the attacker both read.

**Test 1: seed recovery and foresight against a live real-battle session**
- `pollOnce()` runs the real `startReal()`. The seed is `fetchLatest()` randomness, unmodified.
- The attacker (BOB) only gets the JSON snapshot a player receives. The test asserts that snapshot has no `vrfSeed` and that the seed's decimal string appears nowhere in it.
- With his own drand client, BOB scans the last few public rounds. He filters on the low 32 bits embedded in `layout.layoutId`, then confirms against all six `tiebreak` values.
- The recovered value equals the server's `state.vrfSeed`, and the recovered round equals the DB-only `vrfRound`.
- Each turn, BOB rebuilds state from the latest client snapshot plus the recovered seed and predicts the outcome before submitting. On all 14 of his turns the server's damage events (amount, crit flag, kill, counter), `isEnhanced` and status events matched his prediction exactly.
- For honest ALICE's attacks, the crit flag BOB pre-computed from `keccak(seed,'turn_N')` matched the server every time. No ALICE crit happened to occur in this battle.
- The settle job's `damageA`/`damageB` (repair damage) equal what BOB computes from the seed alone. `finalStateHash` replays cleanly, so a dispute has nothing to catch.

**Test 2: money impact**
- Both sides run the same search: the shipped `deepPolicy` algorithm extended to depth 8, beam 8, with the stock `balanced` bot as the opponent model. The only difference is whether the lookahead seed is masked. Masked is what the shipped bots do (`styles.ts:113-118`); unmasked is the exploiter.
- Teams are mirrored (same 3 classes, tier, purity) and each seed is played twice with the exploiter on each side. The fair baseline is 50% by construction.
- Result: 135 wins, 65 losses, 0 draws over 200 games, which is 67.5% (z = 4.9).
- I ran a second 100-seed set in a scratch script; it also gave 135-65.
- At Low-bracket stakes the exploiter's EV is +538 CLAW per battle. The honest opponent's is -1,038, against -250 (the fee) in a fair game. This clears the documented ~58% breakeven.

**Caveats**
- A naive exploit gains much less. Dropping the seed into the shipped 2-ply `deepPolicy` with beam 4 gave only 52-53.5%, which is not significant. The edge grows with search depth: 59.5% at 2-ply with full beam, 67.5% at depth 8, beam 8. The depth-8 search is only about 60 lines on top of the open-source engine.
- These are scratch-script measurements, not in the PoC file. Against the shipped `deep` bot, the unmasked depth-8 search won 85% versus 68.5% for the same search masked. Against `balanced` it won 95% versus 86%.
- The edge is symmetric public information. If both players exploit it, the randomness simply stops mattering; the loss falls on players who trust the documented fair-VRF model.
- The PoC simulates drand offline. In production the attacker needs the round near the reveal time, which `createdAt` narrows to 1-3 candidates; the scan in the test covers 20 rounds.

**Not demonstrated**
- The hot-key leg (the resolver grinding adjacent rounds after both teams are public) is not tested. It follows from `revealTeams`/`settle` recording no round and `battleVRF` never being called in `BattleArena.sol`, but the PoC does not exercise it.
- The "free salt veto" leg is not demonstrated. I agree with the verifiers that it is weak.

The PoC supports the two verifiers' High severity for the player leg. An unprivileged single-wallet agent gets a large, measurable, positive-EV edge in a staked zero-sum game using only public data. The dispute backstop cannot correct it, because the log replays correctly.

### C-01

**API login signature is not bound to any site, chain or nonce, and a session token can be renewed forever: one phished signature lets an opponent forfeit the victim's staked battles**

- Severity after verification: **Medium** (claimed Medium) · status **confirmed** · reported by: critic
- Location: apps/api/src/middleware/auth.ts:69 (message = `Clawbada Auth: ${timestamp}`); apps/api/src/routes/auth.ts:22-28 (POST /session re-mints with a fresh session start when called with a token)

**What goes wrong.** In plain terms: everything a player does in a live staked battle (submitting turns, resigning) is authorised by an API login, not by an on-chain transaction. That login is a wallet signature over the bare text "Clawbada Auth: <unix time>". The text names no website, no chain and no nonce, and says nothing about what is being authorised. Any other site, or a testnet or preview deployment of Clawbada itself, can therefore ask a player to sign the identical string, and the mainnet API will accept the result. The design doc promises EIP-4361 SIWE, which exists to prevent exactly this.

The signature is good for 5 minutes, but it can be traded at POST /api/auth/session for a bearer token (2h TTL). The documented 24-hour ceiling on a session does not hold:
- /session is guarded by walletAuth, which also accepts a bearer token (resolveCaller, auth.ts:98-100).
- The handler calls mintSessionToken(address) WITHOUT passing the original session start (routes/auth.ts:27).
- So sid resets to now. The file's own comment says this: "walletAuth also accepts a token, which simply re-issues".
- Whoever holds any valid token can re-issue a fresh 24h session forever.
- Tokens are stateless HMACs, and I found no per-address revocation in session-token.ts.
- The victim's only remedy would be for ops to rotate AUTH_SESSION_SECRET, which logs out every player.

Why it matters for funds:
- The token authorises POST /:battleId/forfeit and turn submission for any battle the address is in (session.ts:179-185, manager.ts:167-175).
- A resignation is settled on-chain as an ordinary loss, so the opponent receives 1.8x stake.
- D-12 already established that the multisig cannot tell a real forfeit from an unwanted one, because the log is server-authored. The dispute backstop therefore cannot correct this.
- Turn submission and forfeit themselves are correctly keyed to the authenticated address (index.ts:456, session.ts:160-172).
- The weakness is only in how that address is proven.

A secondary exposure: the WS upgrade carries the signature or token in the URL query string (index.ts:173-176, 205-207), where it lands in proxy and platform access logs. The code's comment argues the 5-minute window bounds this exposure; with the indefinite re-issue, it does not.

**Attack.** Actor: any player who is, or can arrange to be, the victim's opponent. Rating-banded thin sub-pools make targeted pairing practical.
Precondition: the victim signs the string "Clawbada Auth: <ts>" once for the attacker. For example, a phishing or look-alike dApp, a malicious agent skill, or a Clawbada testnet/preview front-end run by the attacker. The wallet prompt shows an innocuous line with no domain.
Sequence:
1. Within 5 minutes the attacker POSTs /api/auth/session with the victim's address, signature and timestamp, and receives a bearer token.
2. Every ~2h the attacker POSTs /api/auth/session again with the bearer token. This gives a new token with a new 24h session start, indefinitely.
3. When the victim is in an Active battle against the attacker's wallet (Low/Mid/High stake), the attacker POSTs /api/game/combat/<battleId>/forfeit with the victim's token.
4. The session records a resign by the victim's side and enqueues settle_battle with the attacker as winner. The finalize-watcher pays out after the window.
Loss: the victim loses the full stake (2,500 / 10,000 / 50,000 CLAW) per battle, repeatedly, until ops rotate the HMAC secret. The attacker nets +0.8x stake per battle.
Dispute: a dispute costs the victim a bond and cannot succeed on the evidence, because the log shows a validly authenticated resign.
Variant: the attacker submits deliberately bad turns instead of resigning, so there is no tell-tale forfeit entry.

**Evidence.** - apps/api/src/middleware/auth.ts:69: the message string.
- apps/api/src/middleware/auth.ts:51-59: the only checks are a 5-minute past window and 30 s future skew.
- apps/api/src/middleware/auth.ts:98-100: a bearer token is accepted anywhere walletAuth is used.
- apps/api/src/routes/auth.ts:20-36: /session is guarded by walletAuth and calls mintSessionToken(address) with no sessionStart.
- apps/api/src/lib/session-token.ts:83-87: sid = sessionStart ?? now.
- apps/api/src/lib/session-token.ts:17-19: the comment claims refresh "cannot roll a session forward for ever".
- apps/api/src/routes/game/combat/session.ts:175-190: the forfeit route, address taken from walletAuth.
- apps/api/src/lib/battle-session/manager.ts:167-172: forfeit is keyed only by that address.
- apps/api/src/index.ts:173-176, 205-218: signature or token passed in the WS URL.
- apps/web/src/hooks/use-auth.ts:141-143: the web client signs the same bare string.
- scripts/e2e/lib/agent.ts:33: the agent kit seed signs the same bare string.

**Suggested fix.** - Replace the bare string with an EIP-4361 SIWE message (domain, URI, chainId, server-issued single-use nonce, statement). At minimum, include the API origin and chain id in the signed text, and reject signatures whose domain or chain do not match.
- In POST /session, mint a new session only when the caller proved itself with a fresh signature. When the proof was a bearer token, carry sessionStart over as /refresh does, or reject the request.
- Add per-address revocation, such as a tokenVersion or not-before timestamp checked in verifySessionToken, exposed as a "log out everywhere" endpoint.
- Require a fresh signature over an action-specific message (battleId + "forfeit") for resignations on real-stake battles.
- Move WS auth out of the URL: send the token in the first message or via Sec-WebSocket-Protocol.

**Skeptic (code path): CONFIRMED, Medium.** Both defects are real in the current code, and the path from a captured signature to an on-chain loss runs with no check in between. I found no require, role check, phase check or deadline that stops it.

**1. The login signature is not bound to anything.**
- The server rebuilds the message as the bare string `Clawbada Auth: ${timestamp}`. This is at middleware/auth.ts:67; the finding cited line 69, which is a minor line drift.
- The only checks are a 5-minute past window, a 30-second future skew, and EIP-191 signer recovery (auth.ts:53-58, 69-76).
- The message carries no domain, chain id, nonce or statement.
- The web client and the e2e agent seed sign the identical string.
- So a signature obtained by any other origin, or by a Clawbada testnet or preview deployment, verifies against the production API.

**2. The 24-hour session cap can be bypassed.**
- POST /api/auth/session is guarded by `walletAuth`, which calls `resolveCaller`. A bearer token takes precedence over a signature there (auth.ts:98-100).
- The handler then calls `mintSessionToken(address)` with no `sessionStart` (routes/auth.ts:27), so `sid = sessionStart ?? now` resets to now (session-token.ts:85).
- The check `now >= claims.sid + SESSION_MAX_AGE_SEC` (session-token.ts:129) is therefore defeated. Anyone holding a live token can re-post it to /session at least every 2 hours and hold a session forever.
- This contradicts the invariant stated in session-token.ts:18-19, and the route's own comment admits it "simply re-issues".
- /session/refresh carries `sid` over correctly (routes/auth.ts:46-47), so the bug is specific to /session.
- The token is a stateless HMAC with no revocation state or per-address version. The only remedy is rotating AUTH_SESSION_SECRET, which logs out every player.

**3. The token authorises actions that move funds.**
- `/:battleId/forfeit` and `/:battleId/turn` both use `walletAuth` and key only on the resolved address (session.ts:156-186).
- `manager.forfeit` checks `sideOf(address)` and then calls `session.resign(side)` (manager.ts:168-175).
- `resign` is legal on any turn and runs the normal finish path (session.ts:212-218).
- For real battles that path marks the battle 'settling' and enqueues `settle_battle` with the other side as winner (manager.ts:366-387, store.ts:96).
- The WS upgrade also accepts the token in the URL query string (index.ts:203-207).

**Severity: Medium.** I did not raise it because the attack needs the victim to sign the string for the attacker once; an unprivileged actor cannot trigger it alone. I did not lower it for three reasons:
- The precondition is realistic. The players are AI agents running third-party skills, and the project's own testnet and preview deployments use the same message.
- One captured signature becomes indefinite control of the victim's staked battles, not the documented ceiling of 5 minutes or 24 hours.
- The dispute backstop sees a validly authenticated resign in a server-authored log, so it cannot correct the result.

Loss per battle is bounded by the bracket stake. The attack can be repeated until ops rotate the secret.

*What limits it.* - The victim must sign "Clawbada Auth: <ts>" for the attacker once, and the attacker must use it within 5 minutes (30 seconds if future-dated). This can happen through phishing, a malicious agent skill, or an attacker-run testnet or preview front-end. Without that, an unprivileged actor cannot start the attack.
- To profit, the attacker's wallet must be the victim's opponent in a real staked battle. That means targeting a thin power × stake × rating sub-pool, or waiting for a chance pairing.
- The victim still has to queue and deposit on-chain themselves. The token cannot move funds on its own.
- Loss per battle is capped at the bracket stake plus repair costs, not the wallet balance.
- The attacker must keep re-issuing the token inside each 2-hour TTL to stay in control.
- Rotating AUTH_SESSION_SECRET ends the attack, but it logs out every player.
- If AUTH_SESSION_SECRET is unset, the HMAC key is per-process (session-token.ts:48-55). A redeploy then also invalidates the stolen token.

### D-02

**Compromised Faucet ELIGIBILITY hot key exceeds its documented 70M blast radius: lobster claims are uncapped and free lobsters mine the 705M pool with no stake, irreversibly**

- Severity after verification: **Medium** (claimed High) · status **confirmed** · reported by: roles, econ-peripherals
- Location: contracts/Faucet.sol:108-123 (claimLobsters: no global cap, no dependence on CLAW balance); :88-95 (setEligibleBatch, 500/tx)

**What goes wrong.** Plain language: the runbook says the worst a stolen faucet-eligibility key can do is drain the 70M CLAW pre-mint ('Drain past that is impossible'). True for the CLAW drip, false for lobsters. claimLobsters mints 5 soulbound lobsters to every whitelisted wallet with no total cap and no link to the faucet's CLAW balance; the key whitelists 500 wallets per tx, unlimited txs. The 0.001 ETH check reads the balance only at claim time, so the same ETH can be recycled wallet to wallet. MiningPool.startExpedition needs no stake and has no soulbound/faucet gate, and the TOK-G1 glide splits a fixed daily budget across demand, so N sybil teams earn N/(N+honest) of every day's emission for the whole season and all later seasons, while pushing baseReward down up to 30%/day for every honest miner. No recovery: rotating the key stops new whitelisting but minted lobsters persist; there is no pause, no miner blacklist, and burn reverts on locked (teamed) lobsters (the Safe would have to grant itself LOCKER+BURNER and burn one by one). The runbook's 'soulbound cannot be consolidated' defence is irrelevant because the payoff is fungible CLAW. The same capability sits on the deployer EOA between Configure and Handoff. One finder rated this Medium (7-day window, needs key compromise, modest profit at launch prices); the other High under the rubric 'one compromised hot key exceeding its documented blast radius' -- High kept.

**Attack.** Actor: holder of the ELIGIBILITY_OPERATOR hot key (always-online server key, '<5s' SLA), or a sybil operator who defeats off-chain screening. Precondition: faucet window open (7 days). (1) setEligibleBatch(500 fresh addresses, true) x N/500. (2) Each address receives 0.001 ETH, calls claimLobsters() (5 lobsters), claimClaw() while the 70M lasts, forwards the ETH to the next address. (3) Each address calls TeamManager.createTeam, then loops MiningPool.startExpedition(teamId,0)/claimExpedition every 4h indefinitely, across seasons. Loss: honest miners lose emission share (~N/(N+honest weight) of ~5.9M CLAW/day in S1) and the glide re-pegs baseReward down for everyone; at 20k-100k sybil teams the take passes the documented 70M worst case within weeks and cannot be reversed after rotation. The 7,000-CLAW drips can also fund breeding, converting soulbound stock into tradeable offspring. Practical limit: Base gas per expedition vs CLAW price.

**Evidence.** contracts/Faucet.sol:108-123 (no cap; totalLobstersClaimed is a counter only), :88-95 (batch 500, ELIGIBILITY_ROLE only), :110-111,133 (balance checked only at claim), :140 (only claimClaw bounded by CLAW balance); contracts/LobsterNFT.sol:98-115 (mint has no supply cap), :151-153 (burn is BURNER_ROLE only and reverts on locked); contracts/TeamManager.sol:60-99 (createTeam accepts soulbound); contracts/MiningPool.sol:245-305 (startExpedition: ownership/tier/active only, no stake), :275,483 (demand-weighted glide); contracts/script/Configure.s.sol:85,165; docs/runbooks/admin-roles.md:17,153-158; docs/audits/2026-04-15-adversarial-campaign.md:969 (same miss).

**Suggested fix.** Hard cap inside claimLobsters (e.g. totalLobstersClaimed + 5 <= 50,000, matching the 10K-wallet / 70M design) and revert once reached; optionally rate-limit eligibility grants per day so a stolen key cannot use the whole cap before rotation; alert on EligibilitySet rate; correct the runbook blast-radius text; consider a time-boxed DEFAULT_ADMIN revocation path for faucet lobsters minted by a compromised key.

**Skeptic (code path): CONFIRMED, High.** **Verdict: confirmed, High.** A stolen faucet-eligibility key can mint unlimited free lobsters, and those lobsters can mine the 705M pool with no stake. The runbook's claim that the worst case is 70M CLAW is wrong. I traced every step in the code at HEAD 7ca5451 and found no guard that stops it.

**Step 1 — whitelisting.** `setEligibleBatch` is gated only by `ELIGIBILITY_ROLE` and a 500-per-call limit. There is no cap on the number of calls or on the total whitelisted.

**Step 2 — claiming lobsters.** `claimLobsters` checks four things:
- the faucet is still open (`closeTime`);
- the caller is whitelisted (`isEligible`);
- the caller holds at least 0.001 ETH at that instant, so the same ETH can be forwarded from wallet to wallet;
- the caller has not claimed before (`hasClaimedLobsters`).

It then mints 5 soulbound lobsters. `totalLobstersClaimed` is only incremented and is never compared to a limit. Nothing ties lobster claims to the faucet's CLAW balance; only `claimClaw` has a balance check. `LobsterNFT.mint` has no supply cap.

**Step 3 — forming a team.** `TeamManager.createTeam` checks existence, ownership and not-already-assigned. It has no soulbound check.

**Step 4 — mining.** `MiningPool.startExpedition` checks mine tier, active season, team owner, team not active, and that each lobster's tier meets the mine tier. Tier 0 passes for mine tier 0. There is no stake, no soulbound or faucet-origin gate, and no per-wallet limit.

The reward is `baseReward × weight`, minted immediately. The only ceilings are the season total and the lifetime 705M cap. There is no per-day or per-epoch spending cap.

**The finder understated the speed.** The glide re-pegs at most once per day and can cut the reward by at most 30% per step. A sudden wave of sybil teams therefore mines at close to the launch reward before the glide reacts. At 1,250 CLAW and 6 starts per day, roughly 47,000 sybil wallets mint about 352.5M in one day. That is the entire Season 1 budget, not "70M within weeks". Whitelisting them takes 94 batch transactions. After that, honest miners hit `SeasonBudgetExhausted` for the rest of the 60-day season. Smaller sybil fleets take a proportional share and push `baseReward` down for everyone.

**The documented blast radius is wrong.** `admin-roles.md` says "Worst case: 70M CLAW pre-mint drained" and "Drain past that is impossible". That holds only for the CLAW drip. The April 2026 audit repeats the same miss ("CLAW drip caps total inflation at 70M one-shot").

**Recovery is weak.**
- Rotating the key stops new whitelisting but not wallets already whitelisted.
- The multisig could call `setCloseTime` to shut the faucet.
- The multisig could call `setBaseReward(1)` to starve mining, but that starves honest miners too.
- Lobsters already minted persist: `burn` is `BURNER_ROLE`-only and reverts on locked (teamed) lobsters.
- There is no pause and no miner denylist.

**Severity.** The rubric says High for "one compromised hot key exceeding its documented blast radius". The `ELIGIBILITY_ROLE` key is documented as a hot service wallet, so this fits exactly. The attacker's cash profit is limited by the thin LP (about 6 ETH) and gas. The protocol-level damage is large: the season's emission is captured or the price collapses.

*What limits it.* - **Key theft is required.** The attacker needs the `ELIGIBILITY_ROLE` hot key, or the deployer EOA before Handoff, or must defeat off-chain eligibility screening at scale. Screening evasion is a documented, accepted sybil risk.
- **Time-boxed entry.** New lobsters can only be claimed while `block.timestamp < closeTime` (about 7 days, extendable or shortenable by admin). Lobsters already minted keep mining forever.
- **Profit limits.** Gas per `startExpedition`/`claimExpedition` cycle versus the CLAW price sets an equilibrium. The roughly 6 ETH LP depth bounds what the attacker can actually cash out. Later-season dilution from Base-tier (1x weight) sybil teams is bounded by gas.
- **Emission is diverted, not inflated.** The season and 705M caps still hold, so honest miners lose share and no extra supply is created.
- **Admin mitigations exist but are blunt.**
  - `revokeRole` stops new whitelisting but not wallets already whitelisted.
  - `setCloseTime` closes the faucet.
  - `setBaseReward` throttles all miners alike.
  - Reacting inside roughly a day depends on the multisig; the documented SLAs are 24h-class.
  - There is no on-chain way to remove sybil lobsters short of granting new roles and burning them one by one after unlocking.
- **Scale is feasible but visible.** Around 47k wallets is on the order of 1e11 gas, roughly 0.5-1 ETH on Base. It is noisy on-chain through `EligibilitySet` and `LobstersClaimed` events.

**Skeptic (preconditions and economics): PLAUSIBLE, Medium.** The defect is real, but the finding overstates the economics and is wrong that it cannot be reversed. I rate it Medium, not High.

**Decision:** cap faucet lobster claims and correct the runbook text. This is hardening plus a documentation fix. It is not a funds-loss emergency.

**What I confirmed in the code**
- `claimLobsters` has no global cap and does not depend on the faucet's CLAW balance. Its only checks are: window open, caller eligible, caller holds at least 0.001 ETH, and not already claimed. `totalLobstersClaimed` is a counter that nothing reads.
- The 0.001 ETH balance is checked only at claim time, so the same ETH can be passed from wallet to wallet.
- `setEligibleBatch` whitelists up to 500 addresses per transaction with no rate limit. Only `claimClaw` is bounded, by the 70M CLAW balance.
- `LobsterNFT.mint` has no supply cap.
- `createTeam` accepts soulbound lobsters.
- `startExpedition` takes no stake and has no faucet or soulbound gate.
- The glide sets `target = remaining / (remainingDays × trailing)` with a ±30% step, so sybil demand takes a pro-rata share of the daily budget and pushes `baseReward` down for everyone.
- The runbook names the worst case as the 70M pre-mint and says "Drain past that is impossible". It mentions the 5 free lobsters but never the mining share they earn. The April audit's "soulbound output limits damage" line has the same gap.

**Why High does not hold**
- **No new inflation.** The season budget and the 705M lifetime cap still bind. The attack redistributes a competitive emission pool that the design itself calls a gold rush with whales welcome. It does not mint extra CLAW or take escrowed funds.
- **The economics limit themselves.**
  - S1 emits about 5.9M CLAW per day, roughly $590 per day at the $0.0001 launch price.
  - A start-plus-claim cycle is roughly 300k gas, which I estimate at about $0.005–0.01 on Base.
  - At launch price, mining breaks even once `baseReward` glides to roughly 50–100 CLAW, which is around 15k total Base teams.
  - The finder's 20k–100k sybil-team scenario loses money at launch price. It works only if CLAW appreciates several-fold, and the attacker's profit is then capped by the daily emission value minus gas.
- **"Cannot be reversed" is wrong.**
  - `getEvolutionTier` reverts for a lobster that no longer exists, so burning one lobster of a sybil team stops that team mining permanently.
  - The Safe holds `DEFAULT_ADMIN` on LobsterNFT. It can grant `LOCKER_ROLE` and `BURNER_ROLE` to a batch-sweeper contract, then unlock and burn in batches.
  - Only CLAW already claimed is unrecoverable. The response is laborious but realistic, and the 7-day window plus key rotation bound the number of sybil wallets.
- **The deployer window adds nothing.** Between Configure and Handoff the deployer EOA also holds `DEFAULT_ADMIN` everywhere.
- **Breeding drips into tradeable offspring is by design.** CLAUDE.md allows soulbound parents to breed tradeable offspring.

**What remains valid**
- The runbook's blast-radius statement is incomplete. A compromised or fooled eligibility operator affects the 352.5M S1 mining pool share and the glide rate for honest miners, not only the 70M drip.
- The designed faucet size of about 10K wallets and 50K lobsters is not enforced on-chain.
- Off-chain screening is the only barrier, so a sybil operator who passes it gets the same effect without any key compromise.

This is bounded dilution and griefing of honest miners, plus a documented invariant that the contract does not enforce. That fits Medium.

*What limits it.* - The attacker needs the `ELIGIBILITY_ROLE` hot key, or must defeat the off-chain screening.
- The attack works only while the faucet window is open, which is 7 days. Key rotation stops new whitelisting.
- The take is bounded by the season budget and the 705M cap. It is a share of a competitive emission, not new mint and not theft of escrow.
- The glide and Base gas cap the scale. At the $0.0001 launch price, mining breaks even at roughly 15k total teams, and the attacker's gross is at most about $590 per day. The 20k–100k team scenario needs CLAW to appreciate several-fold.
- The Safe can grant `LOCKER_ROLE` and `BURNER_ROLE` to a batch sweeper and burn one lobster per sybil team. `startExpedition` then reverts for that team. Only CLAW already claimed is lost.

### D-04

**A 10% dispute bond (250 CLAW at Low) lets either participant -- including the proposed winner -- freeze the opponent's payout AND lock their whole team out of mining, battling and boost qualification until the multisig acts**

- Severity after verification: **Medium** (claimed Medium) · status **confirmed** · reported by: ba-funds, ba-state, ba-dispute, locks
- Location: contracts/BattleArena.sol:514-540 (disputeBattle: participant-only, bond only); :546, :733-736, :748-750 (every non-admin exit blocked once disputed); :914-917, :943-949, :980-989 (teams released only in _executePayout/_cancelBattle/_forfeit); contracts/MiningPool.sol:253 (shared active flag blocks mining)

**What goes wrong.** Plain language: filing a dispute needs no evidence and costs only the bond (250 / 1,000 / 5,000 CLAW), slashed only if the admin changes nothing. Once filed, the battle can only be closed by adminResolveDispute from the DEFAULT_ADMIN multisig (24h SLA, no on-chain deadline). The known/accepted consequence is frozen escrow. The unpriced, cross-contract consequence is that BattleArena and MiningPool share ONE boolean (TeamManager.Team.active), set at reveal and cleared only at payout: while disputed, the victim's team cannot start a mining expedition, cannot be disbanded, its lobsters cannot be sold/evolved/bred, and it cannot play the other battles the team-keyed boost requires (7-14 PLAYED per week). The check is only 'is a participant', so a player does not even need to lose to use this. The cost asymmetry is what matters: the bond scales with the STAKE bracket while the victim's loss scales with TEAM tier -- ~22,500 CLAW/day forgone for 3x Evolved and ~187,500 CLAW/day for 3x Apex at the 1,250 launch reward (plus up to +50% boost), i.e. up to ~750x the Low bond. Power-9 Apex teams can play Low (same-power pairing, or adaptive radius 'any power within stake bracket' after 120s). A slashed bond goes 100% to Treasury, never to the victim. The griefer's own team is locked too, but a throw-away 3x Evolved team that never mines makes that irrelevant, and the 5/24h rate limit is per address (threat model: many wallets). Motive: mining is a fixed seasonal budget whose per-expedition reward glides UP when demand falls, and the boost is a percentile on one global ladder with a played-battles floor -- knocking rivals out for a day raises the attacker's own share and percentile (e.g. freeze a competitor near the end of an epoch). There is no batch resolve and a slash requires the multisig to re-enter the exact winner, hashes and both damage arrays, so cheap spam disputes can push genuine disputes past the SLA. This is distinct from the known AWOL-admin risk: it needs no admin failure, only the normal 24h SLA; prior audits priced bonds against stake and considered frozen escrow only.

**Attack.** Actor: any player (agent with many wallets), including the player who WON; one wallet per 5 disputes/day. (1) Get matched against a high-value team at Low stake; deposit, commit, play normally or resign immediately (result irrelevant). (2) Resolver calls settle(); phase = AwaitingFinalize. (3) Within the 5-min window: clawToken.approve(arena,250e18); disputeBattle(battleId, ''). (4) finalizeBattle reverts BattleIsDisputed (:546), handleTimeout reverts DisputedBattleRequiresAdmin (:734-735), emergencyWithdraw is Active-phase only (:750); _releaseTeam is never reached. (5) Victim's MiningPool.startExpedition reverts TeamIsActive; TeamManager.disbandTeam reverts; lobsters stay locked; victim's 4,500 + 125 CLAW payout stays escrowed. (6) Lasts until a 3-of-5 Safe executes adminResolveDispute (up to 24h by policy; unbounded on-chain). Repeat across wallets. Loss: victim loses up to 6 expeditions/day on that team (22.5K-187.5K CLAW/day at launch reward, more with boost), battles toward weekly boost qualification, and time value of the payout; attacker loses 250 CLAW (+2,500 stake if they lost). Every staged dispute also consumes a multisig signing round.

**Evidence.** contracts/BattleArena.sol:517 (_requireParticipant only), :528-535 (bond is the only cost), :293-295 (bonds 250/1,000/5,000; re-verified), :97-98 (5 per 24h; re-verified), :445-449 (teams set active at reveal), :546, :734-735, :750 (exits blocked), :914-915, :948-949, :1007-1008, :1032-1033, :980-989 (release sites), :588-601 (slash requires exact match of winner, damage arrays, hashes; slashed bond -> Treasury :590-593/:599); contracts/TeamManager.sol:19,108,137-141 (single shared active flag; active team cannot be disbanded); contracts/MiningPool.sol:253 (TeamIsActive; re-verified); contracts/LobsterNFT.sol:153,303; contracts/EvolutionLab.sol:67,99; contracts/BreedingLab.sol:287 (locked lobsters cannot transfer/burn/evolve/breed); docs/runbooks/admin-roles.md:11,66 (24h SLA, 'No emergency-cancel exists by design'); docs/runbooks/boost-epoch.md:28-33; packages/game-logic/src/rating.ts:64-68; contracts/BattleArena.sol:55-57 and docs/audits/2026-04-15-adversarial-campaign.md:265,983 (only AWOL-admin / frozen escrow acknowledged).

**Suggested fix.** Pre-mainnet (contracts are non-upgradeable), pick one or more: (a) split the lock -- release both teams (or downgrade to a 'battleHold' state that blocks disband but not MiningPool.startExpedition) at settle() or at dispute time, applying the proposed/neutral damage or deferring _applyDamage against recorded team ids, so a dispute freezes only the money; (b) pay part of a slashed bond to the non-disputing party and scale the bond with team Power/tier (e.g. >= the locked team's tier-weighted mining over the SLA), not only stake bracket; (c) do not allow the proposed winner to dispute unless the proposal is a draw; (d) add a bounded on-chain long-stop (e.g. 72h disputed -> anyone may finalize the resolver's proposal and slash the bond, or release teams while escrow stays frozen), which also closes the AWOL-admin trap; (e) add a batch adminResolveDispute plus an 'uphold proposal' shortcut that needs no re-entry of hashes/damage. Add the mining/boost lock-out to the SLA rationale in admin-roles.md.

**Skeptic (code path): CONFIRMED, Medium.** Plain language: the defect is real. Any participant, including the proposed winner, can pay the dispute bond and freeze both the money and both teams until the multisig calls adminResolveDispute. No on-chain guard prevents it. The finder overstates how far the attack scales. Medium stands, and it is not High.

Code path, step by step:
- disputeBattle (contracts/BattleArena.sol:514-538) checks only four things: phase is AwaitingFinalize, caller is a participant, the dispute window is still open, and the battle is not already disputed. It then applies the rate limit and pulls the bond.
- It does not check msg.sender against proposedWinner and does not validate evidence, so the winner can dispute.
- Once disputed is true, finalizeBattle reverts at :546 and handleTimeout reverts at :735. emergencyWithdraw requires Active phase (:750).
- The only remaining exit is adminResolveDispute (:559-569, DEFAULT_ADMIN_ROLE), and it has no on-chain deadline.
- revealTeams sets teamInBattle and TeamManager.active to true for both teams at :445-448.
- The only place they are cleared is _releaseTeam (:980-989). It is called from _executePayout (:914-915, :948-949), _cancelBattle (:1007-1008) and _forfeit (:1032-1033). A disputed battle can reach none of those without the admin.

Cross-contract effect:
- MiningPool.startExpedition reverts TeamIsActive on the same flag (contracts/MiningPool.sol:253).
- TeamManager.disbandTeam reverts on active (contracts/TeamManager.sol:108), so the lobsters stay locked. Lobster locks are set at createTeam (:95) and cleared only at disband (:114).
- Locked lobsters cannot evolve, be used as fuel, or breed (contracts/EvolutionLab.sol:67,99; contracts/BreedingLab.sol:287).
- _validateTeamForBattle rejects teams with teamInBattle or active set (:867-870), so the victim's team cannot play other battles during the freeze.
- The bonds are 250 / 1,000 / 5,000 CLAW (:293-295).
- A slashed bond goes 100% to Treasury (:598-600). The victim gets nothing.

Prior coverage: the earlier audits considered only frozen escrow and an absent admin (docs/audits/2026-04-15-adversarial-campaign.md:983; docs/audits/2026-05-01-v3-s1-campaign.md:56-58,142). The 05-01 campaign priced the bond against the stake bracket only (its E-01 to E-09 checks, :56). The mining lockout is not mentioned in those passages. This is a new consequence, not a repeat of the known items.

Arithmetic: six expeditions a day at 3,750 CLAW is 22,500 CLAW for a 3x Evolved team. Six at 31,250 is 187,500 CLAW for a 3x Apex team. Both match the launch reward.

Where the finder overstates:
- The attacker's own team is also locked. _validateTeamForBattle blocks it (:867-870) and teamInBattle is only cleared in _releaseTeam (:981). Each frozen victim team therefore costs the attacker one idle Evolved+ team for the same duration.
  - The real limit is one attacker team per frozen victim team, not the 5-per-24h rate limit.
  - The finder's "one wallet per 5 disputes/day" framing is misleading: five concurrent freezes need five spare battle-ready teams.
  - An Evolved team costs roughly 9 Base lobsters plus 6K CLAW.
- The value asymmetry needs a cross-power pairing. The matchmaker uses exact power for the first 30 seconds and only reaches "any power" after 120 seconds (packages/game-logic/src/matchmaker.ts:11-15,34-38). Rating bands also apply.
  - Against an equal-power opponent the attacker locks capital of equal value.
  - The attacker cannot choose the opponent on-chain. createBattle is MATCHMAKER-only (:305-314). Targeting depends on sniping the off-chain queue.
- Nothing is lost permanently. The harm is the victim's forgone mining and boost qualification, plus the time value of the payout, for up to the 24h SLA. No funds can be stolen.
- Serial abusers can be excluded off-chain by the matchmaker.

Net: this is griefing with a real, bounded cost to victims, and the bond and SLA design do not price it. That is Medium under the rubric. It is not High because no funds are lost or permanently locked and the attacker pays with matching locked capital.

*What limits it.* - No on-chain guard stops the freeze itself. These factors limit its impact.
- The attacker's own team is locked for the same duration (contracts/BattleArena.sol:867-870, :981).
  - One spare Evolved+ team is needed per concurrent freeze. An Evolved team costs roughly 9 Base lobsters plus 6K CLAW.
  - The per-address limit of 5 per 24h is not the binding constraint, so the finder's "many wallets" scaling is weaker than claimed.
- The attacker cannot choose the opponent on-chain. createBattle is MATCHMAKER-only (:305-314).
  - A high-value mismatch, such as Power 3 against Power 9 at Low stake, needs both sides to wait more than 120 seconds in the queue, or the attacker to field an equal-power team, which means equal locked capital.
  - Rating bands narrow the targeting further.
- Per dispute, the attacker pays the bond, the 10% protocol fee or stake loss, and the time value of their own frozen payout.
- The harm is bounded by how fast the multisig responds (24h by policy). Nothing is lost permanently and funds cannot be stolen.
- The operator can ban serial frivolous disputers at the matchmaker and API layer.
- An honest dispute causes the same lockout for both parties. This is a design cost, not only an attack.

### D-05

**The 5-per-24h dispute rate limit also caps an honest player's veto, and upheld disputes never give the slot back: under a lying RESOLVER (or a buggy engine) a busy agent's 6th+ mis-settled battle in a day is uncontestable**

- Severity after verification: **Medium** (claimed Medium) · status **confirmed** · reported by: ba-dispute, ba-trust, ba-state
- Location: contracts/BattleArena.sol:523 (slot consumed before the bond pull); :823-856 (_addDisputeTimestamp, reverts at validCount >= 5); :559-617 (adminResolveDispute never returns a slot)

**What goes wrong.** Plain language: the accepted trust model is 'the resolver may lie, but the player can veto within the window and the multisig decides'. Each address can dispute at most 5 times per rolling 24h, and a slot is consumed for every dispute including ones the admin later upholds; nothing in adminResolveDispute's disputerWon branch removes the timestamp. Only the two participants may dispute, finalizeBattle is permissionless once the window passes, and the admin cannot touch an undisputed battle (NotDisputed). So after 5 disputes in a day every further wrong settlement against that address finalizes unchallenged. The role runbook bounds RESOLVER compromise by 'Players have 5-min veto via disputeBattle' and does not mention this ceiling. Battle-focused agents play far more than five battles a day (a Low cycle is ~8 minutes incl. the window; unlimited team slots allow many concurrent battles; createBattle has no per-address concurrency check; settle() has no minimum Active duration), and key rotation needs a 3-of-5 Safe tx. The bond already makes frivolous disputes costly, so the hard cap mainly hurts honest high-volume players in exactly the scenario the dispute system exists for. A non-malicious engine bug that mis-settles the same agent more than 5 times a day has the same effect. Arguable as High under the rubric (hot key exceeding documented blast radius); finders rated Medium because NatSpec does say 'bonded player veto with rate limit' and the victim must keep playing or have >5 battles in flight.

**Attack.** Actor: holder of a compromised RESOLVER_ROLE hot key plus attacker wallets queued as ordinary players. Precondition: victim V is an automated agent that keeps re-queuing or runs several teams concurrently. (1) Attacker wallets are matched against V (e.g. High bracket, 50,000 stake). (2) After revealTeams the attacker immediately calls settle(battleId, attackerWallet, nonzeroHash, nonzeroHash, dmgA, dmgB). (3) V disputes battles 1-5 (bond 250/1,000/5,000 each, all eventually refunded) -- each still burns a slot at :523. (4) On battle 6+ within 24h V's disputeBattle reverts DisputeRateLimitExceeded (:841-847). (5) After the window anyone calls finalizeBattle (:543-550); attacker wallet receives 0.9 x 2 x stake + anti-grief. Loss: V loses the full stake per uncontestable battle (up to 50,000 CLAW; attacker nets 40,000), uncorrectable: no post-finalize remedy, admin cannot act on an undisputed battle (:569).

**Evidence.** contracts/BattleArena.sol:97-98 (DISPUTE_RATE_WINDOW = 24h, DISPUTE_RATE_LIMIT = 5; re-verified), :514-540 (disputeBattle: _addDisputeTimestamp at :523 before bond pull), :823-856 (only writer of _disputeTimestamps; other refs at :172,:775 only), :559-617 (no rate-limit refund in disputerWon branch :594-601), :569 (NotDisputed), :543-554 and :733-736 (permissionless finalize), :305-337 (no per-player concurrency limit), :474-501 (no minimum Active time); docs/runbooks/admin-roles.md:29,94-95; docs/audits/2026-05-01-v3-s1-campaign.md:56 (earlier 'rate-limit Sybil' lens looked at spam bypass only, not victim lock-out).

**Suggested fix.** Count only slashed disputes: record the timestamp in adminResolveDispute's slash branch, or pop the disputer's most recent timestamp when disputerWon; and/or let an over-quota dispute through at a higher bond (e.g. 2x) instead of reverting. Add an admin escape hatch (DEFAULT_ADMIN or a GUARDIAN role may mark an undisputed AwaitingFinalize battle as disputed with no bond during the window, or freeze finalization of proposals from a revoked resolver) so key compromise can be contained without relying on each victim's 5 slots.

**Skeptic (code path): CONFIRMED, Medium.** Plain language: the defect is real and every step executes as claimed. An address gets 5 disputes per rolling 24 hours. A dispute the multisig later upholds still uses a slot. From the 6th wrongly settled battle in a day, the victim cannot contest. Anyone can finalize once the window closes, and the admin has no way to intervene on a battle nobody disputed.

Code walk:
- disputeBattle checks phase, participant, window and AlreadyDisputed. It then calls _addDisputeTimestamp(msg.sender) at :523, before the bond pull.
- _addDisputeTimestamp prunes entries older than 24h and reverts DisputeRateLimitExceeded when validCount >= 5 (:837-841). Otherwise it pushes the timestamp. It is the only writer of _disputeTimestamps; the only other reference is the view at :775.
- adminResolveDispute (:559-611) refunds the bond when disputerWon but never touches _disputeTimestamps. A vindicated dispute still costs a slot for 24h.
- adminResolveDispute reverts NotDisputed at :569 when the battle is undisputed.
- finalizeBattle (:543-550) and handleTimeout's AwaitingFinalize branch (:735-737) are permissionless. Both pay b.proposedWinner once payoutDeadline passes.
- I listed every DEFAULT_ADMIN function in the contract. They are adminResolveDispute and the dispute-window and dispute-bond propose/enact pairs. None can freeze, cancel or override an undisputed AwaitingFinalize battle, and nothing acts after finalization.
- settle() (:474-499) needs only the Active phase, a timestamp <= phaseDeadline, a participant or zero winner, and nonzero hashes. There is no minimum Active duration and no check on the hashes.
- createBattle (:305-337) has no per-address concurrency limit. Concurrency is bounded only by how many teams and deposits the victim commits.

So under a lying RESOLVER, or a buggy engine, the victim vetoes 5 battles and every further mis-settlement in that day finalizes unchallenged. admin-roles.md:29 and :95 bound resolver compromise by a "5-min veto" and do not mention the 5-per-day ceiling.

Why Medium and not High:
- The 5/24h rate limit is a documented design parameter in CLAUDE.md and the NatSpec, not a hidden behaviour.
- The attacker needs the RESOLVER key plus wallets that really get matched against the victim through the separate MATCHMAKER.
- The victim must voluntarily deposit into more than 5 battles after the mis-settlements start. Each deposit is a fresh consent, and an agent could halt after the first bad settle.
- Loss per battle is bounded by the stake.

It is still a genuine gap that the dispute backstop cannot correct, and it caps the veto exactly when it is needed. Not returning the slot on an upheld dispute has no anti-spam justification, because the bond already prices frivolous disputes.

*What limits it.* - The attacker needs a compromised RESOLVER_ROLE hot key, or there must be a systematic engine bug.
- Attacker wallets must actually be paired with the victim by the separate MATCHMAKER key. The resolver key alone cannot create battles.
- The victim must deposit into more than 5 battles within 24h with mis-settling opponents. A prudent agent stops queuing after the first bad settle, so the realistic exposure is battles already in flight plus auto-requeue bots.
- Loss per battle is capped at the stake (max 50,000 CLAW).
- The multisig can revoke the key, but that needs a Safe transaction and does not stop proposals already in AwaitingFinalize from finalizing.
- The 5/24h limit itself is documented in CLAUDE.md and the NatSpec.

### D-06

**A stolen RESOLVER key can settle a battle the instant teams are revealed, so the dispute window (5 min at Low) runs out while the honest battle is still being played -- and the honest engine, indexer and finalize-watcher mask and then complete the rogue payout**

- Severity after verification: **Medium** (claimed Medium) · status **confirmed** · reported by: binding, ba-state
- Location: contracts/BattleArena.sol:474-499 (settle: no lower time bound; payoutDeadline = settle time + window at :496-497)

**What goes wrong.** Plain language: the docs accept that a stolen RESOLVER key can propose a wrong winner; the stated bound is 'players have a 5-minute veto'. That veto assumes the player knows a result was proposed. In V2 settle() reverted unless at least one round had both players' moves revealed on-chain (SettlementRequiresVerifiedRound, b3eecde:537), so players were necessarily watching the chain. In V3 settle() is valid one block after revealTeams and needs no player acknowledgement; the window is anchored at the settle timestamp, while both players are busy playing a 3-5 minute (up to 100-minute) battle over WebSocket on the uncompromised API, and nothing in the session protocol tells them a proposal exists. For Low the window typically closes before the real battle ends; finalizeBattle is permissionless, and once finalized neither player nor admin has any remedy (adminResolveDispute requires `disputed`; no pause exists). The honest off-chain stack works against the victim: (1) when the real battle ends the honest settle job sees the phase already past Active and returns ok ('nothing to do') without comparing the on-chain proposedWinner/hashes with its own payload; (2) the indexer's BattleProposed handler OVERWRITES battle_sessions.final_state_hash/turn_log_hash with whatever was posted on-chain, erasing the one cheap mismatch signal; (3) the finalize-watcher then finalizes any undisputed proposal with the operator key. No alarm fires and the honest stack itself completes the payout. Requires the hot key plus the thief being a participant (cheap with many wallets); it exceeds the documented 'bounded blast radius' because no victim is in a position to use the veto the bound depends on. One finder rated the on-chain half Low, another the full cross-layer picture Medium; Medium kept.

**Attack.** Actor: holder of a leaked RESOLVER hot key who also queues as an ordinary player (or a partner does). Precondition: attacker wallet matched into a battle (Low/Mid best). (1) Honest matchmaker createBattle -> both deposit/commit -> honest server revealTeams; phase = Active. (2) Attacker immediately calls settle(battleId, attackerWallet, anyNonZeroHash, anyNonZeroHash, [0,0,0], [40,40,40]) -- passes all checks at :483-486. (3) The off-chain session keeps running; victim keeps playing, unaware. (4) After 5 minutes anyone can finalize -- the project's own finalize-watcher does it (finalize-watcher.ts:134-136); attacker receives 1.8x stake + anti-grief. (5) When the real session ends, settle-battle.ts:72-74 returns ok without comparing anything (a fresh settle would revert InvalidBattlePhase). Loss: victim loses the full stake (2,500 at Low; 10,000 at Mid if the battle runs >30 min, e.g. a human on 60s shot clocks; 50,000 at High past 1h) and takes up to 40 damage per lobster. Repeats on every battle until the key is rotated.

**Evidence.** contracts/BattleArena.sol:482-499 (settle preconditions: role, phase Active, not past ACTIVE_WINDOW, winner in {A,B,0}, non-zero hashes; no elapsed-time gating), :288-290 (windows 5 min / 30 min / 1 h; re-verified), :543-550 (permissionless finalize), :566-569 (admin only on disputed battles); git show b3eecde:contracts/BattleArena.sol:537 (V2 lastVerifiedRound == 0 revert, removed); apps/engine/src/operator/jobs/settle-battle.ts:70-75; apps/indexer/src/watchers/battle-watcher.ts:294-302; apps/engine/src/combat/finalize-watcher.ts:112-136; apps/api/src/lib/battle-session/manager.ts:313-319 (chain phase checked only on resume); docs/runbooks/admin-roles.md:94-95,192; docs/runbooks/battle-session.md (3-5 min typical, up to 100 turns x 60s).

**Suggested fix.** On-chain: add a minimum Active duration before settle(), or start the dispute clock at max(now, reveal + minimum battle time) / ensure payoutDeadline cannot expire earlier than the theoretical battle length after reveal unless both players acknowledge; give DEFAULT_ADMIN/GUARDIAN a bond-free adminFlagBattle(battleId) to freeze in-flight proposals on a detected key leak. Off-chain: in settle_battle, when the phase is already past Active, compare getBattle().proposedWinner/hashes/damage with the payload and on mismatch mark the job dead with a page-worthy error and push a WebSocket notice so the player can dispute; store on-chain hashes in separate columns and alert on mismatch; have the finalize-watcher refuse proposals that do not match the session result; have clients/agent kit subscribe to BattleProposed for their live battles and auto-dispute a proposal that arrives while the session is still active.

**Skeptic (code path): CONFIRMED, Medium.** **Verdict: CONFIRMED at Medium.** A stolen RESOLVER key held by a battle participant can pay out a false result at Low stake before the real battle ends. Nothing on-chain or in the honest off-chain stack stops or flags it. I checked by reading source only; no build or tests were run, per the rules.

**On-chain path (every step executes as the finding claims)**
- `revealTeams` sets the phase to Active and `phaseDeadline = now + 3h`.
- `settle()` checks only five things:
  - the caller holds RESOLVER_ROLE;
  - the phase is Active;
  - the time is not past `ACTIVE_WINDOW`;
  - the winner is playerA, playerB or zero;
  - both hashes are non-zero.
- There is no lower time bound and no player acknowledgement. A settle in the block after `revealTeams` is valid, with arbitrary hashes and damage up to the `uint8` range.
- The dispute clock starts at the settle timestamp: `payoutDeadline = block.timestamp + disputeWindows[bracket]`, which is 5 min / 30 min / 1 h.
- After that, `finalizeBattle` and the AwaitingFinalize branch of `handleTimeout` are both permissionless. They pay the proposal exactly as posted.
- `adminResolveDispute` reverts `NotDisputed` unless a participant has already disputed. No other admin function touches an in-flight proposal; the only other DEFAULT_ADMIN functions are the window and bond setters. There is no pause.
- So once the window lapses undisputed, there is no remedy on-chain.
- The old V2 guard really existed at b3eecde:537 (`lastVerifiedRound == 0` reverts `SettlementRequiresVerifiedRound`) and is gone.

**Off-chain path**
- **Settle job:** `settle-battle.ts` returns ok when the phase is already AwaitingFinalize or Settled. It never compares the on-chain proposal with its own payload.
- **Finalize watcher:** it finalizes any undisputed AwaitingFinalize battle past its deadline, using the operator key, with no check against the session result.
- **Player notification:** nothing in apps/api or apps/web source consumes BattleProposed or calls `disputeBattle`. The session manager reads the chain phase only on resume. A player in a live WebSocket session gets no signal that a proposal exists.

**Correction to the finding (indexer)**
- The indexer's BattleProposed handler does overwrite `battle_sessions.final_state_hash` and `turn_log_hash`, and sets status to 'settling'.
- In the instant-settle ordering, the honest `markFinished` (manager.ts:382) later writes the honest hashes back. The DB therefore ends with honest hashes while the chain holds the rogue ones.
- The mismatch is not erased. Nothing compares the two, so it is simply never looked at. The finding's erasure claim only holds if the rogue settle front-runs the honest one at battle end.
- This does not change the outcome.

**Why Medium and not higher**
- It needs a compromised hot key, and the thief must be a participant, because the winner must be playerA or playerB.
- The loss per battle is the victim's stake plus proposed damage.
- In practice it is mostly a Low-bracket attack. Agent battles finish in minutes, so the Mid (30 min) and High (1 h) windows usually outlast the real battle. Those brackets are exposed only in unusually long matches.
- A participant that independently watches BattleProposed for its own battleId can still dispute in time. The veto is unused, not unreachable.

**Why not lower**
- The documented bound is "Players have 5-min veto", and incident response for hot keys is "no paging required — bounded blast radius".
- That bound assumes a player knows a result was proposed. In V3 nothing guarantees that.
- The honest stack completes the rogue payout silently. A key leak therefore goes undetected and the attack repeats every battle until rotation.
- After finalize it cannot be corrected.

*What limits it.* - **Key and participation:** the attacker needs the RESOLVER hot key and must be playerA or playerB of the battle, since `settle` reverts `InvalidWinner` otherwise. The key alone cannot create or reveal battles without player salts, so the attacker must queue, deposit and be matched normally, staking their own funds each time.
- **Loss cap:** the loss per battle is one stake plus proposed damage. The attacker nets 0.8x the stake per battle after the 10% fee.
- **Bracket exposure:** the attack is mostly practical at Low. The Mid (30 min) and High (1 h) windows outlast typical 3-5 minute agent battles, so those brackets are exposed only in long matches, such as a human running down 60-second shot clocks.
- **Veto still reachable:** a participant that independently subscribes to BattleProposed for its own battleId can dispute within the window. The bond is 10% of the stake, with a limit of 5 disputes per 24 h, and the admin can then correct the result.
- **Visible on-chain:** `BattleProposed` is emitted on-chain, so an external monitor could catch the attack.
- **Rotation:** key rotation via the multisig ends the attack. There is no on-chain freeze for proposals already in flight.

### D-07

**The public battle API publishes the first revealer's teamId and salt before the on-chain atomic reveal, turning the costless reveal-timeout cancel into a free matchup-dodge (F5-01 reopened off-chain, now with no 5% cost)**

- Severity after verification: **Medium** (claimed Medium) · status **confirmed** · reported by: ba-trust, ba-reveal
- Location: apps/api/src/routes/game/combat/battle-reads.ts:23-28 (redaction strips only queuedTeamA/B) with apps/api/src/routes/game/combat/battle-writes.ts:141-146 and contracts/BattleArena.sol:1061-1063 (costless mutual cancel)

**What goes wrong.** Plain language: F5-01 made the on-chain reveal atomic so neither player can see the other's team and then bail, and on that premise made a reveal-window timeout a full-refund mutual cancel with no penalty. That is only safe if nothing about either team leaks before the single revealTeams tx. The off-chain half leaks it: when the first player POSTs their salt, the server writes that player's teamId into the public battles.teamA/teamB column (0 until then, so a non-zero value is an unambiguous signal) and the salt into revealSaltA/B, and the unauthenticated GET /api/game/combat/:battleId (and /history?address=) returns the whole DB row after stripping only queuedTeamA/queuedTeamB. Whoever posts second can read the opponent's exact team (TeamManager.getTeam -> lobsterIds -> DNA/class/tier/damage on-chain) and, if the matchup (class counters 1.25x/0.80x, purity, legends) is bad, never submit their own salt; the contract then cancels with full refunds including anti-grief. Before F5-01 this dodge cost 5%; now it costs nothing, strictly worse than the state the June campaign reported, and it works against everyone who posts first. Between rational agents both wait to be second, so battles systematically die in the 20s reveal window (liveness collapse), or honest first-posters only ever play matchups pre-screened against them (adverse selection; also skews the rating ladder that drives the mining boost). The contract behaves as designed; its safety argument (NatSpec at revealTeams/_handleRevealTimeout: 'no information ever reached the chain to dodge on') silently depends on the resolver-side service keeping the first salt private. The salt alone is not further exploitable on-chain since revealTeams is RESOLVER-only. Redaction tests were deferred, so nothing catches this.

**Attack.** Actor: either battle participant (any wallet, no keys). Precondition: battle in TeamReveal (both deposited and committed). (1) Attacker commits a valid hash; (2) instead of POSTing its salt, polls GET /api/game/combat/<battleId> every second; (3) honest opponent POSTs /reveal-team -> response now shows db.teamA (or teamB) = opponent's real teamId plus revealSaltA; (4) attacker reads the team's lobsters/classes/DNA from chain and evaluates the matchup; (5) favourable -> POST own salt, battle proceeds; unfavourable -> do nothing; after TEAM_REVEAL_WINDOW anyone calls handleTimeout -> _handleRevealTimeout -> _cancelBattle(MutualTimeout), attacker refunded 100% (stake + anti-grief). Victim: the honest first revealer loses the expected value of every favourable matchup and plays only the unfavourable ones (up to 50,000 CLAW High stake per battle at risk), plus wasted gas and ~3 minutes of locked funds per dodged battle. Cost to attacker: gas only.

**Evidence.** apps/api/src/routes/game/combat/battle-writes.ts:126 (route requires chain phase TeamReveal), :141-146 (first salt POST persists teamA/teamB = teamId and revealSaltA/B; re-verified at HEAD); apps/api/src/routes/game/combat/battle-reads.ts:23-28 (redactPrivateBattleFields drops ONLY queuedTeamA/B; re-verified), :40-57 (/history unauthenticated, full row), :66-87 (/:battleId unauthenticated, full row); apps/api/src/lib/matchmaker/match.ts:351-352 (teamA/teamB start at 0n); apps/api/src/lib/chain.ts:406-418 (serializer does not filter); packages/db/src/schema/battles.ts:8-9,20-25 (salt columns on the same row); contracts/BattleArena.sol:1061-1063 and :991-1011 (full refunds, no slash), :397-410 NatSpec; docs/HERMES_HANDOFF.md:711 (redaction tests deferred).

**Suggested fix.** Off-chain: never write the revealed teamId into the public teamA/teamB columns at salt-POST time -- store it in private columns (revealTeamA/B) alongside the salts and let only the indexer's on-chain TeamRevealed handler populate teamA/teamB; switch public reads from a deny-list to an explicit allow-list projection; add the deferred redaction tests asserting GET /:battleId and /history never contain a salt or a non-zero team (and do not change) between the first salt POST and chain phase >= Active. On-chain hardening so the guarantee does not rest on an API: make a reveal timeout where exactly one salt was delivered attributable (resolver-signed receipt / report) so the withholding side forfeits the anti-grief.

**Skeptic (code path): CONFIRMED, Medium.** Every step of the dodge executes against the code at 7ca5451 and no guard stops it.

**What the finding means.** F5-01 made the on-chain reveal atomic, so that neither player can see the other's team and then walk away. On that basis it made a reveal timeout a full-refund cancel with no penalty. The off-chain API undoes this. The first player to hand over a salt has their team published on a public endpoint before the on-chain reveal. The second player can inspect that team and, if the matchup is bad, withhold their own salt and get everything back.

**The call sequence, step by step.**
- `POST /:battleId/reveal-team` requires wallet auth, that the caller is a participant, and that the chain phase is TeamReveal. It checks `(teamId, salt)` against the on-chain commit hash, so whatever gets stored is the player's real committed team.
- The route then writes `teamA`/`teamB = teamId` and `revealSaltA`/`revealSaltB = salt` onto the shared `battles` row.
- Those team columns are inserted as `0n` at match creation. A non-zero value is therefore an unambiguous signal that the opponent has revealed.
- `GET /api/game/combat/:battleId` and `GET /history?address=` have no `walletAuth`. Both run `select()` on the whole row and pass it through `redactPrivateBattleFields`, which removes only `queuedTeamA` and `queuedTeamB`.
- `serializeBigInts` filters nothing. So `db.teamA`/`db.teamB` and `db.revealSaltA`/`db.revealSaltB` are returned to any anonymous caller.
- The only middleware in front of these routes is `rateLimit(100)` on `/api/*`, which I take to be per minute. One poll per second fits under that.
- The RevealWatcher polls every 2 seconds and submits `revealTeams` only when both salts are non-null. The first poster's team therefore sits in the public row for as long as the second player withholds.

**The on-chain side.**
- `revealTeams` is restricted to `RESOLVER_ROLE`, so nothing a player does on-chain can force the reveal.
- After `phaseDeadline`, the permissionless `handleTimeout` calls `_handleRevealTimeout`, which calls `_cancelBattle(MutualTimeout)`. That refunds `stake + antiGrief` to both depositors and makes no `_forfeit` or slash call.
- The NatSpec premise on `revealTeams` and `_handleRevealTimeout`, "no information ever reached the chain to dodge on", is true on-chain but false for the system as a whole.

**Who loses what.**
- The second poster sees the opponent's `teamId`, which resolves to lobster classes, DNA, tier and damage through public chain reads.
- That player can dodge at a cost of gas only. Before F5-01 the same dodge cost the 5% anti-grief deposit.
- I found no off-chain attribution, throttle or penalty for withholding a salt in `apps/api`, `apps/engine` or `apps/indexer`.

**Severity.** No funds are stolen or locked. The victim gets a full refund and loses only gas, time and matchup expected value. The defect is adverse selection, reveal-window liveness, and skew in the rating ladder that feeds the mining boost. That is a broken F5-01 invariant with bounded impact, so Medium.

**What I did not establish.** The leaked salt has no direct on-chain use to a non-resolver. The finder's liveness-collapse scenario is game theory I did not verify. The adverse-selection dodge itself is verified.

*What limits it.* **No code guard stops the attack.**

**Practical limits:**
- The attacker must be the second poster. Two rational agents both wait, which produces timeouts rather than theft.
- The whole sequence must fit in the 20-second reveal window: poll, read the team, decide, POST the salt, then a watcher poll of up to 2 seconds plus transaction inclusion. An agent can do this. But a late decision to play risks the `revealTeams` transaction missing the deadline, which also ends in a costless cancel.
- The information gained is limited in some cases. Power (3-9) is already shown at match-found, and an opponent with only one eligible team at that power is already identifiable from public TeamManager state. The leak matters for players holding several eligible teams.
- No funds are lost or locked. The victim is fully refunded and loses gas, the deposit and commit transactions, a few minutes of locked stake, and matchup expected value.
- The rate limit (100 per minute on `/api/*`) does not prevent 1 Hz polling.
- The leaked salt cannot be used on-chain by a non-resolver because `revealTeams` is RESOLVER-only.

### D-09

**Staging next week's boost table overwrites each team's live entry, so every re-posted team mines with 0% boost until activation -- the role policy and surface note claim the opposite**

- Severity after verification: **Medium** (claimed Medium) · status **confirmed** · reported by: mp-math, mp-glide
- Location: contracts/MiningPool.sol:389 (unconditional overwrite of the single per-team slot with the staged epoch); :498-505 (_effectiveBoost requires b.epoch == currentBoostEpoch)

**What goes wrong.** Plain language: each team has ONE boost slot (mapping teamId -> TeamBoost, line 128). When the server stages next week's ladder, setTeamBoosts(current+1, ...) writes into that same slot with the new epoch number; from that moment until activateBoostEpoch lands, the entry no longer matches the live epoch and the team is paid no boost at all. Any continuing ladder team that starts a 4h expedition in that window loses its whole boost for that expedition (at +50% that is one third of the reward; the reward is locked at start). The docs say the opposite: admin-roles.md:118 says staged rows are 'invisible to startExpedition until activated' and the 2026-09-03 boost-surface note says 'Half-written table: impossible to observe ... A crash mid-batch leaves the live epoch intact'. The repo's own test pins the zeroing as expected ('staging overwrote the team's live entry'), so code, test and docs disagree -- an operator following the runbook has no reason to hurry while top teams are underpaid. The window is not seconds: the engine ticks every 60s, the activate job is enqueued only on a later tick once EVERY set job has succeeded, and with the documented 5s/30s/5min/1h backoff plus manual recovery of a dead job the gap is unbounded on an RPC outage or an out-of-gas BOOST_ADMIN wallet. During that time re-posted teams mine unboosted while teams in later batches keep their old boost -- exactly the half-written table the design says cannot be observed. The reverse also holds: a live-epoch amend setTeamBoosts(current, ...) posted after a team has been staged overwrites its staged row and the team silently lapses at activation. Second-order: window expeditions are credited to glide demand unboosted, slightly understating trailing demand. An unprivileged actor cannot trigger this and a compromised BOOST_ADMIN can already zero boosts, so blast radius does not grow; the money stays in the season budget (mis-payment to top teams, not theft). One finder rated Low, one Medium; Medium kept.

**Attack.** No attacker; normal weekly operation by the honest BOOST_ADMIN service. Precondition: team T is qualified in epoch N and re-qualifies for N+1 (exactly the most consistent battlers). (1) Service calls setTeamBoosts(N+1, batch_1..n), 200 rows per tx. (2) At least one 60s engine tick later -- or hours/days later if a set/activate job dies -- it calls activateBoostEpoch(N+1). (3) In between, T (or its bot on a 4h cycle) calls startExpedition; _effectiveBoost sees b.epoch == N+1 != currentBoostEpoch and returns 0; the reward is locked unboosted. Loss: up to 33% of that expedition's reward (for a +50% Apex team at launch rate, 15,625 of 46,875 CLAW), on every expedition (6/day) for every already-staged team until an operator intervenes. The weekly boundary coincides with a glide epoch boundary and with 4h cycles aligned to season start, so starts cluster there; agents watching TeamBoostSet events can dodge the window, naive agents and humans pay.

**Evidence.** contracts/MiningPool.sol:128 (single-slot mapping), :382-392 (setTeamBoosts; overwrite at :389 re-verified), :397-403 (activateBoostEpoch), :498-505, :274-277 (boost read once at start, reward locked); test/MiningPool.t.sol:1277-1287 (test_stagedNextEpochDoesNotAffectLiveUntilActivated asserts teamBoostBps == 0 after staging); docs/audits/2026-09-03-boost-surface.md:33; docs/runbooks/admin-roles.md:118; docs/runbooks/boost-epoch.md:38-44,65-66,133,165-187; apps/engine/src/boost/epoch-job.ts:434-487.

**Suggested fix.** Key the table by epoch -- mapping(uint32 epoch => mapping(uint256 teamId => TeamBoost)) -- or keep separate live and staged slots per team, and read _teamBoost[currentBoostEpoch][teamId] in _effectiveBoost; staging then never touches the live row and an amend never touches the staged row (the lapse rule still needs no clearing writes). Update the pinned test to assert the live boost is unchanged during staging. Interim: correct the two documents, have the engine submit set and activate back-to-back away from typical 4h claim/restart times, and treat a stalled stage-to-activate gap as a paging event.

**Skeptic (code path): CONFIRMED, Medium.** D-09 is confirmed. No require, modifier, phase check or arithmetic in the path stops it.

**What happens.** Each team has one boost slot. When the server stages next week's table, the team's live entry is overwritten and no longer counts as live. A team that re-qualifies is paid 0% boost on any expedition it starts between the staging transaction and the activation transaction.

**Code path I walked:**
- `_teamBoost` is a single `mapping(uint256 => TeamBoost)` keyed by teamId only, with no epoch dimension (MiningPool.sol:128).
- `setTeamBoosts` accepts `epoch == current` or `epoch == current + 1` (MiningPool.sol:384).
- It then unconditionally writes `_teamBoost[e.teamId] = TeamBoost({epoch: epoch, ...})` (MiningPool.sol:389). Nothing preserves or shadows the live row.
- `_effectiveBoost` returns 0 when `b.epoch != currentBoostEpoch` (MiningPool.sol:499-504). After staging N+1 while N is live, the row's epoch is N+1, so the boost is 0.
- `startExpedition` reads `_effectiveBoost` once and locks the reward into the `Expedition` struct at start (MiningPool.sol:274-277, :289-297). The loss is permanent for that 4h expedition.
- Only `activateBoostEpoch(N+1)` makes the staged row pay again (MiningPool.sol:397-403).

**The reverse case also holds.** An amend, `setTeamBoosts(current, ...)`, posted after a team has been staged resets its row to epoch N. The team then silently lapses when N+1 activates. The same line, :389, causes it.

**The repo's own test pins this behaviour.**
- `test/MiningPool.t.sol:1277-1287` asserts `teamBoostBps == 0` after staging, with the message "staging overwrote the team's live entry: it now belongs to epoch 2".
- The finding cites this file as `contracts/test/MiningPool.t.sol`. It actually lives at repo-root `test/MiningPool.t.sol`. The content matches exactly.

**The documents claim the opposite.**
- `docs/runbooks/admin-roles.md:118` says staged rows are "invisible to startExpedition until activated".
- `docs/audits/2026-09-03-boost-surface.md` (threat walk-through) says a half-written table is "impossible to observe" and that a crash mid-batch "leaves the live epoch intact".
- The NatSpec at MiningPool.sol:394-396 says "no team ever sees a half-written epoch".
- All three are false for re-posted teams. While batches land, teams in batch 1 are zeroed and teams in later batches still hold their old boost.

**How long the window lasts.**
- `activateEpoch` enqueues the activate job only on a tick where every set job is already `Succeeded`, and returns 'waiting' otherwise (`apps/engine/src/boost/epoch-job.ts:438-487`).
- Ticks run every 60s (`apps/engine/src/boost/service.ts:14`). The happy-path gap is therefore roughly one to two ticks plus transaction latency, not back-to-back.
- The failure path is unbounded. Backoff runs 5s, 30s, 5min, 1h, then Dead (`apps/engine/src/operator/types.ts:21`). A dead job marks the row failed and needs the manual SQL recovery in `boost-epoch.md:165-187`.
- The only overdue alarm keys off "newest activation older than 8 days" (`epoch-job.ts:49`). A stalled stage-to-activate gap is not flagged by that alarm for about a day, although a failed row does log `boost_epoch_blocked` every tick.

**The loss figure is correct.** A +50% Apex team at launch rate earns 1,250 × 1.5 × 25 = 46,875 boosted versus 31,250 unboosted. That is 15,625 CLAW lost per affected expedition, one third of the reward.

**Severity.**
- This is a broken documented invariant under honest operation, with no attacker. Real money is mispaid to the most consistent battlers every weekly cycle. Impact is bounded to at most 33% of the expeditions started inside the window.
- The unpaid CLAW stays in the season budget. Nothing is stolen or locked.
- In the happy path, expected loss per team is small: roughly a 1-2 minute window in a 4h cycle, unless bot restarts cluster at the weekly boundary. It becomes material only when a set or activate job stalls.
- A compromised BOOST_ADMIN can already zero boosts, so the key's blast radius does not grow.
- This matches the rubric's Medium: "accounting drift / broken invariant with bounded impact". It sits at the low end of Medium.

*What limits it.* - No on-chain guard blocks it. Both calls are `onlyRole(BOOST_ADMIN_ROLE)`, so an unprivileged actor cannot trigger or widen the window.
- The affected set is only teams posted in both epoch N and N+1. Newly qualifying teams had 0 anyway, and lapsing teams keep their old boost until activation.
- The loss is capped at the boost share of expeditions started inside the window: at most 33% of the reward, at most `MAX_BOOST_BPS` = 5,000.
- The unpaid CLAW is never minted, so it stays in the season budget. There is no theft, no lock, and no supply breach.
- The happy-path window is about 1-2 engine ticks (roughly 1-3 minutes) once a week. Agents watching `TeamBoostSet` and `BoostEpochActivated` can simply delay their start.
- A large loss requires an operational failure: RPC outage, unfunded BOOST_ADMIN wallet, or a dead job. A failed row logs `boost_epoch_blocked` every tick, but the dedicated overdue alarm only fires 8 days after the last activation.
- A compromised BOOST_ADMIN can already zero any boost, so the hot key's blast radius is unchanged.

### D-03

**Draws pay no protocol fee but still count as a battle 'played' for the mining boost, so two cooperating wallets can farm boost qualification (and park a top rating) for free**

- Severity after verification: **Low** (claimed Medium) · status **confirmed** · reported by: ba-funds, ba-state, ba-dispute, ba-trust
- Location: contracts/BattleArena.sol:907-920 (draw branch: full refund of stake + anti-grief to both, no treasury.processFee, early return); :926-941 (fee only on the decisive path)

**What goes wrong.** Plain language: a decisive battle costs the two players 10% of the pot (burn/dev). The new V3 draw path refunds both stakes and both anti-grief deposits in full and takes no fee. Before V3 that fee (500 CLAW per Low battle) was the only on-chain cost floor on staged battles. Two cooperating agents can produce a genuine engine draw at will, by two routes: (a) mutual passivity -- both only Defend/Move for 100 turns, HP% ties at 100/100 and damageDealt at 0/0, so the cap tiebreak falls through to 'draw' (the damage-dealt tiebreak only defends against ONE passive team); agents answer in <1s so this takes a minute or two; (b) mutual wipeout -- Ember's Inferno recoil (25% of damage dealt) is applied raw to the caster with no survival floor, so a cooperative final blow kills both (easy to set up given the predictable RNG, D-01). The honest resolver settles winner = address(0) and nobody disputes. The indexer records a draw as participation for BOTH teams and leaves ratings unchanged, so each draw counts toward the 7->14 battles-PLAYED weekly floor that unlocks the +10%..+50% mining boost, with zero fee and zero rating risk. A team that win-traded to a top percentile once can then hold that rating indefinitely by meeting the floor with draws against its alt (idle decay only hits teams that fail the floor). The boost is same-budget funded, so every farmed boost is paid by honest miners, and the burn the design relies on as the price of participation is bypassed. It also gives any two evenly matched rational agents a reason to draw rather than fight (fight = -250 CLAW EV each at Low; draw = 0), undermining the battle burn sink generally. Win-trading / repeat-pair flags are log-only telemetry; no repeat-opponent or same-owner guard was found in the matchmaker (grep only). The 2026-09-05 settle-delta note considered draws only as a colluding-RESOLVER / losing-player risk, never colluding PLAYERS or the cross-contract link to the boost.

**Attack.** Actor: one operator with two wallets, or two agents with a pact; no privileged key. Preconditions: each holds an Evolved+ team of the same Power and can fund a Low stake of 2,625 CLAW (fully refunded); they get paired (thin power x stake x rating-band pools at launch; both alts sit at the 1200 baseline so always in band; queue simultaneously off-peak; if matched with a stranger, simply do not deposit -- no penalty pre-deposit, cancel-rate throttling is telemetry-only). Sequence per battle: deposit -> commitTeam -> POST salts -> resolver revealTeams -> every turn both submit Defend (or steer into an Inferno mutual wipeout) -> engine returns 'draw' -> resolver settle(winner=address(0)) -> after the 5-min Low window anyone calls finalizeBattle; both receive 100% back, fee 0; indexer records +1 played for each team, no rating change. Repeat 7-14x/week per team, rotating partners to stay under the 3-meeting flag. Gain: >= +10% of that team's mining (>= ~15,750 CLAW/week on an Evolved team, >= ~131,000/week on Apex; more if the rating was first pumped by a few paid win-trades and then parked); only cost is gas plus winner-band repair (5-15 pts/lobster, ~150 CLAW/battle at Evolved, deferrable until 80). Who loses: the burn/dev fee stream (500 / 2,000 / 10,000 CLAW per staged battle; an honestly qualifying team generates ~3,500-7,000 CLAW of fees per week) and honest miners, whose baseReward is compressed by the boosted demand credit.

**Evidence.** contracts/BattleArena.sol:907-920 (draw: two full refunds, no processFee, BattleSettled(id,0,0,0)), :926-941 (fee only on non-draw path; processFee at :937 re-verified); packages/game-logic/src/v3/turn.ts:281-298 (mutual wipeout -> 'draw'; at MAX_TURNS equal hpPercent then equal damageDealt -> 'draw'); packages/game-logic/src/v3/specials.ts:143-148 (Inferno recoil applied raw to caster, can kill); packages/game-logic/src/v3/battle-damage.ts:16-22 (draw => both roll the winner damage band); apps/engine/src/operator/jobs/settle-battle.ts:62 ('draw' -> zeroAddress); apps/indexer/src/watchers/battle-watcher.ts:386-423 ('no rating change, participation recorded', recordParticipation for both) and :565-600 (participation recorded at BattleProposed regardless of outcome); packages/game-logic/src/rating.ts:16,45-47,64-68 (qualification = battles PLAYED, floor 7->14; BOOST_MIN_BPS=1000); docs/runbooks/boost-epoch.md:32-37; apps/engine/src/boost/epoch-job.ts:52,281,316-318 (flags are log.warn; 'nothing is withheld automatically in S1'); docs/audits/2026-09-05-v3-settle-delta.md:70-73 ('Draw as an evasion tool?' covers resolver collusion only).

**Suggested fix.** Charge the protocol fee on draws in _executePayout (each side pays half of the 10% pot fee via Treasury; or a reduced ~5% fee; or at minimum retain the anti-grief deposits on a zero-damage draw) so a draw is never cheaper than a decisive battle. Independently: do not count draws (at minimum 0-damage cap-outs) toward battle_participation; have the engine score mutual passivity at the cap as a double loss; make Inferno recoil non-lethal (floor caster at 1 HP) so mutual wipeout is not player-steerable; exclude repeated-pair and same-owner battles from `played` in computeEpoch instead of only logging a flag.

**Skeptic (code path): CONFIRMED, Low.** Plain language: every step of the described path executes in the current code. Nothing on-chain or off-chain stops two cooperating wallets from staging draws that cost no fee and still count as "played" for the mining boost. I rate it Low rather than Medium. The draw path does not create the farming opportunity. It only makes an already-profitable farm somewhat cheaper.

What I traced, all holding as claimed:
1. **Contract:** in `_executePayout`, `winner == address(0)` refunds `stake + antiGrief` to both players. It never calls `treasury.processFee`, emits `BattleSettled(id, 0, 0, 0)` and returns. The fee is charged only on the decisive branch. The only pairing guard on-chain is `playerA != playerB`.
2. **Engine, mutual passivity:** `checkWin` returns 'draw' at MAX_TURNS=100 when HP% is equal and `damageDealt` is equal. Defend is a legal action every turn and only timeouts trigger forfeit, so mutual Defend gives 100%/100% and 0/0, which is a draw.
3. **Engine, mutual wipeout:** `checkWin` also returns 'draw' when both teams are dead. Inferno recoil is applied with `raw: true` and has no survival floor.
4. **Settlement:** the settle job maps 'draw' to `zeroAddress`. `repairDamage` gives both teams the winner band.
5. **Indexer:** on a draw `BattleSettled` it leaves ratings untouched and calls `recordParticipation` for both teams. Participation is also recorded at `BattleProposed` with kind 'played'.
6. **Boost rules:** qualification is battles PLAYED with a floor of 7, rising to 14, and the minimum boost is 1000 bps.
7. **Flags:** win-trading and same-owner flags are `log.warn` telemetry only ("nothing is withheld automatically in S1").
8. **Matchmaker:** the only exclusion is `ne(address, self)`. There is no repeat-pair or same-owner guard, and alts at the 1200 baseline are always inside the rating band.

Why the severity is lower:
- **The same farm is already profitable with paid battles.** Two alts alternating decisive wins pay a 500 CLAW fee per Low battle (250 per team) plus loser-band repair of about 450 CLAW at Evolved. My arithmetic puts that at roughly 550 CLAW per team per battle, about 3,850 per week at the 7-battle floor, against a gain of at least 15,750 per week. Alternating wins also keeps both ratings near baseline.
- **So the fee was never an effective deterrent.** The draw path lowers the farm's cost from about 3,850 to about 1,050 CLAW per week. The harm attributable to draws is the bypassed fee (burn/dev) and the smaller repair sink. The boost dilution of honest miners happens either way.
- **The "park a top rating" claim is weaker than stated.** A pumped team can only draw against a partner within ±300 rating, so the operator must pump two or more teams into the same band, and the feeder teams lose rating in the process.
- **The "strangers will prefer to draw" claim does not hold.** Mutual passivity between strangers is an unstable prisoner's dilemma: one attack late in the battle wins the `damageDealt` tiebreak and the whole pot. It only works between pact partners or alts.

Overall: the defect is real and reachable by an unprivileged actor, and it is a cheap hardening fix. The underlying problem is that boost qualification can be farmed by alts. That is not specific to draws and should be tracked at its own severity.

*What limits it.* No code-level blocker on the draw path itself. The limits are practical and economic:
- The two wallets must actually be paired by the matchmaker: same stake bracket, power radius and rating band. There is no penalty for declining before deposit, so a stranger match is simply abandoned.
- A parked high rating needs a partner within ±300 rating, so the operator must pump two or more teams.
- Mutual passivity is unstable between strangers, because a late attack wins the `damageDealt` tiebreak and the pot. It works only for alts or pact partners.
- Each draw still inflicts winner-band repair damage of 5-15 points per lobster (about 150 CLAW per battle at Evolved), plus gas.
- The same farm through paid decisive battles costs only about 550 CLAW per team per battle, against a gain of at least 15,750 per week. The draw path's marginal harm is therefore the bypassed fee (about 250 CLAW per team per Low battle) and the reduced repair sink, not the boost extraction itself.
- Ops can spot this in the `flags` telemetry and hand-edit epoch rows, but nothing is withheld automatically.

### D-08

**A compromised MATCHMAKER key can do more than 'spam-create battles': deposit(battleId) binds no consent to stake, opponent or power, and the honest API surfaces a rogue High-stake battle to the victim labelled as bracket Low**

- Severity after verification: **Low** (claimed Medium) · status **contested** · reported by: ba-trust
- Location: contracts/BattleArena.sol:342-369 (deposit takes only battleId; amount derived from b.stakeAmount); :305-337 (createBattle: arbitrary players/stake/powers, no player-signed intent)

**What goes wrong.** Plain language: the role runbook says a stolen MATCHMAKER key can only spam battles because it 'cannot deposit on user's behalf'. True on-chain, but consent is a bare deposit(battleId): the player does not state the stake they agreed to, the opponent, or the maximum opponent Power. createBattle lets the key choose any pair, any of the three stakes and any (truthful) powers, so the attacker can pair a Power-3 victim who queued for Low against the attacker's own 3xApex team at the 50,000 stake. The honest off-chain stack then helps: the indexer's fallback path inserts any on-chain BattleCreated it has no matchmaker row for, hard-coding stakeBracket: 0 (Low); the queue-status endpoint returns it to the victim as recentBattle {bracket: 0}; the deposit endpoint builds approve+deposit calldata from the on-chain stake (52,500 CLAW); and the reference agent executes those steps blindly. With an honest RESOLVER the attacker still has to win, but +60% stats vs +20% makes that near-certain, and the result is a legitimately played loss, so the dispute backstop cannot correct it. This exceeds the documented blast radius ('Bounded by gas').

**Attack.** Actor: holder of a stolen MATCHMAKER hot key plus an attacker wallet owning a 3xApex team. Preconditions: victim agent is online, holds >= 52,500 CLAW, and follows the API's match/deposit flow (as scripts/e2e/lib/agent.ts does) without independently checking getBattle().stakeAmount/powerB. Sequence: createBattle(victim, attacker, 50_000e18, powerA=<victim's true power>, powerB=9) -> indexer inserts the row with stakeBracket 0 -> victim's queue-status GET returns recentBattle for that battleId -> victim POSTs /deposit and signs approve(52,500)+deposit -> attacker deposits, both commit, reveal passes (powers truthful), honest engine plays Power-3 vs Power-9, attacker wins -> settle/finalize pays attacker 90,000 + 2,500. Victim loses 50,000 CLAW plus 20-40 damage per lobster; dispute is useless because the log is genuine. Net to attacker ~+40,000 CLAW per victim; repeatable across every auto-depositing agent until the 3-of-5 Safe rotates the key.

**Evidence.** contracts/BattleArena.sol:305-337, :342-369 (re-verified signature deposit(uint256 battleId)); docs/runbooks/admin-roles.md ('MATCHMAKER: spam-create battles. Bounded by gas; cannot deposit on user's behalf.'); apps/indexer/src/watchers/battle-watcher.ts:150-185 (fallback insert for an out-of-band caller with stakeBracket: 0, status: 1); apps/api/src/routes/game/combat/queue.ts:334-385 (latest Deposit-phase battle returned as recentBattle with bracket: latest.stakeBracket); apps/api/src/routes/game/combat/battle-writes.ts:38-73 (deposit calldata from on-chain stakeAmount for any battleId); scripts/e2e/lib/agent.ts:107-110.

**Suggested fix.** Bind consent on-chain: deposit(battleId, expectedStake, maxOpponentPower) reverting on mismatch, or have createBattle verify an EIP-712 queue intent signed by each player (stake bracket, own power, max opponent power, expiry, nonce). Off-chain: never surface a fallback-inserted (no matchmaker row) battle as a match; derive stakeBracket from the event's stakeAmount instead of hard-coding 0; make the agent kit compare stake/power against what it queued for. Update admin-roles.md blast radius.

**Skeptic (code path): PLAUSIBLE, Low.** Plain language: the contract-level defect is real. The end-to-end theft as written does not run through the honest off-chain stack, and any loss still needs the victim to sign a 52,500 CLAW transfer themselves.

**What holds**
- `createBattle` lets the MATCHMAKER key pick any two addresses, any of the three stakes and any powers from 3 to 9. There is no player-signed intent.
- `deposit(battleId)` takes only the id and pulls `b.stakeAmount` plus 5%. A player cannot state the stake or the maximum opponent power they agreed to.
- The indexer fallback insert hard-codes `stakeBracket: 0` and sets `status: 1`.
- The queue-status endpoint returns that row as `recentBattle` with `bracket: 0`.
- The deposit endpoint builds approve and deposit calldata from the on-chain stake for any `battleId`.
- The reference agent's `executeSteps` signs whatever steps it is handed, with no amount check.
- The runbook's "spam-create battles. Bounded by gas" line is therefore too narrow.

**What breaks the claimed sequence**
1. **Queue gating.** Queue-status returns `inQueue: true` and never reaches the `recentBattle` branch while the wallet has a `matchmakingQueue` row. A victim "queued for Low" and polling `waitMatched` is not shown the rogue battle. It surfaces only for a wallet with no queue entry. For a just-matched wallet, that means a race: a newer rogue row must replace the legitimate match between 1-second polls.
2. **The reference agent cannot commit.** Fallback rows have NULL `queuedTeamA/B`, so `/my-team` returns `myTeamId: null`. `agent.ts` then calls `BigInt(mine.myTeamId)`, which throws. The watcher comment says the human frontend routes such rows to a repair-needed error instead.
3. **The realised outcome is a forfeit, not a lost battle.**
   - The victim deposits but does not commit, and the attacker commits.
   - After the 30-second commit window, `handleTimeout` calls `_forfeit`.
   - The victim gets the 50,000 stake back. Only the 2,500 anti-grief deposit goes to the Treasury (burn and dev split).
   - The attacker gains nothing and pays gas.
   - The claimed +40,000 per victim does not happen for the shipped agent or the web UI.
4. **The API is only partly misleading.**
   - `recentBattle` reports `opponentPower` truthfully from the event.
   - The deposit `preview` reports the real `stakeAmount` and `totalDeposit`.
   - Only the `bracket` label is wrong.
   - The design doc makes the deposit itself the consent step, with opponent power shown.
   - Power 3 against Power 9 is already a legitimate pairing after 120 seconds in the queue. The real excess is the stake escalation, which needs the victim's own signature on `approve(52,500)`.

The full path (commit, atomic reveal with power check, honest engine play, settle) is reachable only for a custom agent that:
- knows its own team id;
- computes the commit hash locally;
- uses the commit-team and reveal-team endpoints, which do not depend on `queuedTeam`;
- and blindly signs a 21x larger approve than it queued for.

That is a phishing-class attack on a careless third-party agent via a compromised hot key. It is not theft from a protocol-conforming player. The dispute backstop not helping is accurate but moot, because the victim consented on-chain.

**Net**
- The defect and the runbook understatement are real.
- Realistic impact is a 2,500 CLAW (5% of High) burn grief per tricked deposit.
- Stake loss applies only to agents that do not validate the stake.
- I did not read the matchmaker service's queue-removal ordering. The narrowness of the race in point 1 is inferred from the queue-status handler only.

*What limits it.* - The attacker needs a compromised MATCHMAKER hot key.
- The victim must sign `approve(52,500)` and `deposit` themselves, and must hold at least 52,500 CLAW. The deposit preview shows the true stake and the API shows the true opponent power.
- Queue-status hides `recentBattle` while the victim has a queue row. The rogue battle surfaces only to non-queued wallets, or by winning a roughly 1-second race against a legitimate match.
- Fallback rows have a NULL queued team, so the reference agent throws and the web UI shows repair-needed. The victim does not commit.
- A commit timeout forfeits only the 5% anti-grief deposit. That is 2,500 CLAW at the High stake, burned or sent to dev, not paid to the attacker. The stake is refunded.
- The indexer logs a loud warning on every fallback insert. The runbook prescribes immediate rotation of a compromised hot key via the multisig.
- A Power 3 against Power 9 pairing is already allowed by design after 120 seconds in the queue, so only the stake escalation is outside accepted behaviour.

### D-10

**Faucet lobster DNA is fully predictable and grindable by any eligible wallet; the documented EOA-only whitelist mitigation does not work**

- Severity after verification: **Low** (claimed Medium) · status **confirmed** · reported by: econ-peripherals
- Location: contracts/Faucet.sol:176-177 (seed = keccak(block.prevrandao, msg.sender, index, block.timestamp))

**What goes wrong.** Plain language: the five 'random' faucet lobsters are not random to the claimer. On Base (OP Stack) prevrandao is the L1-origin block's RANDAO: known minutes in advance and constant for ~6 L2 blocks; the timestamp advances a fixed 2s per block. A claimer can compute offline, for every upcoming block in the 7-day window (~300k candidate rolls), exactly which class, alleles and purity they would receive, and submit the claim only in a block that gives a good roll. Audit 2026-04-15 F-01 (Low) knew only the contract-with-reverting-receiver variant and its mitigation was 'whitelist EOAs only'. That fails twice: (1) a plain EOA can pick its block by offline prediction; (2) under EIP-7702 (live on Base) any whitelisted EOA can later delegate to code that recomputes the seed in-transaction and reverts cheaply (~30k gas) unless the roll is good; standard ERC-4337 smart wallets (the documented human users) get the same by batching a checker call. The claim flag and mints are in one tx, so a revert rolls back atomically. Impact is bounded but real: every rational agent grinds for five lobsters of the meta class with matching dominant/recessive alleles, skipping one or two breeding generations (tens of thousands of CLAW in breed fees), and defeating the design's 'random faucet class distribution ensures initial ecosystem diversity' mechanic and the gene-hunting market. Faucet lobsters are soulbound, but their offspring and evolved forms are tradeable. The NatSpec 'Not manipulable for soulbound NFTs' is incorrect.

**Attack.** Actor: any eligible faucet wallet; no privilege. (1) Read the L1-origin RANDAO that upcoming L2 blocks will expose as prevrandao. (2) For each future timestamp t compute seed_i = keccak(prevrandao, self, i, t) for i = 0..4 and decode class/alleles exactly as _generateRandomDNA does. (3) When a (prevrandao, t) pair gives the wanted pack (e.g. all five in one class with 2-3 purity matches), send claimLobsters() timed for that block. (4) Optional: route through 7702 delegate code that checks block.timestamp/prevrandao and reverts early on a miss, making every attempt risk-free. Loss: honest claimers and breeders lose relative value -- grinders start with Gen-0 stock others pay 1,000-17,000+ CLAW per pair in breed fees to approach; the anti-convergence diversity seeding is void.

**Evidence.** contracts/Faucet.sol:176-177 (seed inputs all known to the claimer; line 177 re-verified), :179-198 (class and alleles derive only from that seed), :114-119 (claim flag and mints in the same tx), :175 (NatSpec); docs/audits/2026-04-15-adversarial-campaign.md:755-761 (F-01 considered only the reverting-receiver variant, mitigation 'admin should only whitelist EOAs', declined a runtime fix).

**Suggested fix.** Reuse BreedingLab's two-step pattern: claimLobsters records msg.sender and targetBlock = block.number + 2 and sets the claimed flag; a permissionless finalizeClaim mints using blockhash(targetBlock) (wider lookback via the EIP-2935 history contract avoids the 256-block expiry). Alternatively have the eligibility signer supply a per-wallet server-committed seed.

**Skeptic (code path): CONFIRMED, Low.** Plain language: the claim is true, but I rate it Low rather than Medium. Any eligible wallet can know its five faucet lobsters before it commits to them, because the contract lets it retry until it likes the roll. No funds are stolen or locked, and the core issue was already accepted as Low in April (F-01). The new part is that the "only whitelist EOAs" mitigation does not work and was never written into the runbook.

I walked the full path:

1. **No guard stops it.** `claimLobsters` checks only closeTime, `isEligible`, the ETH balance and the claimed flag (Faucet.sol:109-112). There is no `tx.origin` or code-length check, and no commit/finalize delay.

2. **The roll is fully known to the claimer.** Each lobster's seed is `keccak(block.prevrandao, msg.sender, index, block.timestamp)` (Faucet.sol:177). Class, breed type and all 18 alleles derive only from that seed (Faucet.sol:179-198). Nothing else enters: no nonce, no `totalLobstersClaimed`, no blockhash, no signer seed.

3. **A bad roll can be undone.** The claimed flag is set at :114 and the mints happen at :116-119 in the same transaction, so a revert rolls everything back. A contract or delegated account can recompute the seed before calling and revert on a miss. It can also veto the roll inside `onERC1155Received`, which `LobsterNFT.mint` triggers through `_mint` (LobsterNFT.sol:113). `nonReentrant` does not stop a plain revert.

4. **The documented mitigation fails.** The April audit's fix was "admin should only whitelist EOAs" plus a runbook check. That audit itself says smart wallets (Bankr, ERC-4337) are legitimate users who must not be blocked. The promised runbook line does not exist: admin-roles.md:149-159 covers only wallet age, transaction count and ETH balance. A whitelisted EOA can also gain code later through EIP-7702 delegation, which is a property of the chain and not something I could check in this repo.

5. **The NatSpec is wrong.** Faucet.sol:175 says "Not manipulable for soulbound NFTs".

Where the finder overstates:

- "Compute offline for every block in the 7-day window" is wrong. On the OP Stack, prevrandao is the L1-origin block's RANDAO, known about a minute ahead, not days. The grind works by continuous monitoring or a reverting wrapper, with roughly 300k candidate rolls over 7 days, so the end result is the same.
- Pure EOA timing, without a reverting wrapper, is not atomic. A missed block gives an ordinary random roll.
- "All five in one class with 2-3 purity matches" is far less likely than implied. Five of one specific class is about 1 in 100,000, which is about 3 chances in the window. Purity of 3 or more on a single lobster is about 1.6%. Realistic grinding gets chosen classes plus modestly better alleles and variants.
- The monetary impact is tiny. At the design launch price, a full 17,000 CLAW breeding ladder is worth about $1.70.
- If every rational agent grinds, nobody gains a relative edge. What is lost is the design's random class seeding.

Why Low: the area is a 7-day onboarding faucet handing out non-transferable Base-tier lobsters, and the gain is a modest breeding head start. The defect is real and cheap to fix, but the impact is bounded and mostly about fairness and design intent.

*What limits it.* No on-chain guard blocks the grind. What limits it:

- The wallet must first be whitelisted by ELIGIBILITY_ROLE, and eligibility is one claim per wallet.
- The atomic, risk-free grind needs an account with code: a contract wallet, an ERC-4337 account or a 7702-delegated EOA. A plain EOA can only time its block and may miss.
- prevrandao is known only about a minute ahead on the OP Stack, so the claimer must monitor continuously rather than precompute the week.
- The candidate space is about 300k rolls, one per 2-second block over 7 days. The extreme outcomes the finder cites are rare, so the realistic gain is chosen classes plus slightly better alleles.
- Faucet lobsters are soulbound, Base tier, Gen 0 and never legend. Value leaks only through breeding offspring, and the CLAW amounts are tiny at launch price.
- The issue was already known and accepted as Low in April (F-01). Only the failure of the mitigation and the wrong NatSpec are new.

### D-11

**A mistyped or wrong-chain GOVERNANCE_SAFE permanently bricks admin on all 7 AccessControl contracts: Handoff grants and revokes in one run with no proof the Safe exists or is controlled**

- Severity after verification: **Low** (claimed Medium) · status **confirmed** · reported by: roles
- Location: contracts/script/Handoff.s.sol:47-50 (grant-then-revoke loop), :86-89 (the only validation: non-zero and != deployer)

**What goes wrong.** Plain language: Handoff.s.sol moves DEFAULT_ADMIN (and SEASON_ADMIN) on seven contracts to the GOVERNANCE_SAFE env address and removes the deployer in the same script run. It never checks the address has code on this chain and never requires the Safe to prove it can sign. The script and runbook point out that Treasury is protected against a mistyped Safe because its transfer is two-step; the seven AccessControl contracts control far more and get no such protection. If the address is wrong (typo, a Safe address copied from Ethereum/Base Sepolia that does not exist on Base mainnet -- the Wintermute/Optimism class -- or an EOA from the wrong row) nothing can recover it: contracts are non-upgradeable, no _setRoleAdmin exists, DEFAULT_ADMIN is the only admin of every role. Permanent consequences: BattleArena.adminResolveDispute can never be called, so the stakes and bond of every disputed battle are locked forever (any loser can trigger this by paying a bond); MiningPool.startSeason/setBaseReward can never be called, so mining ends for good after Season 1; no hot key (RESOLVER, MATCHMAKER, BOOST_ADMIN, ELIGIBILITY) can ever be rotated; Faucet.burnUnclaimed can never run; a stuck expedition can never be released. The script's own post-check passes in this failure case -- it checks only that the deployer lost its roles, not that a live governance account gained them. admin-roles.md also contradicts the script: its bottom section says the deployer revoke should be 'called from the multisig, post-grant' (which would prove control), whereas Handoff does the revoke from the deployer in the same broadcast.

**Attack.** Actor: the deploy operator, by honest mistake; no attacker. Sequence: run Handoff.s.sol with GOVERNANCE_SAFE set to an address with no Safe on chain 8453. The script grants DEFAULT_ADMIN and SEASON_ADMIN to it, revokes the deployer on all 7 contracts, prints 'Governance handoff complete', and its assertion passes. Who loses: every player ever party to a disputed battle loses stake and bond (the Disputed escrow only exits through adminResolveDispute); all miners lose emissions from Season 2 onward; the protocol permanently loses key rotation and incident response.

**Evidence.** contracts/script/Handoff.s.sol:86-89 (no governanceSafe.code.length check, no check against hot keys), :39-40 and :47-50 (single-step grant then revoke from the deployer), :52-55 (comment: 2-step protects Treasury only); grep _setRoleAdmin across contracts/*.sol returns nothing; contracts/BattleArena.sol:566 (adminResolveDispute onlyRole(DEFAULT_ADMIN_ROLE)); contracts/MiningPool.sol:198 (startSeason onlyRole(SEASON_ADMIN_ROLE)); docs/runbooks/admin-roles.md:52 vs :180-184.

**Suggested fix.** Split Handoff into two phases: Phase 1 (deployer) grants roles to the Safe and calls transferOwnership; Phase 2 is a Safe transaction batch in which the Safe itself revokes the deployer on all 7 contracts and calls acceptOwnership, proving control. Minimum: require(governanceSafe.code.length > 0) on chainid 8453, ideally with a staticcall to getThreshold()/getOwners() confirming a Safe with threshold >= 3; require governanceSafe and eligibilityOperator distinct from each other and from matchmaker/resolver/VRF operator/boost admin; add a fork test running Deploy, Configure and Handoff from the real scripts.

**Skeptic (code path): CONFIRMED, Low.** Plain language: the defect is real and I could not find anything in the code that stops it. If the operator runs the handoff with the wrong Safe address, the script hands all admin power to that address, removes the deployer, reports success, and nothing can undo it. I rate it Low rather than Medium. It needs an operator mistake at a one-time ceremony, no outside party can cause or exploit it, and the runbook schedules the handoff before launch, when a redeploy is still a recovery path.

Code path:
1. **Validation.** `Handoff.run()` checks only that `governanceSafe` and `eligibilityOperator` are non-zero and differ from the deployer (Handoff.s.sol:86-89).
   - `governanceSafe` comes from `vm.envOr("GOVERNANCE_SAFE", address(0))` with no further checks (DeployHelpers.s.sol:66).
   - There is no `code.length` check, no chainid-conditional check, no Safe `getThreshold`/`getOwners` probe, and no distinctness check against the hot keys.
2. **Grant and revoke.** `GovernanceHandoff.execute` runs in one deployer broadcast.
   - It grants SEASON_ADMIN to the safe and revokes it from the deployer (:39-40).
   - For each of 7 contracts it grants DEFAULT_ADMIN to the safe and immediately revokes the deployer (:47-50).
   - Only Treasury gets a two-step transfer (:55); the comments at :19-21 and :52-54 confirm that protection is scoped to Treasury.
3. **Post-check.** The assertion at :103-110 verifies that the deployer holds no roles and that `Treasury.pendingOwner() == safe`. Both pass for a codeless or uncontrolled address. Nothing checks that a live, controlled account holds the roles.
4. **No recovery.**
   - All 7 contracts inherit plain OZ `AccessControl`, not `AccessControlDefaultAdminRules`.
   - A grep for `_setRoleAdmin` across contracts/*.sol returns nothing, so DEFAULT_ADMIN is the admin of every role.
   - The contracts are non-upgradeable; admin-roles.md says there is "no on-chain emergency exit".
5. **Consequences verified.**
   - A disputed battle can only exit through `adminResolveDispute`, which is `onlyRole(DEFAULT_ADMIN_ROLE)` (BattleArena.sol:566).
   - `finalizeBattle` reverts with `BattleIsDisputed` (:546) and `handleTimeout` reverts with `DisputedBattleRequiresAdmin` (:735).
   - `emergencyWithdraw` works only in the Active phase, so stakes plus bond in a disputed battle stay locked for good.
   - `startSeason` and `setBaseReward` need SEASON_ADMIN (MiningPool.sol:198, 227).
   - `adminReleaseExpedition` (:347) and `Faucet.burnUnclaimed` (Faucet.sol:159) need DEFAULT_ADMIN.
   - Hot-key rotation needs DEFAULT_ADMIN on every contract.
6. **Test coverage.** `GovernanceHandoff.t.sol` uses `makeAddr("governanceSafe")`, a codeless EOA, as the safe (:15). The suite therefore passes with a non-contract admin, and no negative test exists.
7. **Doc contradiction.**
   - admin-roles.md:44-52 prescribes the single-run Handoff script.
   - The "Configure.s.sol" section (~:180-184) says the deployer revoke is "called from the multisig, post-grant". That flow would prove Safe control, but the script does not implement it.
   - The post-launch checklist only asserts `hasRole(..., deployer) == false`. It never asserts that the Safe holds the role or can sign.

Severity: I traced the mechanism end to end, and the impact is irreversible if it happens after launch. It still fits the rubric's "Low = hardening with a concrete failure story" better than Medium: there is no adversary, the only precondition is an operator error, and it is a one-time pre-launch step.

*What limits it.* - **Operator error required.** This needs a wrong GOVERNANCE_SAFE value at a one-time ceremony. No unprivileged actor or hot key can trigger it.
- **Simulation is no help.** The forge script dry-run passes identically with a bad address, so it gives no protection.
- **Natural tripwire.** A wrong Safe cannot call `Treasury.acceptOwnership()`. Following the runbook checklist would therefore expose the mistake, but only after the AccessControl roles are already gone.
- **Pre-launch timing.** admin-roles.md schedules the handoff "before mainnet launch". If the mistake is caught then, a full redeploy recovers it with no user funds at risk. The cost is operational: a new token and new addresses.
- **Timing is not enforced.** Nothing on-chain or in the script requires the handoff to run before launch. After launch the consequences are permanent, and a redeploy cannot rescue already-escrowed disputed stakes.
- **`code.length` alone is not enough.** An address with code, or a Safe with the wrong owners or a threshold of 1, would still pass that check.

### D-12

**Settlement hashes cover only data the server wrote, so a fabricated log verifies cleanly and the multisig cannot tell a real forfeit or timeout from an invented one**

- Severity after verification: **Low** (claimed Medium) · status **confirmed** · reported by: binding
- Location: packages/game-logic/src/v3/replay.ts:33-36,54-57,84-92; contracts/BattleArena.sol:474-499 (settle checks only role, phase, winner in {A,B,0}, non-zero hashes)

**What goes wrong.** Plain language: the two on-chain hashes prove only that the server's log is internally consistent, not that the players made those moves. Nothing a player sends is signed per command: auth is a generic 'Clawbada Auth: <timestamp>' signature reusable for 5 minutes and not bound to a battle, turn or action, and the server returns no signed receipt. Three details make a lie unfalsifiable: (1) a shot-clock timeout is logged as an ordinary `defend` entry -- the 'timeout' label lives only in the server's battle_turns.submitted_by column, outside the hash; (2) a `forfeit` log entry is accepted by replayBattle/verifyLog at any point with no precondition (it cannot check for three timeouts, because they look like Defends) -- the one-entry log [{action:'forfeit', loser:'A'}] replays ok:true; (3) all evidence named in the runbook (battle_turns, battle_sessions, vrf_round) sits in the DB of the accused party, and the player cannot rebuild turnLogHash independently because the API never returns the seed or round. In a dispute where the player says 'I sent moves, the server recorded timeouts / a forfeit / different moves', the admin's verifyLog passes and it is word against word. The contract NatSpec claim that non-zero hashes mean 'a dispute always has something to check against' holds for arithmetic errors only. Preimage coverage: bound directly -- battleId, vrfSeed, layout, roster (token id, class, tier, purity, legend), ordered log with per-turn state hashes; bound only indirectly -- rules, team side/slot; NOT bound -- chain id, arena address, player addresses, team ids, engine/rules version, who submitted each turn. The contract verifies no signature.

**Attack.** Actor: a dishonest or compromised battle server (API process + DB + settle queue). (The RESOLVER key alone leaves the honest DB intact -- see D-06.) (1) Battle N goes Active between victim V and the operator's own wallet C. (2) The server writes a log in which V's lobsters Defend/do nothing every turn, or simply appends a `forfeit` entry with loser = V's side, and computes hashState/turnLogHash over it (self-consistent by construction). (3) It enqueues settle(N, C, hashes, damage). (4) V disputes and posts a bond of 250 / 1,000 / 5,000 CLAW. (5) The admin runs v3.verifyLog(cfg, log) per the battle-session runbook: ok, and the hash equals the on-chain value. With no contrary verifiable evidence the admin upholds the proposal: V loses the stake and the bond is slashed to Treasury.

**Evidence.** packages/game-logic/src/v3/replay.ts:33-36,54-57 (forfeit applied with no precondition), :71-74 (roster omits side, slot, owner), :84-92 (preimage fields); packages/game-logic/src/v3/session.ts:54 (forfeit entry is {loser} only), :85 (timeout applied as plain 'defend'); apps/api/src/lib/battle-session/store.ts:70 (submittedBy persisted in DB only); apps/api/src/middleware/auth.ts:67 (generic message, 5-minute window); apps/api/src/routes/game/combat/session.ts:157-194 (turn and forfeit routes take unsigned bodies); packages/game-logic/src/v3/serialize.ts:151-153 (seed never given to players; vrf_round not exposed in any route); contracts/BattleArena.sol:474-499; docs/runbooks/battle-session.md:47-48.

**Suggested fix.** Require an EIP-712 signature from the acting player on every turn command and on resign, over {chainId, arena address, battleId, turn, prevStateHash, command}; store signatures in battle_turns and include them (or their hash) in the log entries covered by turnLogHash. Log a timeout as its own action type. Make replay reject a forfeit entry unless it is a signed resign or follows three explicit timeout entries by that side. Have the server sign and return a receipt per accepted command. After the battle, expose the round, seed and full log to both participants so they can recompute turnLogHash.

**Skeptic (code path): CONFIRMED, Low.** **What it means.** The finding is accurate in every detail. The two settlement hashes commit the server to its own log and to nothing a player said or did. If the battle server (API process + DB + settle queue) is dishonest or compromised, it can write a log in which the victim timed out or forfeited and compute matching hashes. It then settles through the RESOLVER key. The runbook's only dispute tool, `verifyLog` plus the `turnLogHash` equality check, passes on that log. The player has no signed command, no server receipt, and no seed or round to recompute anything.

**What I traced.**
- `settle()` checks only the role, the Active phase, the deadline, that the winner is A, B or zero, and that both hashes are non-zero.
- `replayBattle` and `verifyLog` apply a `forfeit` entry with no precondition other than that `loser` is set.
- `forfeit()` only requires that the battle is not finished. It pushes an entry whose `postStateHash` is `hashState(state)`, so the one-entry log `[{action:'forfeit', loser:'A'}]` verifies `ok:true`.
- A shot-clock timeout calls `applyTurn` with a plain `defend`. `TurnLogEntry` has no field for who submitted the turn; `submittedBy` is written only to the `battle_turns` DB row, outside the hash.
- The turn and forfeit routes take unsigned JSON bodies behind a generic "Clawbada Auth: <timestamp>" signature or a session token. Nothing binds a request to a battle, turn or command.
- `clientView` strips the VRF seed. `vrfRound` is only written to the DB and the server log; I found no route that returns it.
- `GET /turns` returns the server's own DB rows, so it is not independent evidence.
- The `turnLogHash` preimage is {battleId, vrfSeed, layout, roster (id, class, tier, purity, legend), log}. It contains no chain id, arena address, player address, team id or engine version.
- The NatSpec claim that non-zero hashes mean "a dispute always has something to check against" therefore holds only for an arithmetically inconsistent log, which a lying server would never produce.

**Why I lowered severity from Medium to Low.**
- The actor is the whole battle server, the trusted party in the documented S1 model. It is not an unprivileged actor and not the RESOLVER key alone: with an honest DB, the resolver's hashes would not match the persisted log.
- The docs already accept this shape. `2026-09-05-v3-settle-delta.md` says "Hash semantics are off-chain… the turn log persisted by the session manager is the evidence." `admin-roles.md` says the resolver may propose any winner with admin tiebreak.
- No contract invariant breaks and no on-chain path misbehaves.
- The last step of the attack, "the admin upholds the proposal", is a human judgement and not code. A multisig would likely notice a pattern of victims disputing forfeits against one counterparty and could use infrastructure logs.
- Loss is bounded per battle to the stake plus anti-grief deposit plus bond, 55,000 CLAW at most in the High bracket plus the 5% deposit.

**What still stands.** For the dispute class players care about most, "I moved and the server says I didn't", the S1 backstop has nothing verifiable. The converse also holds: an honest server cannot prove a lying player wrong, though the bond mitigates that. This is a real and cheaply fixable evidence gap.

*What limits it.* - The attack needs the whole battle server compromised or dishonest: the API process, the DB and the settle queue. It is not reachable by a player and not by the RESOLVER key alone. With the RESOLVER key alone the honest DB log stays intact and its hash would not match the on-chain value.
- The S1 docs explicitly accept a server-authoritative model and off-chain hash semantics.
- The admin decision is made by people. They can use out-of-band evidence such as infrastructure and WebSocket logs, a pattern of disputes against one counterparty, or player-side request captures (weak, because those are unsigned).
- Loss per battle is bounded to the stake plus the 5% anti-grief deposit plus the dispute bond (250 / 1,000 / 5,000 CLAW).
- The dispute rate limit and the bond deter the converse abuse, where a lying player claims fabrication.
- No on-chain invariant is violated and no funds are locked.

### D-13

**The last depositor chooses when the 30-second commit clock starts and can make an honest opponent lose the 5% anti-grief deposit at no cost to themselves**

- Severity after verification: **Low** (claimed Low) · status **confirmed** · reported by: ba-funds, ba-state, ba-trust
- Location: contracts/BattleArena.sol:365-368 (commit deadline set by the second deposit); :1039-1052 (_handleCommitTimeout); :1013-1037 (_forfeit); :81 (TEAM_COMMIT_WINDOW = 30 seconds)

**What goes wrong.** Plain language: the commit phase opens the instant the second deposit lands and lasts 30 seconds. Whoever deposits second picks that instant anywhere in the 2-minute deposit window and can commit their own team in the same block (a smart wallet can batch deposit+commitTeam). If the first depositor does not get commitTeam mined within 30 seconds, handleTimeout forfeits them: their anti-grief goes to Treasury, the attacker gets stake and anti-grief back in full. This is the only remaining path in V3 that slashes a player (see D-14, D-15), and it can land on an honest player because of a timing the adversary controls. It is distinct from known item (1): the 20-second reveal timeout is a costless mutual cancel; the commit timeout costs the victim real funds. commitTeam is player-submitted (the API only builds calldata), so a human on a passkey/smart wallet, or an agent behind a slow RPC/poll, has to notice the phase change, sign and land a tx within 30 seconds of a moment the opponent chose.

**Attack.** Actor: any matched player; pays gas only. (1) Victim calls deposit() early in the window. (2) Attacker waits until a moment of their choosing (e.g. t=115s, or when the victim's UI/agent looks idle). (3) Attacker sends deposit() + commitTeam() back to back. (4) 31 seconds later the attacker (or anyone) calls handleTimeout(). (5) If the victim's commit has not been mined, _forfeit(victim) runs. Loss: victim loses 5% of stake -- 125 / 500 / 2,500 CLAW -- burned/paid to dev; attacker refunded 100%. The grief pays indirectly (burning a competitor's CLAW, harassing a ladder rival) and is repeatable against human players, who are the slow side.

**Evidence.** contracts/BattleArena.sol:81 (re-verified; one finder cited :75), :365-368, :372-376 (commitTeam reverts after the deadline), :1039-1052 (one-sided non-commit -> _forfeit; callers at :1048/:1050 re-verified as the only ones), :1013-1029 (forfeiter's antiGrief -> treasury.processFee at :1023; other side made whole); apps/api/src/routes/game/combat/battle-writes.ts:78-95 (commit is a player-signed tx).

**Suggested fix.** Let each player commit their team hash inside deposit() (deposit(battleId, commitHash)) or allow commitTeam during the Deposit phase, so the opponent-controlled clock disappears; or widen TEAM_COMMIT_WINDOW together with TEAM_REVEAL_WINDOW (e.g. 2-5 minutes; agents still commit instantly) / start it from a fixed offset; or make a one-sided commit timeout a costless mutual cancel as the reveal timeout already is, since nothing has been revealed at that point either.

**Skeptic (code path): CONFIRMED, Low.** The finding holds: the code path runs exactly as described and no guard stops it.

**What happens in plain terms.** The 30-second commit clock starts when the second deposit lands. The second depositor picks that moment anywhere in the 2-minute deposit window, and can deposit and commit back to back in the same block. If the honest first depositor does not get their own commit mined within 30 seconds, anyone can call the timeout and the honest player loses their 5% anti-grief deposit. The attacker is refunded in full and pays only gas.

**Step by step through the code.**
1. `deposit()` moves the battle to TeamCommit and sets `phaseDeadline = block.timestamp + TEAM_COMMIT_WINDOW` (30 seconds) only when the second deposit lands. It is accepted at any time up to the 2-minute DEPOSIT_WINDOW deadline.
2. `commitTeam()` checks only the phase, that the caller is a participant, and the deadline. It has no check on how early or late the commit arrives, so the attacker's immediate commit is valid. After the deadline it reverts `PhaseTimedOut`, so a late victim cannot recover.
3. `handleTimeout()` is permissionless once `block.timestamp > phaseDeadline`. In the TeamCommit phase it calls `_handleCommitTimeout`, and a one-sided non-commit leads to `_forfeit(non-committer)`.
4. `_forfeit` sends the forfeiter's anti-grief deposit to `treasury.processFee` and returns only their stake. The other side gets stake plus anti-grief back in full.

**Why it costs the victim, unlike the reveal timeout.** The reveal timeout is documented in-code as a costless mutual cancel precisely so that honest fumbles are not penalised. The commit timeout has no such protection. The API only builds calldata for `commitTeam`, so the player must sign and land the transaction themselves. `commitTeam` cannot be called during the Deposit phase, so the victim cannot commit ahead of time.

**Severity: Low.** The loss is bounded at 5% of stake (125 / 500 / 2,500 CLAW). The attacker gains nothing directly. It is a grief that needs a slow victim; an agent that watches the phase change commits in one block.

*What limits it.* No on-chain guard stops this. The practical limits are:
- The victim must fail to land `commitTeam` within 30 seconds. With roughly 2-second Base blocks (200ms flashblocks), an agent watching the `StakeDeposited` event or the phase change commits easily. Humans on passkey wallets and agents on slow polling are the realistic victims.
- The victim's loss is capped at 5% of stake, and the stake itself is returned.
- The attacker earns nothing; the slashed amount goes to Treasury for the burn/dev split. It is pure grief, paid for with gas and the attacker's own matchmaking slot.
- The attacker must actually hold and deposit stake plus anti-grief, but gets all of it back.

### D-14

**A junk team commit (or invalidating the team after commit) converts the slashable commit-timeout into the costless reveal-timeout: deliberate pre-battle stalling is free and the 5% anti-grief slash can always be avoided**

- Severity after verification: **Low** (claimed Low) · status **confirmed** · reported by: ba-state, ba-trust, ba-reveal, tests-gap
- Location: contracts/BattleArena.sol:372-396 (commitTeam accepts any non-zero bytes32, no validation); :423-437 (any mismatch/invalid team reverts the atomic reveal); :1061-1063 (reveal timeout = _cancelBattle, nothing slashed)

**What goes wrong.** Plain language: a player who deposits and then declines to commit is slashed 5%; a player who deposits and commits random bytes pays nothing. The resolver can never open a garbage hash, so the reveal window expires and the battle cancels with full refunds for both sides. Equivalent free exits after an honest commit: withhold the salt, TeamManager.disbandTeam the committed team (allowed -- it is not active until reveal), start a mining expedition with it (allowed for the same reason, and it earns a mining reward while the opponent waits), or commit a team that is ineligible at reveal (wrong Power, damage >= 80) -- each makes revealTeams revert (InvalidCommitHash / TeamNotOwned / TeamAlreadyInBattle / TeamPowerChanged). So after V3 there is no reachable state in which a RATIONAL actor's anti-grief deposit is slashed; the only party that ever pays is an honest slow one (D-13). The F5-01 write-up accepted a costless reveal timeout on the basis that no information leaks; it did not note that this also nullifies the commit-phase penalty. test_F5_01_revealTimeout_isCostlessMutualCancel pins the honest dropped-connection case; no test covers the adversarial variant. No information leaks (commit hashes are opaque), so this is not the matchup dodge returning -- it is pure griefing, contradicting 'griefing is always negative EV' (EV = 0 minus gas), with a concrete motive under the boost ladder: qualification is battles PLAYED per week, so wasting a rival's matches can push them below the floor and raise the griefer's own percentile. Bounded: no funds are lost. A team cannot be in two battles (teamInBattle + team.active checked at :867-870 before any write, both set atomically at :445-448); a second battle committing the same team just hits the same free cancel.

**Attack.** Actor: any player, typically a multi-wallet griefer or a player who dislikes the opponent shown at match-found but has already deposited. Sequence: deposit(battleId) -> commitTeam(battleId, keccak('junk')) within 30s -> honest opponent commits -> phase TeamReveal -> revealTeams reverts InvalidCommitHash for any (teamId, salt) the resolver could supply -> after 20s anyone calls handleTimeout -> _handleRevealTimeout -> _cancelBattle(MutualTimeout): both refunded 100% incl. anti-grief. Variant after an honest commit and salt hand-over: disbandTeam(teamId) or MiningPool.startExpedition(teamId, tier) before the watcher's tx lands -> same cancel. Victim loses gas on approve/deposit/commit, ~2m50s-3 min of locked stake + 5%, and a matchmaking slot per cycle; attacker pays only gas versus the 5% the design intends. Repeatable without limit on-chain from fresh or the same wallets; cancel-rate throttling is documented as telemetry-only at launch.

**Evidence.** contracts/BattleArena.sol:372-393 (only check on the hash is != 0 via AlreadyCommitted logic), :423-426 (InvalidCommitHash), :433-437, :860-888 (validation), :1039-1052 + :1013-1037 (_forfeit only when exactly one side has a zero commit; callers only :1048/:1050; AntiGriefSlashed only at :1024), :1061-1063, :991-1011 (full refund incl. anti-grief); contracts/TeamManager.sol:104-108 (disband allowed unless active; not active until BattleArena.sol:447-448); contracts/MiningPool.sol:253,302 (startExpedition allowed on a committed-but-unrevealed team); contracts/test/fuzz/FuzzBattleArena.t.sol:408-445; .claude/CLAUDE.md Anti-Griefing section.

**Suggested fix.** Decide whether the anti-grief deposit is meant to do anything pre-Active. If yes: give the resolver an attributable failure path -- a RESOLVER-only reportRevealFailure/failReveal(battleId, culprit) usable only when the culprit's supplied (teamId,salt) does not hash to its commit or its team fails _validateTeamForBattle (bounded blast radius: 5% of one stake, TeamReveal only), routing to _forfeit(culprit), with a short grace period in which the accused may self-reveal a valid opening of its own commit (leaks nothing about the opponent); allowing commit with the deposit also helps. If no: drop the commit-timeout slash and the deposit for simplicity. Either way ship matchmaker cancel-rate throttling at launch rather than telemetry-only, and add a test documenting the garbage-commit path.

**Skeptic (code path): CONFIRMED, Low.** Plain language: the claim holds. A player who deposits and then commits garbage bytes gets a full refund, including the 5% anti-grief deposit. A player who deposits and simply fails to commit is slashed 5%. So the only pre-battle slash can always be avoided by a rational griefer at gas cost.

Code path, step by step:
- **`commitTeam`** checks only the phase, that the caller is a participant, the deadline, and that the caller's slot is still zero. The hash itself is never validated. Any non-zero bytes32 is stored, and once both slots are non-zero the phase moves to `TeamReveal`.
- **`revealTeams`** is `RESOLVER_ROLE`-only and atomic. It requires `keccak256(battleId, player, teamId, salt)` to equal each stored commit, so no resolver input can open a junk hash and it reverts `InvalidCommitHash`. No alternative resolver path exists that attributes fault to one player.
- **`handleTimeout`** in `TeamReveal`, 20 seconds after the second commit, calls `_handleRevealTimeout`, which is unconditionally `_cancelBattle(MutualTimeout)`. `_cancelBattle` refunds stake plus anti-grief to both depositors.
- **`_forfeit`** is the only place `AntiGriefSlashed` is emitted. It is reached only from `_handleCommitTimeout`, and only when exactly one commit slot is zero. A junk commit makes that slot non-zero, so the slash is unreachable.

The post-commit variants also work:
- **Invalidating the committed team:** `createBattle` binds only `powerA` and `powerB`, not team ids, and `team.active` is set only inside `revealTeams`. Between commit and reveal, `TeamManager.disbandTeam` succeeds, which gives `TeamNotOwned` at reveal.
- **Starting an expedition:** `MiningPool.startExpedition` also succeeds, which gives `TeamAlreadyInBattle` at reveal. The reveal transaction reverts and the same costless cancel follows.

I tried to find a guard that refutes this and found none:
- The phase and deadline checks do not distinguish a junk commit from an honest one.
- No reputation or penalty state is written on cancel.
- No test covers the adversarial path; a grep for "junk" and "garbage" in `test/` returns nothing.

Impact is bounded: no funds are lost or locked, and no team information leaks, so this is not the matchup dodge returning. The victim loses gas on deposit and commit, about 3 minutes of locked stake plus 5%, and a wasted match. The boost-ladder motive, pushing a rival below the "battles played" floor, is plausible but depends on off-chain behaviour I did not verify. I did not check whether the server counts cancelled battles or throttles cancels. Low is the right severity: it breaks the documented "griefing is always negative EV" principle with bounded, non-monetary victim cost.

*What limits it.* - **No on-chain guard stops it.** The only limits are economic and off-chain.
- **No funds lost:** the victim gets a full refund. The cost to the victim is gas, about 3 minutes of capital lock, and a wasted match slot.
- **Attacker cost:** the attacker's own stake plus 5% is locked for the same period, and they pay gas for approve, deposit and commit.
- **Wallet identity:** the matchmaker (`MATCHMAKER_ROLE`) chooses pairings, so off-chain cancel-rate throttling or bans could deter repeat offenders per wallet. This is documented as telemetry-only at launch.
- **Boost-ladder motive:** this depends on off-chain qualification counting, which I did not verify.
- **Scale:** at Low stake, 5% is only 125 CLAW, so the evaded penalty is small in absolute terms.

### D-15

**In V3 the 5% anti-grief deposit is never slashed for in-battle misconduct: the off-chain 3-timeout/resign forfeit settles as an ordinary loss, so deliberate in-battle stalling is free**

- Severity after verification: **Low** (claimed Low) · status **confirmed** · reported by: ba-funds, ba-state, ba-trust, ba-reveal
- Location: contracts/BattleArena.sol:938-941 (loser always gets antiGrief back); :474-498 and :893-952 (settle/_executePayout have no forfeit or slash input)

**What goes wrong.** Plain language: the design doc and battle runbook say 3 consecutive shot-clock timeouts, or a forfeit, slash the 5% anti-grief deposit. After the V3 rewrite the contract has no way to do that: every settle() outcome returns the loser's antiGrief in full, the session manager turns a timeout or resignation forfeit into a plain settle_battle with a winner, and the only slash left is the TeamCommit-phase _forfeit (_handleActiveTimeout and _forfeitAsLoss were deleted). Fund conservation is unaffected; what is lost is the deterrent -- from Active onward the deposit is dead capital. A stalling player (submits at 59 seconds every turn, or times out twice then acts on the third, every own turn) pays nothing beyond losing the battle. Together with D-13 and D-14 the net effect is that the deposit never deters deliberate griefing anywhere and only taxes honest latency. Severity note: ba-funds rated this aspect standalone as Info; ba-state, ba-trust and ba-reveal included it inside Low findings, so Low is kept.

**Attack.** Not a theft path. Actor: a losing agent. It stalls every own turn to the shot clock (timing out twice, acting on the third), up to the 100-turn cap (~100 minutes, within ACTIVE_WINDOW), tying up the opponent's stake and locked team (no mining for that team meanwhile); the final settle returns the staller's anti-grief in full.

**Evidence.** contracts/BattleArena.sol:938-941 (safeTransfer(loser, antiGrief)), :1013-1029 (only slash site, reachable only from _handleCommitTimeout :1039-1051); docs/runbooks/battle-session.md:11,21 (forfeit leads to settle_battle); apps/api/src/lib/battle-session/manager.ts:167-168; docs/audits/2026-09-05-v3-settle-delta.md 'Removed' table; .claude/CLAUDE.md:274,508-509,513 ('after 3 consecutive per-turn timeouts ... anti-grief deposit slashed', 'griefing is always negative EV').

**Suggested fix.** Either add a resolver-proposed, disputable forfeit flag to settle()/adminResolveDispute (settle(..., forfeiter)) that routes the forfeiter's antiGrief to the Treasury so timeout-forfeits and resigns are penalised as specified, or correct the docs (and consider dropping the deposit).

**Skeptic (code path): CONFIRMED, Low.** Verdict: confirmed, Low. The defect is real: from the Active phase onward the 5% anti-grief deposit is always refunded in full, so the in-battle penalty the docs promise (3 timeouts or a forfeit slashes the deposit) does not exist on-chain. No funds are lost or stolen.

How I traced it in the current code:
- `settle()` takes only the battle id, winner, two hashes and two damage arrays. It has no forfeit or slash input.
- `_executePayout` is the only payout function. `finalizeBattle`, `handleTimeout` in AwaitingFinalize, and `adminResolveDispute` all route through it.
- In `_executePayout` the loser always gets the full anti-grief back via `safeTransfer(loser, antiGrief)`. In a draw both players get stake plus anti-grief.
- `adminResolveDispute` only routes the dispute bond, then calls the same `_executePayout`. Even the multisig cannot slash the deposit of a player who forfeited mid-battle.
- A stale Active battle goes to `_cancelBattle` with full refunds.
- `AntiGriefSlashed` is emitted at exactly one place, inside `_forfeit`. `_forfeit` has exactly two call sites, both in `_handleCommitTimeout`, which runs only in the TeamCommit phase.
- Off-chain, the runbook says 3 consecutive shot-clock expiries end the battle as a forfeit, which then enqueues an ordinary `settle_battle`. The session manager's `forfeit()` just calls `session.resign(side)` and the other side wins. Neither path carries a penalty on-chain.
- The design doc still says the deposit is slashed after 3 consecutive timeouts and that griefing is always negative EV.

Severity: Low. Fund conservation holds, so this is a lost deterrent plus a docs-versus-code mismatch. The staller still loses the full stake and takes loser damage. The victim's cost is opportunity cost only, since their team is locked.

The finder's "~100 minutes" is imprecise. It treats all 100 turns as the staller's. Roughly half the turns belong to the staller at near 60 seconds each, so about 50 minutes, still within the 3-hour `ACTIVE_WINDOW`. The twice-timeout-then-act pattern does avoid the 3-consecutive rule, but each timeout auto-Defends, which weakens the staller's position.

*What limits it.* - This is not a theft path. The staller still loses the full stake (2,500 / 10,000 / 50,000 $CLAW) and takes loser-level damage, so stalling does not profit them.
- The off-chain 3-consecutive-timeout forfeit and the 100-turn cap bound the stall. Only the staller's own turns can be delayed, so roughly 50 minutes in practice, within the 3-hour `ACTIVE_WINDOW`.
- Each timeout auto-Defends, which weakens the staller's position.
- The victim's cost is opportunity cost only: their stake and team are locked, with no mining for that team meanwhile.
- The deterrent gap is 5% of stake. For a rational loser it is marginal next to the stake already lost.

### D-17

**Queued team is not bound on-chain or in the API: a multi-team player can counter-pick after the opponent's identity and power are published, and a single-team opponent's composition is inferable from public chain data**

- Severity after verification: **Low** (claimed Low) · status **confirmed** · reported by: ba-reveal
- Location: contracts/BattleArena.sol:433-437 (reveal binds only the power score, not the queued teamId)

**What goes wrong.** Plain language: commit-reveal is supposed to stop counter-picking, but the only thing createBattle binds is each side's power number (3-9). BattleCreated publishes both player addresses and both powers before anyone deposits. Because lobsters in a team are locked and EvolutionLab refuses locked lobsters, a teamId's power can never change, so anyone can enumerate the opponent's teams via TeamManager.getTeamsByOwner, compute each team's power from public tiers, drop the ones that are active or over the damage gate, and is frequently left with exactly one candidate: the opponent's composition is known before deposit. Meanwhile nothing forces a player to commit the team they queued with: commitTeam takes an opaque hash, the API's reveal-team route checks the hash against the on-chain commit but never against queuedTeamA/B, and revealTeams only checks the revealed team's power equals the snapshot. So a player holding several same-power teams chooses which one to commit AFTER learning who (and therefore usually what) they face. The victim is any player with one eligible team at that power (typical for newcomers and humans). This is the tracker's X3 'queued team is not reserved' seen from the contract side: F-04 closed the power-swap but left the same-power swap open.

**Attack.** Actor: player A owning >= 2 inactive teams of equal power with different class mixes. Precondition: matched against B who has only one eligible team at powerB. (1) Both queue; matchmaker createBattle(A,B,stake,powerA,powerB) -> BattleCreated. (2) A calls TeamManager.getTeamsByOwner(B), getTeam, LobsterNFT.getEvolutionTier/getDamage/getDNA and identifies B's only team with power == powerB. (3) A deposits, then commitTeam(keccak(battleId,A,bestCounterTeamId,salt)) instead of the queued team. (4) A POSTs {teamId: bestCounterTeamId, salt} to /reveal-team -- accepted because only the hash is checked. (5) revealTeams passes since power matches. If the matchup is bad even with the best counter, A walks away pre-deposit for free (by design). Loss: B plays every battle at a systematic class disadvantage (0.80x dealt / 1.25x taken), losing stake at an elevated rate.

**Evidence.** contracts/BattleArena.sol:305-336 (createBattle stores only players, stake, powers; event :182 publishes them), :372-396 (opaque hash), :433-437 (only TeamPowerChanged binding), :860-888 (validation: owner, not in battle, not active, tier, damage); contracts/TeamManager.sol:152 (public getTeamsByOwner); contracts/EvolutionLab.sol:67 (locked lobster cannot evolve => a teamId's power is immutable); apps/api/src/routes/game/combat/battle-writes.ts:76-95 (commit-team wraps the caller's hash), :130-146 (hash check only, queuedTeam never compared).

**Suggested fix.** Bind the queued team without publishing it: matchmaker passes per-side commitments teamBindA/B = keccak256(queuedTeamId, matchmakerSalt) into createBattle, and revealTeams takes the matchmaker salts and requires keccak256(teamIdA, mmSaltA) == teamBindA (same for B). Cheaper interim: API reveal-team route rejects teamId != queuedTeamA/B (turns a counter-pick into a no-info mutual cancel). The inference half is inherent while identity+power are public; delay publishing the opponent address until both have deposited, or accept and document it.

**Skeptic (code path): CONFIRMED, Low.** The finding holds: every step of the claimed sequence executes in the current code, and nothing on-chain or in the API or engine stops it.

Plain language: the contract only fixes each side's power number (3-9), never the team a player queued with. A player who owns several teams of equal power can choose which one to commit after the match publishes the opponent's address and power. A single-team opponent's line-up can usually be worked out from public chain data before anyone deposits. This does not steal funds or break accounting. It weakens the design's stated "commit-reveal prevents counter-picking" guarantee for players who own only one eligible team.

How I traced it:
- **Match creation.** `createBattle` stores only the players, the stake and `powerA`/`powerB`. It then emits `BattleCreated` with both addresses and both powers before any deposit. No team id and no binding commitment is stored.
- **Commit.** `commitTeam` accepts any `bytes32` hash. It checks only the phase, that the caller is a participant, the deadline, and that the caller has not already committed.
- **Reveal.** `revealTeams` checks the hash preimage `(battleId, player, teamId, salt)`, runs `_validateTeamForBattle`, and requires the revealed team's power to equal the snapshot. `_validateTeamForBattle` checks that the team exists, its owner, that it is not in a battle or active, that each lobster's tier is at least 1, and that each lobster's damage is at most 79. None of these ties the reveal to the queued team.
- **Off-chain, API.** The `/reveal-team` route compares the recomputed hash only against the on-chain commit. It then writes the caller-supplied `teamId` into `teamA`/`teamB`. It never reads `queuedTeamA/B`.
- **Off-chain, engine.** The reveal watcher submits `row.teamA`/`row.teamB` straight from that row and makes no reference to the queued team. A search for `queuedTeam` finds it used only in the matchmaker insert, in redaction for reads, and in indexer display. Nothing enforces it.
- **Inference half.** `TeamManager.getTeamsByOwner` is a public view. `EvolutionLab.evolve` reverts on a locked lobster, so an existing `teamId` cannot change power while it is assembled. Tier and damage getters are public. Enumerating the opponent's eligible teams at the published power therefore works.

Two qualifications:
- The hole is symmetric. The opponent can do the same if it also owns several equal-power teams. The victim is specifically the single-team player.
- The class edge is bounded (1.25x dealt, 0.80x taken). It needs a roster deep enough to hold more than one equal-power team with a different class mix.

Low is the right severity. This is a fairness and information-leak defect with bounded expected-value impact.

*What limits it.* - **Power binding (F-04) still holds.** The attacker can only swap among teams of identical power, so the power-swap vector stays closed.
- **Roster requirement.** The attacker needs two or more inactive, undamaged (damage at most 79), Evolved-or-higher teams at the same power with meaningfully different class mixes. That means six or more evolved lobsters, which is a real capital cost.
- **Inference is not always exact.** It yields a single candidate only when the victim has one eligible team at that power. If the victim holds several, it yields a set.
- **Bounded edge.** The class multiplier is 1.25x dealt and 0.80x taken. Positioning and skill still matter.
- **Symmetric.** The opponent can use the same technique.
- **No funds stolen or locked.** Stake escrow and payout accounting are unaffected.

### D-18

**Glide day count excludes the current day: a crowded season is paced over 59 days, the budget runs dry a day early and nobody can mine on day 60; one boundary block can select a rate up to 30% lower**

- Severity after verification: **Low** (claimed Low) · status **confirmed** · reported by: mp-math, mp-glide
- Location: contracts/MiningPool.sol:479-480 (remainingDays = (SEASON_DURATION - elapsed) / 1 days; zero -> 1 patch); :483 (target)

**What goes wrong.** Plain language: the daily re-peg divides the remaining budget by the days left, but undercounts them by one. Whenever the glide is binding (crowded mines -- the case it exists for), the pool plans to spend everything by the end of day 59 and every startExpedition on the last day reverts SeasonBudgetExhausted. The gitbook promises the budget lasts the full 60 days and that the hard check is not expected to trigger. Technical: _repegIfNeeded fires on the first touch of epoch k, when elapsed is in [k days, k+1 days); remainingDays floors to 59-k (except the single second where elapsed == k days, where it is 60-k), while 60-k epochs remain including today. The off-chain model that justified TOK-G1 uses the inclusive count `days - day + 1` (season.ts:104), so the contract diverges from the model it was validated against. With steady demand W, R_{k+1} = R_k*(58-k)/(59-k) and R reaches 0 at the end of epoch 58; the `remainingDays == 0 -> 1` patch only fixes the last epoch itself. A Python port of the contract rule (trailing demand, +/-30% clamp, launch cap) against the model's three scenarios (800 / 3,000 / 10,000 wallets) reached 0.00 at the end of day 59 every time; with divisor 60-k all 60 days are served. No CLAW is lost -- the same budget is handed out over 59 days -- but there is a guaranteed mining halt on the final day of every crowded season, with reverts starting late on day 59 and hitting the 25x Apex tier first. The day-60 repeg with remaining = 0 cuts baseReward by 30%, and RepairShop reads that stale, lower peg for repair prices for the whole gap until the next startSeason. Boundary block: Base timestamps step by 2s and 86,400 is even, so exactly one block per day has elapsed == k days; the first touch in that block computes a target (59-k)/(60-k)... i.e. uses 60-k instead of 59-k -- 1.7% lower on day 1, 25% lower on day 56, 50% lower on day 58 (clamp limits to -30%), so the first caller's timing changes the rate for the day. The manipulation only works downward and the lower value happens to be the arithmetically correct one. No test warps to days 57-59.

**Attack.** (a) No attacker; deterministic under honest use. Precondition: a season where the glide binds (target < launchBaseReward; for S1 roughly >= 800 full-time Base teams). Normal mining through epoch 58; the first startExpedition/repeg() in epoch 58 computes remainingDays = 1 although ~2 days remain, so baseReward is set to spend all of `remaining` in one day; by the end of epoch 58 totalMinted ~= totalEmission; in epoch 59 every startExpedition reverts SeasonBudgetExhausted (:279). Who loses: every miner loses the last 24h (1/60 of season time); teams whose expeditions straddle the final day lose relatively more. (b) Actor: any player about to pay a large repair bill late in the season submits repeg() timed for the block with timestamp == startTime + k days with no state touch before it in that block; if it lands first, the whole day's baseReward is up to 30% lower. Cost: gas. Miners lose up to 30% of that day's income; everyone repairs up to 30% cheaper that day.

**Evidence.** contracts/MiningPool.sol:467-495 (_repegIfNeeded), :479-480 and :483 (re-verified at HEAD), :448-451 (permissionless repeg), :279 (hard budget revert); packages/game-logic/src/v3/season.ts:104 (inclusive `days - day + 1`); docs/gitbook/mining.md:58; contracts/RepairShop.sol:72; test/MiningPool.t.sol:1080-1150 (glide tests cover only epoch 0 to 1; grep for 57/58/59 days across test/MiningPool.t.sol, contracts/test/fuzz/FuzzMiningPool.t.sol, contracts/test/invariant returned nothing); docs/audits/2026-09-03-boost-surface.md:57 (suppression note says only that the integer day count is by design).

**Suggested fix.** Count the current epoch as a remaining day: remainingDays = SEASON_DURATION / REPEG_EPOCH - epoch (= 60-k, always >= 1 inside an active season, constant across the whole epoch incl. the boundary block). Add a test running steady crowded demand through epochs 57-59 (through day 60) asserting startExpedition still succeeds in the last epoch.

**Skeptic (code path): CONFIRMED, Low.** **Verdict:** the defect is real and I found nothing in the current code that stops it. When mines are crowded, the daily re-peg paces the season budget over 59 days instead of 60, so mining halts on the final day. No CLAW is stolen or locked; the same budget is simply paid out a day early. Low is the right severity.

**How it happens:**
- `_repegIfNeeded` runs once per epoch, on the first touch of that epoch (`MiningPool.sol:468-469`).
- On epoch k the elapsed time is between k and k+1 days, so `remainingDays` floors to 59-k (`:479`), even though 60-k epochs remain including today.
- The target rate is `remaining / (remainingDays * trailing)` (`:483`). With steady demand W, each day spends `remaining/(59-k)`, so the remaining budget shrinks by the factor (58-k)/(59-k) each day.
- On epoch 58 `remainingDays` is 1, so the rate is set to spend the entire remaining budget that day.
- The `remainingDays == 0 -> 1` patch (`:480`) only applies to epoch 59, by which point only rounding dust is left.
- On epoch 59 the target is about 0, the clamp sets the rate to 0.7 × old, the reward exceeds the dust, and every `startExpedition` reverts `SeasonBudgetExhausted` (`:279`).
- Reverts begin late on day 59 and hit the 25x Apex tier first, because its reward is largest.

**Contradicted documents:**
- `docs/gitbook/mining.md:58` says the budget "lasts the full 60 days".
- The off-chain model counts the current day: `days - day + 1` (`season.ts:104`).

**Corrections to the finder's write-up (none change the outcome):**
- The finder says the rate R decays by (58-k)/(59-k) per day. It is the remaining budget that decays by that factor; the rate itself stays roughly constant. The budget still reaches about zero at the end of epoch 58.
- The 30% rate drop on day 60, and the cheaper repairs that follow, do not happen automatically. A failed `startExpedition` reverts and rolls back its re-peg. The drop only persists if someone calls the permissionless `repeg()` directly (`:448-451`), which costs only gas. Once it persists, `RepairShop.repairRate` reads the lower value (`RepairShop.sol:72`) and repairs are 30% cheaper until the next `startSeason`.

**Boundary block:** in the one block per day where elapsed is exactly k days, the first touch computes `remainingDays` as 60-k and sets a lower rate, which happens to be the arithmetically correct one. This only moves the rate downward, within the 30% clamp, and benefits no one. It is negligible.

**Test coverage:** a search of the fuzz and invariant tests found no warp to days 56-59; the only hits were the generic `handler_warp` helpers.

*What limits it.* - **Only when the glide binds:** the halt occurs only when the target rate is below `launchBaseReward` (crowded mines). In an uncrowded season the launch cap holds and the budget is never exhausted.
- **No funds lost or locked:** the same budget is distributed over 59 days instead of 60. The loss is one day of mining availability (1/60 of the season).
- **Day-60 repair discount needs a caller:** the 30% drop persists only if someone calls `repeg()` directly in epoch 59; a reverted `startExpedition` does not persist it.
- **Boundary block is not exploitable for profit:** it only moves the rate downward, to the arithmetically correct value, within the 30% clamp.
- **Admin override exists:** `setBaseReward` could be used to re-pace the rate late in the season.

### D-19

**The on-chain glide (epoch-0 blind spot, one-day demand lag, -30%/day clamp) was never modelled: a demand step drains most of the season budget before the rate catches up, and after an early exhaustion a permissionless repeg() drives baseReward -- and with it repair prices -- toward zero**

- Severity after verification: **Low** (claimed Low) · status **confirmed** · reported by: mp-math, mp-glide
- Location: contracts/MiningPool.sol:486-489 (+/-30% clamp and launch cap); :472-476 (trailing epoch only); :215,:468-469 (no re-peg in epoch 0)

**What goes wrong.** Plain language: the on-chain glide is not the controller the economics model validated. The model re-pegs instantly on same-day demand with no clamp (season.ts:103-105; grep for 'clamp'/'trailing' returns nothing). The contract has no demand signal during epoch 0 (day 1 always pays the launch rate), uses yesterday's demand, and can fall at most 30% per day, while demand can multiply by any factor in a day. With launch-day demand D weight-units/day, cumulative spend approaches D * launch / 0.3 before the reward catches up. For S1 (352.5M budget, 1,250 launch reward) the budget is mathematically exhaustible once D >= ~84,600 units/day (~14,100 Base teams mining 6x/day from the first days). Port of the contract rule: 15,000 teams from day 1 -> exhaustion on day 8; 20,000 teams with a 3-day ramp -> day 11; the model's own faucet-scale scenario (6,000 teams, 7-day ramp) survives with 23% of budget gone by day 8; 10,000 full-time teams from day 1 -> rate path 1250, 875, 612, 429, 300, 210, 147, 103, ~235M (67%) spent in the first 8 days, and the remaining 52 days pay ~38 per unit vs the ~98 the model predicts (one finder: settles near 9.7 CLAW per Base expedition). Cross-contract consequence after an early exhaustion: startExpedition reverts but repeg() is permissionless and still runs; with remaining == 0 the target is 0, so each daily call cuts baseReward another 30%. RepairShop prices repairs as bps of currentBaseReward (only an exactly-zero rate reverts), so battlers have a direct incentive to call repeg() daily: after 50 days baseReward is ~1e-8 of launch and repairs are effectively free, removing the repair sink and the 80-damage gate for the rest of the season; the reward cannot recover (+30% of dust, budget 0). Mitigations: SEASON_ADMIN (the Safe after Handoff) can setBaseReward as emergency override, but must act within the first 2-3 days and cannot recover spent budget. The hard cap is never breached: this is a pacing failure, not an over-mint. Farming check (mp-glide): a whale alternating idle and burst days does not gain -- its share strictly falls -- so the distributional effect is unfairness to later miners (and possible griefing by a majority miner draining the budget in ~two weeks at a cost to its own share), not extraction. mp-glide rated Info; mp-math Low; Low kept.

**Attack.** Actor: a sybil mining farm, or simply high organic adoption; no privilege (starting an expedition costs only gas). Preconditions: >= ~14,000 Base-tier teams (~42,000 lobsters, ~8,500 faucet wallets at 5 lobsters each; fewer once evolved since Evolved counts 3x) mining full-time from days 1-3 of S1. Sequence: each team calls startExpedition/claimExpedition every 4h. Day 1 pays 1,250 regardless of team count; days 2-8 pay 875, 612, 429, 300, 210, 147, 103 while demand is already ~10x what that rate supports; totalMinted reaches totalEmission around day 8; for the remaining ~52 days every startExpedition reverts SeasonBudgetExhausted. Any battler then calls repeg() once a day: baseReward x0.7 per day and RepairShop.repair cost -> 0. Who loses: every miner not part of the early rush gets zero mining income for ~52 days; the protocol loses the repair burn sink for the rest of the season; early sybils capture nearly the whole season's emission at near-launch rates. (Compounds with D-02.)

**Evidence.** contracts/MiningPool.sol:215 and :468-469 (lastRepegEpoch = 0 => no re-peg in epoch 0), :472-476, :486-489, :448-451 (permissionless repeg), :481-483 (remaining = 0 => target 0); contracts/RepairShop.sol:72 and :95-98 (rate = currentBaseReward * bps; only zero reverts); packages/game-logic/src/v3/season.ts:103-105 (idealized unclamped same-day glide), :158-162 (largest scenario 10,000 wallets at 60% participation); docs/gitbook/mining.md:58.

**Suggested fix.** One or more of: (a) make the downward step uncapped or much larger than the upward step (e.g. -50%) -- crowding is the dangerous direction; (b) seed epoch 0 / trailingWeightServed at startSeason with a conservative expected-demand figure, or re-peg during epoch 0 from a partial-epoch estimate; (c) in _repegIfNeeded hold baseReward when remaining == 0 so an exhausted budget cannot be used to push repair prices toward zero, or give RepairShop a floor (launchBaseReward x minimum bps); (d) add the clamp, lag, epoch-0 blind spot and corrected day count to season.ts and rerun at 15K-30K teams so the documented claim matches the deployed controller.

**Skeptic (code path): CONFIRMED, Low.** **Verdict: confirmed, Low.** Every code step in the finding runs as described and no guard stops it. The scale precondition is large, and the season admin can correct the rate. No funds are stolen or locked, and the hard cap holds. It is a pacing and economic-design defect: a permissionless lever (daily `repeg()` after exhaustion) collapses repair prices until the admin steps in.

**What the code does**
- **Epoch 0 is blind.** `startSeason` sets `lastRepegEpoch = 0` and `trailingWeightServed = 0`. In `_repegIfNeeded`, epoch 0 equals `lastRepegEpoch`, so it returns early. All of day 1 pays the launch reward whatever the demand.
- **One-day demand lag.** At the first touch of a new epoch, `trailing` is set to the previous epoch's `epochWeightServed / 10_000`. The rate is always pegged to yesterday's demand.
- **Clamp.** `target = remaining / (remainingDays * trailing)`. The step is clamped to ±30% (`REPEG_MAX_STEP_BPS = 3_000`), capped at `launchBaseReward`, with a dust floor of 1 wei.
- **Consequence.** The rate can fall at most 30% per day. Cumulative spend under constant demand D is therefore bounded by about 1250·D/0.3. 352.5M / (1250/0.3) ≈ 84,600 weight-units per day, about 14,100 Base teams at 6 expeditions per day, which matches the finder's threshold. I did not re-run the finder's per-scenario day counts; the geometric bound is consistent with them.

**After the budget is exhausted**
- `startExpedition` reverts `SeasonBudgetExhausted` at :279, and the revert rolls back its own repeg.
- `repeg()` at :448-451 has no role check and only requires an active season.
- With `epochWeightServed == 0`, `trailing` keeps its last nonzero value, so there is no early return. `remaining = 0` gives `target = 0`, so `next = lo = old × 0.7`, once per epoch, per call.
- `RepairShop.repairRate` is `currentBaseReward × bps / 10_000`, and only an exactly-zero rate reverts. After 50 days the rate is about 1250e18 × 0.7^50 ≈ 2e13 wei, so repairs are effectively free.
- Upward recovery is limited to +30% of dust. With `target = 0` it never rises.

**The economics model differs from the contract.** `season.ts:103-105` re-pegs on same-day demand with no clamp. Grep for `clamp` and `trailing` in that file returns nothing.

*What limits it.* - **Scale.** The drain needs about 84.6K weight-units per day from the first days. That is roughly 14K Base teams mining full-time, which is more than the whole faucet cohort (~10K wallets × 5 lobsters ≈ 16.7K teams at most). It is reachable only at very high adoption or with sybil farms.
- **No attacker profit.** A farmer's share of the emission falls as it adds demand, so the effect is a redistribution toward early miners rather than theft.
- **Admin override.** `SEASON_ADMIN` can call `setBaseReward` at any time. That resets the rate during the rush, and after exhaustion it restores repair pricing. The glide then decays it 30% per day again, and only while someone calls `repeg()`, so the admin has to keep re-setting it. Spent budget cannot be recovered.
- **Caps hold.** The 705M lifetime cap and the season cap are never breached.
- **Dust floor.** The rate never reaches exactly 0, so repairs never revert. They become nearly free.

### D-20

**startSeason does not bound totalEmission by the remaining 705M lifetime allocation, so the glide paces against a budget that cannot be minted**

- Severity after verification: **Low** (claimed Low) · status **confirmed** · reported by: mp-glide
- Location: contracts/MiningPool.sol:198-221 (startSeason validates only non-zero inputs)

**What goes wrong.** Plain language: in the final season (~S8) only ~3.97M of the 705M allocation remains. If the multisig starts that season with the schedule's nominal number (e.g. 7.05M), the glide believes it has 7.05M to spread over 60 days, sets baseReward too high, and mining stops abruptly mid-season when the lifetime cap hits -- the cliff TOK-G1 was built to remove. Technical: _repegIfNeeded computes remaining = totalEmission - totalMinted and never considers MINING_ALLOCATION - lifetimeMinted, which is enforced separately at mint time.

**Attack.** Actor: SEASON_ADMIN, by honest mistake. Call: startSeason(totalEmission > MINING_ALLOCATION - lifetimeMinted, baseReward). Result: the glide targets roughly totalEmission / lifetimeRemaining times the sustainable rate; early-season miners are overpaid; MiningAllocationExhausted then reverts every startExpedition for the rest of the season. Late-season miners lose their share. The repair peg stays at the inflated baseReward, because with no demand `trailing` holds and the target never drops.

**Evidence.** contracts/MiningPool.sol:198-221 (no check against lifetimeMinted; signature at :198 re-verified), :281 (cap enforced only at mint), :481-483 (remaining ignores the lifetime cap); .claude/CLAUDE.md emission schedule ('Season 8+: <=3.97M then 0').

**Suggested fix.** Revert in startSeason when totalEmission > MINING_ALLOCATION - lifetimeMinted, or compute remaining in _repegIfNeeded as min(seasonRemaining, MINING_ALLOCATION - lifetimeMinted).

**Skeptic (code path): CONFIRMED, Low.** Plain language: the defect is real. `startSeason` accepts any non-zero season budget, and the daily glide paces only against that season number; it never looks at what is left of the 705M lifetime allocation. In the final season (about S8), if the multisig enters the nominal 7.05M while only about 3.97M is still mintable, the glide spreads a budget that cannot be minted. Rewards run about 1.78x the sustainable rate. Mining then stops around day 34 of 60, when `MiningAllocationExhausted` begins reverting every `startExpedition` for the rest of the season.

Code path, checked line by line:
- **`startSeason` (MiningPool.sol:198-221):** the only checks are `totalEmission != 0`, `baseReward != 0`, and that the previous season has ended. There is no comparison with `MINING_ALLOCATION - lifetimeMinted`.
- **`_repegIfNeeded` (:481-483):** `remaining = totalEmission - totalMinted` and `target = remaining / (remainingDays * trailing)`. The lifetime cap does not enter the calculation.
- **Lifetime cap (:281):** it is checked only at mint time in `startExpedition`, after the season-budget check at :279.
- **After the cliff:** no expedition succeeds, so `epochWeightServed` stays 0. `trailingWeightServed` keeps its last value, and `remaining` (from the season number) stays positive. The target therefore never falls, and `baseReward` and the repair peg stay at the inflated level.
- **Runbooks and deploy scripts:** no mention of `lifetimeMinted` or `MINING_ALLOCATION` when choosing `totalEmission` (grep returned nothing).

Severity stays Low. It needs an honest misconfiguration by SEASON_ADMIN (multisig). No funds are lost or locked: escrowed rewards remain claimable and the 705M cap still holds. Only one season, most likely the final small one, is affected. The harm is unfair distribution (early miners overpaid, late miners get nothing) and the reappearance of the mid-season cliff that TOK-G1 was built to remove.

*What limits it.* - **Privileged, honest error required:** only `SEASON_ADMIN_ROLE` can call `startSeason`, and only by entering the wrong number. No unprivileged actor can trigger it.
- **Reward cap:** the glide is capped at `launchBaseReward`. If the admin picks a conservative launch reward, or demand is low enough that the launch cap binds, the overpayment shrinks or disappears.
- **Partial mitigation:** `setBaseReward` lets the admin lower the rate mid-season. `totalEmission` cannot be changed afterwards, so the glide would drift back up by up to 30% per day.
- **Bounded harm:** no funds are at risk and the 705M cap still holds. Only seasons where the nominal budget exceeds the lifetime remainder are affected (about S8, roughly 4M CLAW).

### D-21

**A committed breed is forfeited entirely after the 256-block (~8.5 min) blockhash window, and the keeper the F5-02 fix relies on does not exist in the repo**

- Severity after verification: **Low** (claimed Low) · status **confirmed** · reported by: econ-peripherals
- Location: contracts/BreedingLab.sol:171-172 (RequestExpired); :223-241 (cancelExpiredRequest refunds nothing)

**What goes wrong.** Plain language: F5-02 correctly removed the breed-slot refund, closing the outcome-selective re-roll. The side effect: a breed request not finalized within 256 blocks of its target block (~8.5 minutes on Base) now loses everything -- the fee (1,000 to 16,000+ CLAW), one of five lifetime breed slots on EACH parent, and no offspring is minted. Before F5-02 only the fee was lost. The NatSpec justifies this with 'the keeper auto-finalizes within the window, so honest breeders never reach this path', but no keeper, API route or web client in the repo calls finalizeBreed -- only the ABI references it. Human players on the mini-app, and agents whose process stalls for 9 minutes, permanently lose the breed.

**Attack.** No attacker; liveness failure. (1) User calls requestBreed(A,B), pays the fee; both parents' breedCount incremented. (2) The user's client/agent/RPC is unavailable, or the absent keeper does not run, for > ~8.5 minutes. (3) finalizeBreed reverts RequestExpired permanently (blockhash(targetBlock) == 0). (4) Anyone calls cancelExpiredRequest, which only marks the request closed. Loss: full fee + two breed slots, no offspring. A 10+ minute outage of the future keeper or API voids every in-flight breed protocol-wide with no recourse.

**Evidence.** contracts/BreedingLab.sol:171-172, :223-241, :216-217 (NatSpec relies on a keeper); grep for finalizeBreed across apps/, packages/, scripts/ matches only packages/chain/src/abis/breeding-lab.ts.

**Suggested fix.** Keep the no-refund rule but remove the cliff: when blockhash() returns 0, read the target block hash from the EIP-2935 history contract (~8,191 blocks, ~4.5 h on Base); or re-target an expired request to a fresh future block on a permissionless 'retarget' call (a forced, non-selective re-roll gives no selection power if anyone can trigger it and the first finalizable result is binding). Ship and monitor the keeper before launch.

**Skeptic (code path): CONFIRMED, Low.** Plain language: the finding is accurate. Once a breed is requested, the user pays the fee and both parents use a breed slot immediately. If nobody calls finalizeBreed within about 256 blocks (~8.5 minutes on Base), the breed can never be finalized. The cancel function then only closes the record. No fee comes back, no slot is restored and no offspring is minted. The code comments say a keeper finalizes every request inside the window, but no such keeper exists in the repo. It is not an attack and an attacker cannot force it, so it stays Low. It must be tracked as a launch prerequisite: ship the keeper or remove the cliff.

Code path, step by step:
- requestBreed calls _collectFeeAndUpdateParents, which pulls CLAW from the user (BreedingLab.sol:253). That function also increments both parents' breed counts. I did not print that line; I rely on the requestBreed NatSpec "Breed count is incremented" (:110) and the F5-02 NatSpec (:215-218).
- The request stores targetBlock = block.number + FINALIZE_MIN_BLOCKS, which is 2 (:27, :137).
- finalizeBreed reads blockhash(req.targetBlock) and reverts RequestExpired when it is zero (:171-172). Beyond 256 blocks the EVM always returns zero, so the revert is permanent. There is no retarget path and no EIP-2935 fallback.
- cancelExpiredRequest only sets req.finalized = true and emits BreedRequestExpired (:223-241). It transfers nothing and never calls decrementBreedCount.
- Before F5-02 the cancel path restored both parents' breed counts. The F5-02 NatSpec says so ("Previously this restored both parents' breed counts", :205-220), and the June audit refers to a counter that cancelExpiredRequest restored (2026-06-10 audit, line 81). So losing the two slots is new since commit 1a629ab. The fee was already lost on expiry before that change.

The keeper does not exist:
- Searching apps/, packages/, scripts/ and server/ for finalizeBreed, cancelExpiredRequest and BreedRequested returns nothing outside the generated ABI (packages/chain/src/abis/breeding-lab.ts).
- The indexer's breeding watcher subscribes only to LobsterBred (apps/indexer/src/watchers/breeding-watcher.ts:16,24). It does not watch BreedRequested or BreedRequestExpired.
- No file in docs/runbooks mentions a keeper.
- The June audit relies on the keeper as the operational mitigation: "which the breeding API must run anyway" (docs/audits/2026-06-10-fable5-deep-campaign.md:79). The API does not contain it.

*What limits it.* - No attacker can cause or speed up the expiry. finalizeBreed is permissionless and non-selective, so any third party, or the user from any client, can rescue a request inside the window.
- The window opens 3 blocks (about 6 seconds) after the request and stays open about 8.5 minutes. A normal client sends finalize immediately.
- The loss per incident is bounded to one breed fee plus one slot on each parent.
- The failure needs a client, RPC or keeper outage longer than ~8.5 minutes, or a Base sequencer stall followed by a catch-up burst.
- The protocol does not profit from an abuse path here. The fee goes to the Treasury burn/dev split either way.

### D-22

**A third-party finalizeBreed caller can starve the offspring mint of gas so the try/catch permanently consumes a victim's breed (contract requesters with heavy receiver hooks only)**

- Severity after verification: **Low** (claimed Low) · status **contested** · reported by: econ-peripherals
- Location: contracts/BreedingLab.sol:198-203 (bare catch swallows out-of-gas); :161 (permissionless); :184 (finalized set before the mint)

**What goes wrong.** Plain language: anyone may call finalizeBreed for anyone's request, and a failed mint is swallowed by design (B-02). A griefer who picks the tx gas limit can make the inner mintWithGeneration run out of gas; the outer call keeps 1/64, completes the catch branch, and leaves the request finalized with no offspring. Estimated from source, NOT measured (forge was not allowed; finder confidence low). For EOA requesters and ordinary smart wallets the attack does not work: the mint costs ~135-145k gas, the catch path needs ~4k (cold SLOAD of req.cost, a LOG2, reentrancy-guard reset), so the retained 1/64 is at most ~2.2k and the whole tx reverts harmlessly. It becomes feasible only when the requester's onERC1155Received hook consumes roughly >= 110k gas (e.g. an agent vault writing ~5 fresh storage slots of inventory bookkeeping on receipt): the mint then exceeds ~250k and a caller can size gas so the mint fails while the catch completes. The offspring is deterministic once the target block is mined, so a griefer can selectively destroy only valuable rolls, such as a rival breeder's legend. Note F5-02 removed the refund path, so the B-02 try/catch no longer prevents any exploit.

**Attack.** Actor: any address, e.g. a competing breeder. Precondition: victim requester is a contract whose ERC-1155 receive hook is expensive (~>= 110k gas). (1) Victim calls requestBreed. (2) After the target block the attacker computes the offspring off-chain from blockhash and requestId. (3) If valuable, attacker calls finalizeBreed(requestId) with a gas limit such that 63/64 at the call site < mint cost and 1/64 >= ~4k. (4) Mint OOGs, the catch emits LobsterBredRejected, request finalized. Loss: victim loses the fee, two breed slots and the offspring; attacker pays only gas.

**Evidence.** contracts/BreedingLab.sol:161, :184, :198-203, :200,202 (req.cost read inside the branches, cold SLOAD); contracts/LobsterNFT.sol:122-143 (mint writes ~5 fresh slots); foundry.toml (via_ir=false, optimizer on). Gas figures are the finder's estimate from source.

**Suggested fix.** Before the try, require gasleft() >= a conservative floor (e.g. 400k) so the 63/64 forward always covers the mint plus a bounded hook; or forward a fixed gas amount and revert the whole call (not catch) when the inner call was OOG. Simplest: delete the try/catch and let the mint failure revert -- a reverting hook would now only hurt the requester themselves until someone else finalizes.

**Skeptic (code path): PLAUSIBLE, Low.** **Verdict: the defect is real in the code, but it is much harder to reach than the finder estimated. I rate it PLAUSIBLE at Low, bordering on Info. I did not measure gas (forge was off-limits).**

**What the code does**
- `finalizeBreed` can be called by anyone. The only checks are that the request exists, is not finalized, and that the target-block hash is available.
- It sets `req.finalized = true` before the mint.
- The mint sits inside a bare `try/catch`. A bare catch also swallows an out-of-gas failure of the inner call.
- There is no `gasleft()` floor and no fixed gas forward, so the caller controls how much gas reaches the mint.
- A caller can therefore size the gas so that `mintWithGeneration` runs out of gas while the outer frame keeps 1/64 and finishes the catch branch. The request is then finalized and no offspring exists.
- Nothing recovers from that state. `cancelExpiredRequest` refunds nothing after F5-02, and a finalized request cannot be finalized again.
- Roughly 250 of the 256 finalize-window blocks remain for the attacker (`FINALIZE_MIN_BLOCKS` = 2).
- The offspring is deterministic from `blockhash(targetBlock)` and `requestId`, so the attacker can target only valuable rolls, as the finder says.

**Where the finder's numbers are wrong**
- The finder says the catch path needs about 4k gas. That misses the EIP-2200 sentry.
- BreedingLab uses OpenZeppelin 5.5.0's storage-based `ReentrancyGuard`, not the transient one. The `nonReentrant` epilogue is a real SSTORE, and it reverts if `gasleft()` is 2300 or less.
- The retained 1/64 must therefore cover four things:
  - a cold SLOAD of `req.cost`, about 2.1k, because that slot is not touched earlier in `finalizeBreed`;
  - a LOG2 with 64 bytes of data, about 1.6k;
  - the 2300 sentry plus the 100-gas SSTORE;
  - small overhead.
- That totals about 6.3–6.5k, not 4k.
- The gas at the call site must be at least about 64 × 6.4k ≈ 410k, and the mint must cost more than 63/64 of that, about 400k.
- An ordinary mint costs roughly 100–145k. It writes `nextTokenId`, two fresh `_lobsters` slots, `_owners`, the balance and total supply, and emits two events.
- The victim's `onERC1155Received` hook must therefore burn about 250–300k gas, not the 110k the finder gives. That means around 12 fresh storage slots, or forwarding the token on into another contract.

**What happens below that threshold**
- If the outer frame lacks enough gas to finish the catch, the whole transaction reverts. `finalized` rolls back and no harm is done.
- For EOAs and ordinary smart wallets the attack does not work. Base's ERC-4337 smart-wallet receive hooks are trivial.

**Other limits**
- The victim, or any keeper, can finalize honestly in block `targetBlock + 1`. The attacker must land their transaction first, and a victim agent that auto-finalizes wins that race.
- The attacker gains nothing directly. The loss per incident is one breed fee plus two breed slots.
- The finder is right that the B-02 try/catch no longer prevents any exploit after F5-02. Its only effect now is to turn "reverting hook means retry later" into "reverting hook means permanent loss", so removing it is the correct fix.

*What limits it.* 1. 63/64 rule combined with the EIP-2200 SSTORE sentry: the outer frame needs about 6.4k gas after the out-of-gas failure, so the mint must cost more than about 400k. That requires a receiver hook burning roughly 250–300k gas. The finder's 110k figure is too low.
2. EOAs and standard smart wallets cannot be hit. An undersized gas limit reverts the whole transaction and rolls `finalized` back.
3. The victim or any honest party can finalize first in block `targetBlock + 1`. The attacker must win that race.
4. The attacker makes no profit. This is pure griefing, bounded to one breed fee plus two breed slots per incident.

### D-23

**Handoff's 'deployer fully de-privileged' check misses ClawToken MINTER_ROLE and hot roles, and never checks that Configure finished or that the check ran against the real chain**

- Severity after verification: **Low** (claimed Low) · status **confirmed** · reported by: roles
- Location: contracts/script/Handoff.s.sol:60-72 (deployerFullyDeprivileged), :100-110 (post-broadcast requires on simulated state); contracts/script/Configure.s.sol:169-173

**What goes wrong.** Plain language: the safety check at the end of Handoff looks at only three things on the deployer -- DEFAULT_ADMIN, SEASON_ADMIN, ELIGIBILITY. It does not look at the most dangerous temporary power the deployer ever holds: ClawToken MINTER_ROLE, which Configure grants to pre-mint the faucet's 70M and then revokes, as three separate transactions that are the LAST three of the script. forge broadcasts are not atomic; if the revoke is dropped (RPC error, gas spike, operator abort), the deployer EOA keeps MINTER_ROLE and neither Handoff nor the runbook's post-launch checklist would notice. After Handoff that key is described as powerless, yet it could mint the entire unminted supply (MiningPool mints lazily, so ~705M is unminted at launch), permanently starving mining via ExceedsMaxSupply and dumping on the LP. Related gaps: (a) the requires at Handoff.s.sol:103-110 run inside forge's local simulation, not against chain state after broadcast, so a partly landed handoff is not caught by 'ROLE-I1: no silent gaps'; (b) Handoff never asserts Configure completed (currentSeason == 1, MiningPool holds MINTER_ROLE, Treasury authorizations, faucet holds 70M) -- running Handoff before Configure succeeds, and the Safe must then replay ~25 config calls by hand incl. a grant-mint-revoke of 70M; (c) on testnet fallbacks the deployer keeps MATCHMAKER, RESOLVER, BOOST_ADMIN and OPERATOR and the predicate still returns true -- GovernanceHandoff.t.sol shows the blindness directly (its `admin` still holds LobsterNFT MINTER/BURNER/LOCKER/EVOLVER/DAMAGE plus every hot role after handoff and the test asserts 'deployer fully de-privileged').

**Attack.** Actor: an attacker who later obtains DEPLOYER_PRIVATE_KEY (a raw key in an env var/.env). Precondition: Configure's last tx, revokeRole(MINTER, deployer) at Configure.s.sol:173, never landed and nobody checked. Sequence: ClawToken.mint(attacker, MAX_SUPPLY - totalSupply()). Who loses: all holders diluted by up to ~705M CLAW, the 125M + 6 ETH LP is drained, and every future MiningPool.startExpedition reverts ExceedsMaxSupply (mining permanently dead). No dispute or admin backstop can undo a mint.

**Evidence.** contracts/script/Configure.s.sol:169-173 (grant, mint, revoke as separate broadcast txs, last in script); contracts/script/Handoff.s.sol:60-72, :100-110; contracts/ClawToken.sol:45-49 (mint cap MAX_SUPPLY - totalSupply); contracts/MiningPool.sol:286 (lazy mint); docs/runbooks/admin-roles.md:56-60 (checklist has no ClawToken MINTER_ROLE item); contracts/test/helpers/BaseSetup.t.sol:151-160,179-183 vs contracts/test/GovernanceHandoff.t.sol:45-48.

**Suggested fix.** Extend deployerFullyDeprivileged or add a standalone read-only VerifyDeployment script, run after each broadcast and again after acceptOwnership, asserting: ClawToken.hasRole(MINTER, deployer) false and (MINTER, miningPool) true; deployer holds no LobsterNFT/TeamManager/Arena/VRF/Pool role on mainnet; currentSeason == 1, faucet balance 70M, all 5 Treasury authorizations set; hot roles held by the expected env addresses; Treasury.owner() is the Safe. Make Handoff.run() require those Configure post-conditions before broadcasting.

**Skeptic (code path): CONFIRMED, Low.** Plain language: the gap is real. Low is the right severity because it takes an operational failure, no one noticing it, and a later deployer-key compromise. No unprivileged actor can trigger it.

**The core gap (confirmed)**
- Handoff's final safety check, `deployerFullyDeprivileged`, looks at three things only: `DEFAULT_ADMIN_ROLE` on the 7 AccessControl contracts, MiningPool `SEASON_ADMIN_ROLE`, and Faucet `ELIGIBILITY_ROLE`.
- It never queries ClawToken `MINTER_ROLE`.
- Configure grants `MINTER_ROLE` to the deployer, mints the faucet's 70M, then revokes. These are three separate broadcast transactions and they are the last three of the script.
- `forge script --broadcast` is not atomic, so the revoke can fail to land while the grant and the mint succeed.
- If that happens, Handoff still passes and prints "complete".
- The runbook's post-launch checklist also has no ClawToken `MINTER_ROLE` item.
- A deployer key left holding `MINTER_ROLE` can mint `MAX_SUPPLY - totalSupply()`. `ClawToken.mint` has no other guard.
- MiningPool mints lazily, so about 705M is unminted at launch. Minting it would make every later MiningPool mint revert `ExceedsMaxSupply`.
- Handoff strips only `DEFAULT_ADMIN_ROLE` from the deployer, so a lingering `MINTER_ROLE` survives the handoff.

**Related sub-claims**
- (a) Partly confirmed by reading; not run. The two requires sit after `vm.stopBroadcast()` inside `run()`. I did not execute forge, so the claim that they evaluate against forge's local simulation rather than post-broadcast chain state is my inference from how forge scripts work.
- (b) Confirmed. `Handoff.run()` has no require on any Configure post-condition. Its only checks are the env-address ones.
- (c) Partly confirmed. On testnet the four hot-role addresses fall back to the deployer when unset. `DeployHelpers` rejects hot-role addresses equal to the deployer on mainnet (requires at :89-92; the branch condition is outside the lines I read), so this part does not apply to mainnet. The predicate never inspects hot roles, so it would return true anyway.
- I did not open `contracts/test/helpers/BaseSetup.t.sol`. The finding's claim that the test `admin` still holds LobsterNFT and hot roles after handoff is unverified. The handoff test does assert "deployer fully de-privileged" using the same three-check predicate.

**Why only Low**
- The exploit needs three things together: a dropped final transaction, nobody noticing, and a later compromise of the deployer key.
- An operator would very likely see the failed revoke in forge's output.
- If the stale grant is noticed in time, the Safe holds ClawToken `DEFAULT_ADMIN_ROLE` and can revoke it.
- If the mint does happen, it is catastrophic and cannot be undone.
- This is a verification and deploy-tooling gap, not a contract bug.

*What limits it.* - The revoke at `Configure.s.sol:173` must fail to land while the grant and mint before it land. Forge reports failed or pending transactions, and `--resume` would resend the revoke.
- Nobody must notice the stale grant. If it is noticed, the Safe holds `DEFAULT_ADMIN_ROLE` on ClawToken after handoff and can revoke it, provided that happens before the key is compromised.
- The attacker must obtain `DEPLOYER_PRIVATE_KEY`.
- No unprivileged path exists.
- `DeployHelpers.s.sol:89-92` forbids hot roles equal to the deployer on mainnet, so sub-claim (c) is limited to testnet.

### D-24

**After Handoff prints 'complete', the deployer hot key still owns Treasury, can overwrite the Safe's pending transfer and freeze payouts, and still holds the 125M LP allocation**

- Severity after verification: **Low** (claimed Low) · status **confirmed** · reported by: roles
- Location: contracts/script/Handoff.s.sol:52-55, 107-115; contracts/script/Deploy.s.sol:51

**What goes wrong.** Plain language: Treasury ownership moves only when the Safe later calls acceptOwnership(). Until then the deployer EOA is still the Treasury owner even though the script and predicate describe it as 'fully de-privileged'; nothing automated checks the final state (the test asserts the intermediate state and one happy-path accept). Treasury ownership is a strong lever: every decisive battle payout, bond slash, anti-grief slash, breed, evolve, repair and fee-bearing marketplace sale calls treasury.processFee without try/catch, so setAuthorized(BattleArena,false) makes every non-draw finalize revert and freezes escrowed stakes; the owner can also redirect the 15% dev share with setDevWallet. The owner can call transferOwnership(attacker), which overwrites the Safe's pending transfer (OZ Ownable2Step: 'Replaces the pending transfer if there is one'), then accept from the attacker address. Treasury's address is fixed in every consumer contract with no setter and Treasury is Ownable, not AccessControl, so the Safe could never recover it -- a permanent ransom lever. Separately, Deploy mints the entire 125M LP allocation (12.5% of supply) to the deployer EOA; no script moves it or seeds the pool, and on mainnet the reserve and dev wallet must differ from the deployer but the LP recipient need not.

**Attack.** Actor: someone who compromises DEPLOYER_PRIVATE_KEY after Handoff and before the Safe's acceptOwnership() (a manual multisig step with no deadline; open-ended if acceptance is forgotten because the script said 'complete'). (1) Treasury.transferOwnership(attackerEOA). (2) From attackerEOA acceptOwnership(); the Safe's later accept reverts. (3) setDevWallet(attacker), and setAuthorized(battleArena,false) to freeze payouts or hold as ransom. Who loses: the protocol permanently loses the 15% fee leg; players with battles in AwaitingFinalize or Disputed have stakes frozen whenever the attacker de-authorizes BattleArena; the same key can dump the 125M CLAW LP allocation.

**Evidence.** contracts/script/Handoff.s.sol:55 (transfer proposed only), :107-110 (asserts pendingOwner only), :58-59 (predicate excludes Treasury by design); lib/openzeppelin-contracts/contracts/access/Ownable2Step.sol:43-46; contracts/Treasury.sol:75-91 (setDevWallet/setAuthorized onlyOwner); contracts/BattleArena.sol:936-937, :599, :1023 (processFee with no try/catch; re-verified), :280 (treasury set once, no setter); contracts/EvolutionLab.sol:82, contracts/BreedingLab.sol:253, contracts/RepairShop.sol:105, contracts/Marketplace.sol:168; contracts/script/Deploy.s.sol:51 (deployer is lpAddress); contracts/test/GovernanceHandoff.t.sol:70-80.

**Suggested fix.** Have the Safe's acceptance batch run immediately after Handoff and gate the 'complete' message on owner() == safe via a separate verification script; pre-announce that handoff is incomplete until the OwnershipTransferred event. On mainnet add an LP_RECIPIENT env var that must differ from the deployer, or a scripted LP-seed step, so the deploy key never holds 12.5% of supply at rest. Rotate or destroy the deployer key after acceptance.

**Skeptic (code path): CONFIRMED, Low.** The mechanics hold, but only as an ops-window hardening issue; it is not exploitable by an unprivileged actor.

**Treasury ownership window**
- `GovernanceHandoff.execute` only calls `Ownable2Step(treasury).transferOwnership(safe)`. The script's post-checks assert `pendingOwner == safe`, never `owner == safe`.
- `deployerFullyDeprivileged` excludes Treasury by design. The script then logs "Governance handoff complete", followed by an "ACTION REQUIRED" line.
- Until the Safe calls `acceptOwnership()`, the deployer EOA is still `owner()`. OZ `transferOwnership` overwrites `_pendingOwner` unconditionally.
- A compromised deployer key can therefore re-point the pending owner to an attacker, accept from that address, and make the Safe's later accept revert.
- Treasury is plain `Ownable2Step`, and every consumer sets its treasury address once in the constructor with no setter. The Safe has no recovery path.
- The owner's `setAuthorized(arena, false)` makes every `treasury.processFee` call in BattleArena revert: the protocol-fee call in finalize, the dispute bond slash, and the anti-grief slash. None is wrapped in try/catch.
- BreedingLab, EvolutionLab, RepairShop and Marketplace fee paths revert the same way.
- The owner's `setDevWallet` redirects the 15% dev leg. `renounceOwnership` is also not overridden.

**125M LP allocation**
- `Deploy.s.sol:51` passes `deployer` as `lpAddress`, and `ClawToken` mints `LP_ALLOCATION` to it.
- `DeployHelpers` mainnet checks require only `TREASURY_RESERVE_ADDRESS` and `DEV_WALLET` to differ from the deployer; they do not constrain the LP recipient.
- `deploy.md` has no LP-seed step. I grepped it for LP, liquidity and `acceptOwnership` and found nothing.

**Why it stays Low**
- The two-step transfer is a deliberate and documented design. The contract NatSpec, the script log line and `admin-roles.md:52` all say the deployer keeps ownership until the Safe accepts.
- `admin-roles.md:60` lists `owner() == safe` and `pendingOwner() == 0` in the post-launch checklist.
- The attack needs the deployer key to be compromised inside the window between Handoff and the Safe's accept.
- The same key held every admin role minutes earlier, so the exposure is residual rather than new. It is unbounded in time only if operators skip the documented checklist.
- The real defects are that the "complete" message is misleading, nothing automated verifies the end state, the key holds 12.5% of supply at rest, and a takeover is unrecoverable if it happens.

*What limits it.* - The attack requires compromise of `DEPLOYER_PRIVATE_KEY`, which is a privileged key and not an unprivileged actor.
- It only works between the Handoff broadcast and the Safe's `acceptOwnership()`.
- `admin-roles.md` explicitly documents that the deployer retains ownership until the Safe accepts.
- The post-launch checklist includes `Treasury.owner() == safe` and `pendingOwner() == 0`, so a diligent operator closes the window quickly.
- Draw, cancel and refund paths that do not call `processFee` are unaffected by de-authorization.
- The LP allocation must sit with some key until the pool is seeded, so that part is an ops-hygiene issue.

### D-25

**The role matrix after Handoff contradicts the engine: season auto-rollover signs startSeason with the OPERATOR hot key, which no longer has -- and must never have -- SEASON_ADMIN_ROLE**

- Severity after verification: **Low** (claimed Low) · status **contested** · reported by: roles
- Location: apps/engine/src/seasons/manager.ts:137-155 versus contracts/script/Handoff.s.sol:39-40

**What goes wrong.** Plain language: the engine checks every 5 minutes whether the 60-day season has ended and then calls MiningPool.startSeason() itself using OPERATOR_PRIVATE_KEY. Handoff gives SEASON_ADMIN_ROLE only to the governance Safe, and role policy says it must stay on a multisig. On mainnet the auto-rollover will revert every time; the error is caught, logged and retried forever. Two outcomes, both bad: (1) mining halts on day 61 -- every startExpedition reverts SeasonNotActive until the multisig notices and submits startSeason by hand; (2) the path of least resistance -- someone 'fixes' the failing job by granting SEASON_ADMIN to the operator hot key, after which a single hot-key compromise gives setBaseReward (no upper bound) and startSeason with arbitrary numbers: the M-02 drain (set baseReward to the remaining budget and mint it to your own team in one expedition, up to the 705M lifetime cap), exactly what the runbook's multisig requirement exists to prevent. Nothing in the scripts, tests or runbooks flags the mismatch.

**Attack.** No attacker for the liveness failure. Preconditions: mainnet, after Handoff, day 60. checkAndRollover() calls simulate.startSeason from the operator account -> AccessControlUnauthorizedAccount; the catch block logs 'Season rollover failed' and loops. All miners lose 100% of emissions for as long as the gap lasts. If operators respond by granting the role to the hot key, a compromise of that key lets the attacker call setBaseReward(remainingBudget / weight), then startExpedition, then claim after 4 hours -- taking the season's entire remaining emission.

**Evidence.** apps/engine/src/seasons/manager.ts:104-155 (getOperatorClient then pool.simulate.startSeason); apps/engine/src/index.ts:104 (monitor wired in); contracts/script/Handoff.s.sol:39-40; contracts/MiningPool.sol:198 and :227-236 (onlyRole(SEASON_ADMIN_ROLE); setBaseReward has no upper bound); docs/runbooks/admin-roles.md:74-88.

**Suggested fix.** Decide on one model: either remove the engine's on-chain rollover and replace it with an alert N days before season end plus a pre-built Safe transaction; or make rollover permissionless and parameter-free on-chain (startNextSeason() derives emission from the halving schedule and the 705M cap, baseReward carried by the glide). Do not grant SEASON_ADMIN to a service key.

**Skeptic (code path): PLAUSIBLE, Low.** The mismatch the finding describes is real, but its impact is overstated. No funds are at risk, and the privileged-drain outcome depends on a future human mistake that the docs already forbid.

**What holds up in the code:**
- The engine starts a 5-minute monitor at boot that calls `checkAndRollover()`.
- Once the season row in the database is older than 60 days, the monitor calls `MiningPool.startSeason(emission, S1_BASE_REWARD)`. It signs with the wallet from `getOperatorClient`, which uses `OPERATOR_PRIVATE_KEY`.
- `startSeason` is `onlyRole(SEASON_ADMIN_ROLE)`.
- `Configure.s.sol` grants that role only to the deployer. `Handoff.s.sol` then moves it to the Safe and revokes it from the deployer. No script grants it to the operator.
- So after Handoff, the `simulate` call reverts with `AccessControlUnauthorizedAccount`. The catch block logs "Season rollover failed" and the loop retries every 5 minutes, forever.
- `startExpedition` reverts `SeasonNotActive` once `block.timestamp >= startTime + SEASON_DURATION`. Mining therefore stops until someone with the role calls `startSeason`.

**Why the impact is weaker than claimed:**
- The runbook already defines season rotation as a Safe transaction, so the governance model is coherent. The engine job is stale, contradictory code that fails harmlessly. It is not the designated rollover path.
- The liveness gap is an ops-scheduling risk: the multisig must submit `startSeason` on day 60. It is not a contract defect.
- The "someone grants SEASON_ADMIN to the hot key" outcome is speculative human error against an explicit written policy. It is not a code path.

**Real residual risks:**
- The failing job gives false assurance that rollover is automatic.
- It spams error logs.
- Its presence invites exactly the role grant the policy forbids.
- If the role were ever granted to the operator, the job would restart every season at `S1_BASE_REWARD` (1,250) regardless of halving. `startSeason` sets both `baseReward` and `launchBaseReward` from that argument, so the wrong value would also become the glide cap.

*What limits it.* - `onlyRole(SEASON_ADMIN_ROLE)` stops the engine call. That is the intended guard, and it means the contract side is safe.
- There is no attacker path. The liveness loss needs the multisig to miss the day-60 rotation, which the runbook already assigns to it.
- The drain scenario needs governance to deliberately violate its own written policy and then a hot-key compromise on top of that.
- The 705M lifetime cap still bounds any drain.

### D-26

**Mainnet hot-key separation checks leave out BOOST_ADMIN, ELIGIBILITY_OPERATOR and the Safe, while the server defaults every role to one shared OPERATOR key**

- Severity after verification: **Low** (claimed Low) · status **confirmed** · reported by: roles
- Location: contracts/script/DeployHelpers.s.sol:88-95

**What goes wrong.** Plain language: the deploy helper says it enforces 'no operational role may equal deployer or each other', but the pairwise checks cover only matchmaker, resolver and VRF operator. BOOST_ADMIN_ADDRESS is only required to differ from the deployer; ELIGIBILITY_OPERATOR and GOVERNANCE_SAFE are only required to differ from the deployer (in Handoff). Server-side, the boost signer, matchmaker and resolver all fall back to the same OPERATOR_PRIVATE_KEY when their own variable is unset (the shipped '0x' placeholder is explicitly treated as unset for the boost key), so the easiest mainnet configuration is BOOST_ADMIN_ADDRESS == resolver/matchmaker address, and the script accepts it. The runbook analyses each hot key's blast radius independently; with shared keys one compromise combines them -- propose battle results AND post up to +50% mining boosts for the same colluding teams, removing the cross-check between the two services. Nothing prevents GOVERNANCE_SAFE from being one of the hot addresses either.

**Attack.** Actor: an attacker who compromises the single server key holding both RESOLVER_ROLE and BOOST_ADMIN_ROLE. Sequence: settle self-play battles in favour of the attacker's own teams (anything undisputed is final), then setTeamBoosts(currentEpoch, own teams at 5000 bps) so those teams mine at 1.5x for up to 10 days. Who loses: honest miners lose emission share through glide compression; the per-key blast-radius analysis in admin-roles.md no longer holds.

**Evidence.** contracts/script/DeployHelpers.s.sol:88-95 (no boostAdmin vs matchmaker/resolver/VRF check); contracts/script/Handoff.s.sol:86-89; packages/chain/src/client.ts:51-82 (all three role signers fall back to OPERATOR_PRIVATE_KEY); docs/runbooks/boost-epoch.md:73; docs/runbooks/admin-roles.md:123-131.

**Suggested fix.** Add pairwise-distinct requires on mainnet across matchmaker, resolver, vrfOperator, boostAdmin and eligibilityOperator, and require governanceSafe is none of them. Make the server refuse the OPERATOR fallback when CHAIN_ENV is mainnet.

**Skeptic (code path): CONFIRMED, Low.** The gap is real and traced end to end at commit 7ca5451. It is a deploy-time hardening gap, not an exploit by itself.

**What the deploy scripts check**
- `_loadEnv` claims to enforce "no operational role may equal deployer or each other", but the only pairwise requires are matchmaker vs resolver, matchmaker vs VRF operator, and resolver vs VRF operator.
- `boostAdminAddress` is only required to be non-zero and different from the deployer.
- `Configure.s.sol` then grants `BOOST_ADMIN_ROLE` to that address. So `BOOST_ADMIN_ADDRESS` equal to `RESOLVER_ADDRESS` (or the matchmaker or VRF operator) passes every mainnet check.
- `Handoff.run()` only requires `GOVERNANCE_SAFE` and `ELIGIBILITY_OPERATOR` to be non-zero and different from the deployer. Nothing stops the Safe address from being one of the hot keys, or the eligibility operator from being the resolver.

**What the server does**
- `getBoostAdminClient` falls back to `OPERATOR_PRIVATE_KEY` when `BOOST_ADMIN_PRIVATE_KEY` is unset, and treats the shipped `0x` placeholder as unset.
- The resolver and matchmaker signers have the same fallback.
- Because matchmaker must differ from resolver on mainnet, a working mainnet setup already needs at least one dedicated key. The lowest-effort setup therefore has the boost signer share a key with whichever role still uses `OPERATOR_PRIVATE_KEY`, and the deploy script accepts that.
- `boost-epoch.md` recommends giving the boost role its own key only to avoid sharing a nonce, not as a security boundary.
- `admin-roles.md` analyses the boost key's blast radius on its own, without considering a shared key.

**Why this is Low and not higher**
- It needs an operator misconfiguration plus a key compromise. No unprivileged actor can trigger it.
- The combined blast radius stays bounded. Boosts are capped at +50% per team, bound to the team's Power, expire after the 10-day TTL, and are limited by the season budget and the 705M lifetime cap.
- A compromised resolver alone can already push ratings up through false settlements, which the honest boost service then turns into boosts. Sharing the key mainly removes the delay and the independent cross-check. It does not open a new fund-theft path.
- The Safe-equals-hot-key case is a pure operator error that the script does not catch.

*What limits it.* - The operator must actually configure shared addresses, and the attacker must then compromise that key.
- Matchmaker, resolver and VRF operator are forced to be distinct, so at most one of them can share a key with the boost admin through the fallback.
- Boost impact is capped: +50% per team, Power-bound, 10-day TTL, limited by the season budget and lifetime cap. Inflated boosts compress rewards for other miners rather than minting extra.
- False settlements remain disputable within the bonded dispute window.
- Every boost write emits an event and the ladder is published, so a divergence is publicly checkable.

### D-27

**No rules or engine version is committed or recorded, so after a balance patch an honest log no longer replays and the verification code can be chosen after the fact**

- Severity after verification: **Low** (claimed Low) · status **confirmed** · reported by: binding
- Location: packages/game-logic/src/v3/log.ts:6-22; packages/game-logic/src/v3/replay.ts:85-91

**What goes wrong.** Plain language: the per-turn state hash includes the tunable BattleRules object, but the rest of the rules live in code constants (base class stats, damage formula, speed clamps, stun immunity, crit formula, HP_BATTLE_SCALE) that the project documents as 'tunable from telemetry without contract redeploy'. Neither hash includes an engine or rules version; WIRE_VERSION is not hashed and battle_sessions has no version column. Consequences: if a balance patch ships while a battle is disputed (High bracket: 1-hour window plus 24-hour admin SLA) or later audited, verifyLog with current code fails at turn 1 for a perfectly honest log, and the admin cannot separate an honest log from a fabricated one without guessing the right git commit; and a dishonest operator can claim whichever historical constants make their log verify.

**Attack.** Scenario: (1) Player P loses a High-bracket battle honestly and disputes anyway, or the loss is real fraud. (2) Between settle and the admin's review a routine constants retune is deployed. (3) The admin's verifyLog reports a mismatch at the first attacking turn, in the honest and dishonest case alike. (4) The admin either overturns an honest result (refunding the bond and flipping a 50,000-CLAW outcome) or has to trust the operator's word about which commit was live. No committed value settles it.

**Evidence.** packages/game-logic/src/v3/log.ts:21 (only state.rules fields hashed); packages/game-logic/src/v3/replay.ts:85-91 (preimage has no version); packages/game-logic/src/v3/serialize.ts:12 (WIRE_VERSION not in any hash); packages/db/src/schema/battle-sessions.ts:22-49 (no version column); packages/game-logic/src/v3/sim.ts:59 (stats from code constants); .claude/CLAUDE.md 'Speed clamps + stun immunity' section.

**Suggested fix.** Put a rulesVersion (keccak of a frozen constants manifest plus package version or git SHA) in the turnLogHash preimage and in a battle_sessions column; keep old engine versions importable for replay.

**Skeptic (code path): CONFIRMED, Low.** Plain language: the claim holds as stated. Nothing committed on-chain or stored in the database records which version of the battle rules produced a result. Dispute replay therefore depends on someone knowing, from outside the evidence, which code was live.

What I checked:
- canonicalState hashes only the dynamic lobster fields and the `state.rules` object. Lobster stats and maxHp are not in the hash.
- The turnLogHash preimage is {battleId, vrfSeed, layout, roster, log}. The roster is reduced to id, class, tier, purity and legend. No stats and no version are included.
- Stats are derived at createBattle from code (getBaseStats, scaleStats, HP_BATTLE_SCALE).
- Speed clamps, stun immunity turns, distance multipliers, Mantis armor pierce, Inferno self-damage and similar values are bare constants in constants.ts. They are not part of BattleRules, so they are not hashed.
- The constants file shows retunes have already happened in-line: RALLY_HEAL_PCT went 30 to 25 on 2026-08-31 and REND_BLEED_PER_TURN went 40 to 55 on 2026-08-30. "A balance patch ships" is routine here.
- WIRE_VERSION appears only in serialize.ts (declared, used in a type, written to the wire object and checked on parse). It is not in any hash.
- battle_sessions has no version or commit column. A grep for rulesVersion, engineVersion and git SHA fields across game-logic, db and api returned nothing.
- The dispute runbook tells the admin to run `v3.verifyLog(config, log)` with no mention of pinning a commit.
- BattleArena stores the two hashes opaquely, so the contract cannot help.

A worse variant the finder did not mention: the schema comment says a restarted API resumes active battles from state_json. A deploy in the middle of a battle would produce a single log whose early turns ran under the old constants and later turns under the new ones. That log replays under no single commit at all.

Why it stays Low:
- An unprivileged actor cannot trigger it. It needs a deploy during the dispute window or a later audit.
- battle_sessions.createdAt and updatedAt, together with git and deploy history, let a diligent admin find the right commit.
- The operator who could "choose the constants" already holds the RESOLVER key and sits inside the accepted server-authoritative trust model.
- The impact is reduced evidentiary strength of the S1 dispute backstop, not direct loss of funds.
- It becomes a hard blocker for S2 on-chain replay.

*What limits it.* - It requires a constants deploy between the battle and the dispute review, or during the battle. No player can force that.
- The admin can recover the live commit from the session timestamps plus deploy and git history.
- The operator who benefits from the ambiguity already controls RESOLVER, which the docs accept as in scope for a lying hot key.
- There is no direct fund-theft path. The worst case is a wrongly decided dispute at the admin's discretion.

### D-28

**The settle job is enqueued non-atomically and never reconciled, so a lost enqueue or dead job turns a finished battle into a full refund after 3 hours and the winner loses the win**

- Severity after verification: **Low** (claimed Low) · status **confirmed** · reported by: binding
- Location: apps/api/src/lib/battle-session/manager.ts:382-383; contracts/BattleArena.sol:485,729-733

**What goes wrong.** Plain language: when a real battle ends, the API first marks the session row 'settling' and then, in a separate statement, inserts the settle_battle job. Failure case 1: the process dies or the second insert fails between the two statements (error only logged via onError); the session is no longer 'active' so resume() never reloads it, and no job exists; nothing scans for 'settling' sessions without a job. Failure case 2: the job exists but goes Dead -- transient RPC errors run through a 5s/30s/5min/1h backoff ladder (~65 minutes total) and then stop for good. In both cases the battle stays Active on-chain until ACTIVE_WINDOW (3 hours); after that anyone, including the loser, calls handleTimeout() for a mutual full refund and a late settle() reverts PhaseTimedOut. The contract behaves as designed ('a server failure never costs a stake'); the gap is the off-chain path having no reconciler.

**Attack.** Actor: the loser of a finished battle, opportunistically. Precondition: an API crash/restart/deploy or DB blip in the milliseconds between markFinished and enqueueSettle, or an RPC outage longer than ~65 minutes that kills the job. Sequence: the loser waits until reveal + 3h and calls handleTimeout(battleId) -> _cancelBattle(StaleBattle). Who loses: the winner forfeits net winnings of +2,000 / +8,000 / +40,000 CLAW; the loser recovers the full stake and takes no repair damage; the protocol loses the 10% fee.

**Evidence.** apps/api/src/lib/battle-session/manager.ts:382-383 (two separate awaits, no transaction), :303-304 (resume loads only status 'active'); apps/api/src/lib/battle-session/store.ts:80-82,93-98; apps/api/src/lib/battle-session/session.ts:365-368 (onFinished errors only logged); apps/engine/src/operator/types.ts:19-23 (backoff ladder, then Dead); contracts/BattleArena.sol:86 (ACTIVE_WINDOW = 3 hours; re-verified), :485, :729-733; grep for 'settling' across apps/api/src and apps/engine/src finds no reconciler.

**Suggested fix.** Do markFinished and enqueueSettle in one DB transaction; add a sweeper that re-enqueues settle for 'settling' sessions whose on-chain phase is still Active and revives Dead settle jobs while phaseDeadline has not passed; alarm well inside ACTIVE_WINDOW.

**Skeptic (code path): CONFIRMED, Low.** The defect is real and works as described. Nothing on the code path prevents it.

**What happens off-chain.** When a real battle finishes, `onFinished` first updates the session row to 'settling'. It then inserts the `settle_battle` job in a second, separate statement. The two statements are not in one DB transaction. `markFinished` is a plain update and `enqueueSettle` is a plain insert with onConflictDoNothing.

- **Lost enqueue.** If the process dies or the insert fails between the two statements, the error is only passed to `onError`. `resume()` reloads only rows with status 'active', so a 'settling' row is never picked up again.
- **No sweeper.** Outside tests, the only code that references 'settling' is the write in manager.ts, the status type in protocol.ts and the DB check constraint in the schema. Nothing scans for 'settling' sessions that lack a job. Nothing revives a Dead job.
- **Dead job.** The operator worker marks a job Dead after 5 attempts. The backoff ladder is 5s, 30s, 5min, 1h, about 65 minutes in total. The runbook covers a dead `settle_battle` job only as a manual diagnostic: check `operator_jobs`, and if the error is `revert:PhaseTimedOut`, anyone can call `handleTimeout` and both players are refunded.

**What happens on-chain.** `revealTeams` sets `phaseDeadline` to now plus `ACTIVE_WINDOW` (3 hours). `settle` reverts `PhaseTimedOut` once that deadline has passed. `handleTimeout` in the Active phase calls `_cancelBattle(StaleBattle)`, which refunds both players in full and records no winner.

**Who loses what.** The winner of a battle that really finished loses the net winnings. The loser gets the full stake back. The protocol loses its fee. I did not re-check the finder's CLAW amounts.

**Why Low.**
- The contract behaves exactly as designed ("a server failure never costs a stake").
- No one loses principal and nothing is locked.
- The loser cannot cause the failure. It needs a crash in a window of a few milliseconds, or an RPC or engine outage of more than 65 minutes. The loser can only take advantage of it afterwards.
- The window before the refund becomes callable is 3 hours, so manual repair of the job is possible if someone is alerted.

The gap is an off-chain operations issue, not a contract flaw.

*What limits it.* - Lost enqueue needs a crash or DB failure between two consecutive statements. That window is a few milliseconds.
- Dead job needs a settle failure that lasts longer than the ~65-minute retry ladder.
- The loser cannot cause either failure. They can only exploit it after `phaseDeadline` passes, 3 hours after reveal.
- No principal is lost. Both stakes and both anti-grief deposits are refunded.
- An operator has about 3 hours to re-insert or revive the job by hand, but nothing in the code alerts them.
- I did not find any automatic trigger that would fire during that window.

### D-16

**Dispute windows are pure wall-clock time, so a Base sequencer stall longer than the window removes the veto for battles settled just before it**

- Severity after verification: **Info** (claimed Low) · status **contested** · reported by: ba-dispute
- Location: contracts/BattleArena.sol:497 (payoutDeadline = now + window); :518 and :547 (boundary checks)

**What goes wrong.** Plain language: the Low bracket gives the loser 5 minutes to dispute, measured in block timestamps. If the sequencer stops including transactions for longer than the window, the deadline passes while nobody can transact (Base has had outages lasting tens of minutes). When blocks resume, disputeBattle reverts DisputeWindowClosed and anyone can finalize. This only matters if the settlement was wrong (resolver bug or compromise), so it is a hardening item, not an unprivileged exploit. The boundaries themselves are consistent: dispute while now <= deadline, finalize requires now > deadline; no overlap and no gap.

**Attack.** Actor: a compromised or buggy resolver; no action beyond timing. (1) Resolver settles battles with wrong results at time T. (2) The sequencer halts from ~T to beyond T + 5 min (a compromised resolver can simply settle when it observes degradation). (3) On resumption the victim's disputeBattle reverts at :518. (4) finalizeBattle succeeds at :547. Loss: the victim loses the stake (2,500 / 10,000 / 50,000 CLAW) with no recourse, because adminResolveDispute requires b.disputed (:569).

**Evidence.** contracts/BattleArena.sol:497, :518, :547, :569; :288-290 (window defaults 5 min / 30 min / 1 h; re-verified); :636 (minimum tunable window 60s).

**Suggested fix.** Give DEFAULT_ADMIN a bounded 'extend or freeze payoutDeadline' action for undisputed AwaitingFinalize battles for use during incidents (the same admin-freeze hook addresses D-05/D-06), or raise the minimum and Low-bracket windows.

**Skeptic (code path): PLAUSIBLE, Info.** Plain language: the code does what the finding says, but the failure story depends on chain behaviour that mostly does not hold on Base. The dispute deadline is fixed at settle time and only ever compared to block.timestamp. Nothing on-chain lets an admin extend or freeze an undisputed settlement. Once the deadline passes, a wrong settlement cannot be corrected. That part is confirmed.

Code path, each step checked:
- settle() sets payoutDeadline = block.timestamp + disputeWindows[bracket] (BattleArena.sol:496). Defaults are 5 min, 30 min and 1 h (:288-290). The tunable minimum is 60 s (:634).
- disputeBattle reverts DisputeWindowClosed when block.timestamp > payoutDeadline (:518).
- finalizeBattle (:547) and handleTimeout (:720-721, :735-736) pay out permissionlessly once block.timestamp > payoutDeadline and the battle is undisputed.
- adminResolveDispute requires b.disputed (:569), so an undisputed wrong settlement has no admin remedy.
- The only DEFAULT_ADMIN functions in BattleArena are propose/enactDisputeWindow and propose/enactDisputeBond. payoutDeadline is snapshotted at settle. No admin action can save an already-settled battle, and no contract is Pausable.
- The boundary checks are consistent: dispute uses <=, finalize uses >. There is no overlap and no gap.

Why I downgrade from Low to Info:
- The premise "the deadline passes while nobody can transact" is inaccurate for Base. I did not verify this from the repo; it is my knowledge of the OP Stack. L2 block timestamps are parent + 2 s with no gaps. During a full sequencer halt, block.timestamp stops. On resumption the sequencer produces catch-up blocks with contiguous old timestamps. The 5-minute window is therefore not consumed during the halt. It is compressed into the real-time duration of roughly 150 catch-up blocks, which is seconds to tens of seconds.
- A waiting victim agent that submits immediately can plausibly still land a dispute. It is racing anyone who calls finalizeBattle, and that call cannot succeed until a block with timestamp > deadline exists.
- The window is severely shortened in real time, not removed.
- The realistic variant is degraded inclusion, not a halt: RPC or ingress failure, or mempool congestion, while blocks keep advancing. That does burn the wall-clock window. It applies equally to any timestamp-based window and is generic.
- The precondition is a wrong settlement, meaning a buggy or compromised RESOLVER. The docs already accept that the resolver can propose wrong results, with the dispute window as the backstop. This finding is a conditional weakening of that backstop, not an unprivileged exploit. A compromised resolver cannot cause a sequencer stall; it can only time one opportunistically. The affected set is bounded to battles in Active phase that it can settle at that moment.
- Forced inclusion via L1 does not help within 5 minutes. The sequencer window is about 12 h.

Net: the structural observation stands. The specific sequencer-halt story is weaker than claimed, and impact needs a privileged fault plus a rare infrastructure event. This is a hardening or coverage note at Info, or borderline Low.

*What limits it.* - The attack requires a wrong settlement from a RESOLVER_ROLE holder. That is a hot key whose ability to lie is an accepted risk.
- It also requires a coincident Base inclusion failure longer than the window, which the attacker cannot cause.
- On OP Stack, block.timestamp does not advance during a full sequencer halt. Blocks are parent + 2 s, and catch-up blocks carry old timestamps. The window is compressed into the catch-up period, not skipped, so a prompt disputer can still get in.
- Only battles settled just before the incident are exposed.
- The Mid and High brackets have 30 min and 1 h windows. The highest-value bracket is the least exposed.

### D-29

**Protocol-wide invariant suite never exercises repair since the glide peg shipped**

- Severity after verification: **Info** (claimed Low) · status **confirmed** · reported by: tests-gap
- Location: contracts/test/invariant/InvariantProtocol.t.sol:183-203

**What goes wrong.** Plain language: the cross-contract invariant suite still lists repair as one of its actions, but every repair call now fails and the failure is silently swallowed. A test-suite problem, not a contract bug, but the green result on that suite no longer says anything about RepairShop. Cause: TOK-G1 made RepairShop price repairs from MiningPool.currentBaseReward(), which is 0 until a season has been started; BaseSetup.setUp() never calls startSeason and ProtocolHandler never does either, so repairRate() returns 0 and repair() reverts RewardPegUnset on every call, inside a try/catch. The per-contract suites (FuzzRepairShop, test/RepairShop.t.sol) work around this; the protocol harness was not updated. Two related weaknesses in the same file: invariant_season_budget_not_exceeded returns early when currentSeason == 0, which is always, so it can never fail; and setUp() calls targetContract(handler) with no targetSelector, so the fuzzer can call the handler's inherited public setUp() mid-run, redeploying every contract and orphaning mintedIds (the two newer harnesses filter selectors and document this exact hazard).

**Attack.** No on-chain actor. The cost is false assurance: a future regression in RepairShop.repair (the damage write, the Treasury routing, or an interaction with team lock or marketplace custody) would not be caught by the cross-contract harness; CI's 'forge-invariant' job would stay green.

**Evidence.** contracts/test/invariant/InvariantProtocol.t.sol:200 (try repairShop.repair(...) {} catch {}), :330-334 (early return when season == 0), :251-254 (no targetSelector); grep for startSeason|miningPool\. in that file returns only line 200's repairShop call; contracts/test/helpers/BaseSetup.t.sol:116-190 (no startSeason); contracts/RepairShop.sol:71-73, :94-95 (RewardPegUnset); contracts/MiningPool.sol:455-457; contracts/test/invariant/InvariantBattleArena.t.sol:24-26 (comment describing the setUp() hazard).

**Suggested fix.** Start a season in the ProtocolHandler constructor; add handler_startExpedition, handler_claim and handler_warp so the glide moves the repair price during runs; add a ghost counter of successful repairs and assert > 0 in an afterInvariant or reachability test; add targetSelector filtering like the other two harnesses.

**Skeptic (code path): CONFIRMED, Info.** Plain language: the claim holds. The cross-contract invariant harness never has a successful repair, so its green result says nothing about RepairShop. This is a test-coverage gap only. No on-chain actor is involved and no funds are at risk.

I traced the path step by step.

- **The price feed is zero.** `RepairShop.repair` takes its rate from `repairRate(tier)`, which is `miningPool.currentBaseReward() * bps / 10_000`. `currentBaseReward()` returns `_seasons[currentSeason].baseReward`. That value is 0 while `currentSeason == 0`.
- **No season is ever started.** Only `startSeason` increments `currentSeason`. The `ProtocolHandler` constructor calls `BaseSetup.setUp()`, funds the actors and mints lobsters. A grep for `startSeason` and `setBaseReward` in `BaseSetup.t.sol` and `InvariantProtocol.t.sol` returns nothing. No `handler_*` function touches `miningPool`.
- **The handler does reach the rate check.** `handler_evolve` can succeed because evolution costs are fixed constants, not tied to the glide. `handler_applyDamage` sets damage. So `handler_repair` can find a damaged lobster above Base tier, pass the damage and tier checks, then revert `RewardPegUnset` at `RepairShop.sol:95`. The `try/catch` at line 200 swallows that revert every time.
- **The file predates the peg.** `InvariantProtocol.t.sol` was last changed in c21ec58, before TOK-G1.

Both secondary points also hold.

- `invariant_season_budget_not_exceeded` returns early when `season == 0`. That is always the case here, so the invariant can never fail.
- `InvariantProtocol.setUp()` calls `targetContract(handler)` with no `targetSelector`. The inherited public `setUp()` is therefore fuzzable. The `InvariantBattleArena` harness documents and filters exactly this hazard.

I set severity to Info rather than Low. There is no contract defect and no exploit path. RepairShop is still covered by its own unit and fuzz suites. The severity rubric places coverage gaps under Info.

*What limits it.* This is not an attack. No on-chain actor can trigger it and no funds move. RepairShop keeps dedicated coverage in `FuzzRepairShop` and `test/RepairShop.t.sol`, which start a season. The only cost is false assurance from the cross-contract harness about repair interactions.

### D-30

**Glide re-peg (TOK-G1) has no fuzz or invariant test; four branches are untested**

- Severity after verification: **Info** (claimed Low) · status **confirmed** · reported by: tests-gap
- Location: contracts/MiningPool.sol:467-495

**What goes wrong.** Plain language: the daily reward glide now sets both mining income and repair prices, yet it is tested only by five hand-picked examples covering the -30% clamp and the launch cap. Branches no test executes: the upward step (target above old*1.3, reward should recover after a drop); the in-band case (next == target exactly); the last day of the season (remainingDays 0 floored to 1); the dust floor (next 0 set to 1). Also unasserted: a gap of several quiet epochs (stale epochWeightServed carried forward as trailing demand) and the division of boost-scaled demand (test_boostedExpeditionsCountAsScaledGlideDemand only covers a clean multiple). The MiningPool invariant handler reaches _repegIfNeeded only lazily through startExpedition and never calls the permissionless repeg(); no invariant constrains the glide (no +/-30% step bound, no 'never above launchBaseReward after a re-peg with demand', no 'reward non-zero'). RepairShop's peg input is never fuzzed (FuzzRepairShop fixes the base at 1,250e18; test/RepairShop.t.sol uses two mock values). Hand trace found no exploitable bug in the math (but see D-18/D-19 for design-level issues these tests would have surfaced). One unpinned edge: for baseReward <= 3 wei, hi = old*13000/10000 truncates back to old so the glide can never rise again -- reachable only via an admin dust value; natural decay from 1,250e18 cannot reach it within 60 days.

**Attack.** No unprivileged exploit found. The risk is an undetected regression: any later edit to the clamp, the cap or the day arithmetic changes every miner's reward and every repair price, and only the -30% and launch-cap examples would notice.

**Evidence.** test/MiningPool.t.sol:1094-1152 (the five glide tests); grep for repeg|glide across contracts/test/fuzz and contracts/test/invariant returns only a comment at MiningPoolHandler.sol:104; contracts/test/invariant/InvariantMiningPool.t.sol:21-30 (selector list has no repeg handler); contracts/MiningPool.sol:476, :480, :487, :490 (the untested branches); contracts/test/fuzz/FuzzRepairShop.t.sol:13-17; test/RepairShop.t.sol:292-311.

**Suggested fix.** Add a fuzz test over (budget, demand per epoch, days elapsed, prior base) asserting next within [0.7*old, 1.3*old], next between 1 and launchBaseReward whenever trailing > 0, and exact match with a reference model; add handler_repeg to the MiningPool handler; add an invariant comparing baseReward before/after each handler call against the step bound; fuzz the peg value in the RepairShop tests incl. values where cost falls below the Treasury 10_000-wei floor.

**Skeptic (code path): CONFIRMED, Info.** Plain language: the claim is true, but it describes missing tests, not a bug. I found no way for anyone to take or lock funds through the glide.

What the code does: MiningPool._repegIfNeeded (467-495) has the branches the finder lists: an in-band step, a clamp to old*0.7 or old*1.3, a cap at launchBaseReward, a remainingDays 0 to 1 floor, and a dust floor of 0 to 1. I traced each one and the arithmetic holds:
- The boost-scaled demand counter is divided back to plain units before use.
- When trailing demand is 0 the function returns before the division, so there is no divide-by-zero.
- elapsed cannot exceed SEASON_DURATION, because repeg() calls _requireActiveSeason (448-451).

What the tests cover: the glide tests in test/MiningPool.t.sol (1080-1152) use only hand-picked values. They hit the -30% clamp four times and the launch cap twice.
- test_glideNeverExceedsLaunchAfterAdminOverride does enter the target > hi arm (old 2,500, hi 3,250). The launch cap then overwrites the result, so a real upward recovery (next == hi below launch) is never asserted.
- No test has next == target.
- No test warps into the last day of the season.
- No test reaches next == 0.
- No test crosses several quiet epochs.
- The boost test asserts only a clean 6 x 1.5 = 9, never a division that truncates.

What the fuzz and invariant suites cover: a case-insensitive grep for repeg|glide|trailing across contracts/test (fuzz, invariant, handlers) returns nothing.
- The invariant selector list has 8 handlers and none calls repeg().
- The handler reaches the re-peg only lazily through startExpedition, and records a max-base ghost value.
- No invariant bounds the step size, requires a non-zero reward, or enforces the launch cap.
- FuzzRepairShop fixes the peg at 1,250e18.
- RepairShop.t.sol sets the mock peg only to 625e18 and to 0.

Dust edge verified: old = 3 gives hi = 39000/10000 = 3, so the reward is stuck. old = 4 gives 5.

Small overstatements by the finder:
- testFuzz at test/MiningPool.t.sol ~760-788 does drive the glide across epochs, but it asserts only minted <= n x launch and minted <= emission.
- The cited "comment at MiningPoolHandler.sol:104" does mention the lazy re-peg but does not contain the words repeg or glide.

Severity: I set Info rather than the finder's Low. Under the audit's own rubric, coverage gaps with no concrete failure story are Info.

*What limits it.* Nothing to block: there is no attack. The dust-stuck edge (baseReward <= 3 wei) can only be reached through SEASON_ADMIN setBaseReward or a startSeason dust value. SEASON_ADMIN can also override it back out with setBaseReward.

### D-31

**Power binding and team-contention reverts in the rewritten revealTeams are never tested**

- Severity after verification: **Info** (claimed Low) · status **confirmed** · reported by: tests-gap
- Location: contracts/BattleArena.sol:434-437 (TeamPowerChanged); :322-323 (InvalidPowerScore); :867,:870 (TeamAlreadyInBattle)

**What goes wrong.** Plain language: the anti-smurfing check says the team revealed must have the same Power the matchmaker recorded. The atomic reveal rewrite carried that check over, but not one test makes it fail. Every unit test, fuzz test and invariant handler creates battles with power 3/3 and three Evolved lobsters, so TeamPowerChanged, InvalidPowerScore, and TeamAlreadyInBattle during the atomic reveal (same team committed to two concurrent battles, or a team that started mining between commit and reveal) are never exercised. The handler mints a fresh team per battle, so team contention can never occur in the invariant run. The mining boost relies on the same Power concept, so this is the only on-chain defence against queueing in one band and fighting in another. The code path was read and is correct (both teams validated before any write; comparison against the createBattle snapshot); the gap is coverage only.

**Attack.** No exploit against the current code. Regression story: revealTeams deliberately validates both teams before writing teamInBattle. If someone reorders it so team A is locked before team B is validated, or swaps the powerA/powerB comparison, no test fails, and a Power-7 team can be revealed into a Power-3 battle.

**Evidence.** grep -rni 'PowerChanged|AlreadyInBattle|InvalidPower' over test/ and contracts/test/ returns zero test hits (only the F-04 comment at contracts/test/invariant/handlers/BattleArenaHandler.sol:97); contracts/test/fuzz/FuzzBattleArena.t.sol:17-21 (_createBattle hard-coded to 3,3); contracts/test/invariant/handlers/BattleArenaHandler.sol:99 (createBattle(...,3,3)), :61-76 (fresh team per battle); contracts/BattleArena.sol:428-448 (reveal ordering).

**Suggested fix.** Add unit tests: an Elite lobster swapped in after createBattle -> TeamPowerChanged for each side; power 2 and power 10 -> InvalidPowerScore; one team committed to two battles -> second reveal reverts TeamAlreadyInBattle and the battle cancels cleanly; team starts mining between commit and reveal. In the handler, reuse a small pool of teams across battles and occasionally evolve a lobster between commit and reveal.

**Skeptic (code path): CONFIRMED, Info.** Plain language: the claim is a test-coverage gap, not an exploit, and it holds. The atomic reveal checks both teams (ownership, not already in a battle, not mining, tier, damage) and compares each team's live Power to the matchmaker's snapshot before writing anything. The code is correct, but no Solidity test ever makes those checks fail.

What I verified:
- TeamPowerChanged, InvalidPowerScore and TeamAlreadyInBattle appear only in contracts/BattleArena.sol. There are zero hits in the root test/ directory (the unit suites BattleArena.t.sol and BoundaryTests.t.sol) or in contracts/test/ (fuzz, invariant, handlers). The only other mentions are TypeScript error-classifier tests in apps/engine, which mock the revert name and never run the contract.
- Every direct createBattle call in every Solidity test passes power 3,3 — all 17 call sites. Every fixture sets tier 1 (Evolved) only.
- The invariant handler mints three fresh lobsters and a new team for each battle, so team contention cannot happen in the invariant run.
- test_boundary_allThreeStakeBracketsCreateBattle creates three concurrent battles for the same two players but never reveals a team, so it does not exercise contention either.

One correction to the finder's evidence: the unit tests live in the repo-root test/ directory, not only in contracts/test/. The conclusion is unchanged because that directory has no hits either.

Severity: I rate it Info rather than Low. There is no actor, no call sequence and no loss against the current code. The rubric puts coverage gaps under Info; Low requires a concrete failure story, and the only one offered here is a hypothetical future refactor.

The finding is still worth acting on. F-04 Power binding is the only on-chain anti-smurfing control, the mining boost is keyed to Power, and revealTeams was rewritten in abe14d4 without any negative test.

*What limits it.* There is no attack. The current code validates both teams before any state write and compares against the createBattle snapshot, so a Power-7 team cannot be revealed into a Power-3 battle today. The risk is a future regression only. The off-chain engine classifies these reverts as dead jobs (apps/engine/src/operator/errors.ts:22-26), but that is tested with mocks, not against the contract.


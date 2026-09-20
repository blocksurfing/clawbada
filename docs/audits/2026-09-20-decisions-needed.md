# Post-June delta audit — decisions needed

Status on 2026-09-20. Every finding that could be fixed without changing how the game works has a fix: PRs #97–#106 are open, and five more branches are ready locally and open as PRs once those merge (see "Where everything is" at the end). What is left below changes game rules, the contract interface players sign against, or who holds which power. Those are your calls. Each item gives the plain meaning, the choice, and a recommendation.

The contracts are not upgradeable. Whatever is decided here has to be in before the mainnet deploy.

---

## 1. What a dispute is allowed to freeze (D-04, Medium)

**Meaning.** Anyone in a battle, including the player who won, can file a dispute for 250 CLAW at the Low stake. Until the Safe acts (24 h by policy, no limit on-chain) the opponent's payout is frozen — and so is their **team**: it cannot mine, battle, be disbanded, evolved or sold, because battles and mining share one "team is busy" flag. A three-Apex team loses about 187,500 CLAW of mining a day. The bond scales with the stake; the damage scales with the team. That is up to 750x leverage, per wallet, five times a day.

**Choice.**
- **A (recommended). A dispute freezes the money, not the team.** Release both teams when the result is proposed (apply the damage then), and keep only the stakes in escrow while disputed. Add a long-stop: after 72 h disputed with no admin action, anyone can finalize the proposed result and the bond is slashed. This removes the lever completely and also closes the "admin never shows up" trap.
- B. Keep the lock; make the bond scale with the locked team's Power and pay part of a slashed bond to the victim. Smaller change, still leaves a day of lock-out as a purchasable attack.
- C. Forbid the proposed winner from disputing. Cheap, but the loser can still do it.

## 2. The five-disputes-a-day cap can silence an honest player (D-05, Medium)

**Meaning.** The cap counts every dispute, including ones the admin upholds. If the resolver key is stolen (or the engine has a bug) and mis-settles one busy agent more than five times in a day, battles six onward cannot be contested at all and pay out the thief.

**Choice.**
- **A (recommended). Give the slot back when a dispute is upheld, and let an over-quota dispute through at double the bond instead of rejecting it.** Spam stays expensive (a frivolous dispute loses a growing bond); an honest player can always veto.
- B. Only count disputes that were slashed. Simpler, but then nothing limits in-flight spam except the bond.

## 3. A bond-free emergency freeze (D-06 on-chain half and D-16)

**Meaning.** The off-chain defences now in PRs notice a rogue settlement, alert both players and refuse to help. They cannot stop a payout if no player disputes in time, and a Base sequencer stall longer than the 5-minute window removes the veto entirely.

**Choice.**
- **A (recommended). Add `flagBattle(battleId)`: a bond-free freeze of an undisputed result, callable by the Safe and by a new GUARDIAN role.** The engine holds GUARDIAN and flags automatically when it sees a result it did not compute. A stolen guardian key can only delay payouts until the Safe resolves them; it cannot move money.
- B. Safe only. No new key, but a 3-of-5 Safe cannot act inside five minutes, so it only helps the longer windows.
- C. Nothing on-chain; rely on players disputing.

## 4. Is the 5% anti-grief deposit meant to do anything? (D-13, D-14, D-15)

**Meaning.** Today it never punishes a deliberate griefer and only ever punishes an honest slow player. Committing garbage instead of a team is free (the reveal times out as a no-fault cancel). Stalling every turn to 59 seconds is free (a timeout forfeit settles as an ordinary loss; the deposit comes back). The only slash left is "did not commit within 30 seconds of the second deposit" — a clock the *opponent* starts, which an honest human on a smart wallet can miss.

**Choice.**
- **A (recommended). Make it real.** (1) Commit the team hash inside `deposit()`, so the opponent-controlled 30-second clock disappears. (2) Let the resolver attribute a reveal failure to the player whose commit does not open, with a short grace period for that player to open it themselves. (3) Add a forfeiter field to `settle()` so three timeouts or a resign actually costs the 5%, and make it disputable like the rest of the result.
- B. Drop the deposit and the commit-timeout slash, fix the docs. Honest, simpler, and leaves stalling free.

## 5. Bind what a player agrees to when they deposit (D-08 on-chain half)

**Meaning.** `deposit(battleId)` says nothing about the stake, the opponent or the opponent's Power. A stolen matchmaker key can create a 50,000-stake battle against its own Apex team and hope the victim deposits. The API now refuses to build that deposit, but an agent that builds its own transactions has no protection.

**Choice.**
- **A (recommended). `deposit(battleId, expectedStake, maxOpponentPower)`, reverting on mismatch.** Small, and it fits with item 4's change to `deposit()`.
- B. Signed queue intents checked in `createBattle`. Stronger, much more work.

## 6. Signed turns (D-12, the remaining half)

**Meaning.** A log now says which Defends the shot clock chose and why a battle was forfeited, and anyone can replay it. It still cannot prove a player *sent* a move the server says timed out, or that a resignation was really theirs.

**Choice.**
- **A (recommended). One wallet signature at battle start authorises a per-battle session key; the client signs each command with it and the signature goes into the hashed log.** No wallet popup per turn.
- B. Sign every turn with the wallet. Unplayable for humans.
- C. Accept the limit for Season 1 and say so in the docs (it already does).

## 7. Draws (D-03)

**Meaning.** A draw pays no protocol fee, refunds both stakes and still counts as a battle *played* for the mining boost. Two colluding wallets can farm boost qualification with mutual passivity at almost no cost.

**Choice.**
- **A (recommended). Draws do not count toward boost qualification, and a draw pays half the normal fee from each side.** A draw is then never cheaper than a real battle.
- B. Only stop counting them. Leaves free draws as a way to dodge fees and damage.

## 8. Who starts each new season (D-25)

**Meaning.** The engine tries to start the next season with a hot key that, after the governance handoff, will not have that right — and must not. On day 61 mining stops until the Safe acts.

**Choice.**
- **A (recommended). Make rollover permissionless and parameter-free on-chain:** `startNextSeason()` derives the emission from the halving schedule and the 705M cap. Nobody holds a key that can choose season numbers.
- B. Keep it a Safe transaction; the engine only alerts several days ahead and prepares the transaction.

## 9. Glide economics (D-19 a, b, d)

Not security. Three modelling questions about the reward glide: the clamp is asymmetric in effect (a 30% drop needs a 43% rise to undo), the first day of a season has no demand signal, and the simulation that validated the glide should be re-run against the on-chain controller at 15,000–30,000 teams. **Recommendation:** re-run the simulation before launch and decide from the numbers; no contract change is proposed yet.

---

## Where everything is

**Open PRs, all green, merge in this order** (verified to merge cleanly one after another, and the combined tree passes typecheck, every test suite, forge and the end-to-end harness):

| PR | Finding(s) |
|---|---|
| #96 | this report |
| #97 | D-01 battle randomness |
| #98 | D-02 faucet lobster cap |
| #99 | D-09, D-18, D-20, D-19(c) MiningPool |
| #100 | D-07 battle read leak, C-01 (first half) |
| #101 | C-01 login signature |
| #102 | D-21, D-22 breeding keeper, plus the broken breed endpoint |
| #103 | D-11, D-23, D-24, D-26 deploy scripts |
| #104 | D-29 invariant suite |
| #105 | D-17 queued team binding |
| #106 | D-28 lost settlement |

**Ready locally, opened as PRs once the above are merged** (they touch the same files, and stacked PRs get auto-closed by squash merges):

| Branch | Finding(s) |
|---|---|
| `wave2/d31-reveal-binding-tests` | D-31 |
| `wave2/d30-glide-fuzz` | D-30 |
| `wave2/rogue-proposal-detection` | D-06 and D-08, off-chain halves; the missing dispute route and button; incident drill |
| `wave2/log-integrity` (after the one above) | D-27, D-12 (checkable half) |
| `wave2/d10-faucet-two-step` | D-10 |

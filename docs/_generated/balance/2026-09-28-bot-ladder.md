# Bot ladder — 2026-09-28 (deep upgraded: focus fire + cover)

`bun run styles -- --n 150 --tier elite` (packages/game-logic): every practice bot against every
other, 300 mirrored battles per pairing, varied purity. Drives the order and difficulty labels in
`apps/web/src/lib/bot-catalog.ts`. Supersedes 2026-09-25-bot-ladder.md.

## What changed and why

The 2026-09-25 ladder had the naive `focus` script on top (68.9), beating the 2-ply `deep` 62–38.
`bun scripts/focus-probe.ts --n 300` (600 battles per cell) separated rules from bots:

| vs focus | win % |
|---|---|
| balanced | 36.5 |
| old deep (2-ply, no team play) | 39.5 |
| guard (balanced + cover only) | 34.2 |
| deep + focus fire | 50.8 |
| balanced + focus fire + cover | 52.8 |
| **deep + focus fire + cover (shipped as `deep`)** | **53.5** |

- Focus fire is simply correct play: the shipped bots spread damage one lobster at a time, so a
  script that kills one enemy early plays 3v2 for the rest of the fight.
- Thinking still pays on top of it: the new `deep` beats focus, the old deep 66–34 and balanced 74–26.
- Cover alone (Defend/step back the victim, Rally, Fortify, body-block) does not beat focus fire. The
  one place the rules may lack counterplay — a taunt/intercept mechanic is on the post-beta list.
- Raising the focus-falloff rule barely moves it (focus vs balanced 65.9 → 57.0 at 3× today's 10 %/hit)
  and the 2026-09-21 sweep showed it widens the class spread. Rules unchanged.

## Average win % against the other seven

| Bot | Avg | Difficulty | was (09-25) |
|---|---|---|---|
| charger | 24.1 | Easy | 24.3 |
| greedy | 30.3 | Easy | 32.0 |
| cautious | 34.9 | Easy | 36.6 |
| balanced | 53.3 | Medium | 55.7 |
| aggressive | 54.0 | Medium | 56.1 |
| roles | 58.7 | Medium | 60.1 |
| focus | 67.0 | Hard | 68.9 |
| **deep** | **77.1** | Hard | 65.6 |

Head to head deep and focus are close (51–49 here, 53.5 % in the 600-battle probe): deep is the
strongest overall because it also crushes everything else.

# Strategy styles — tier=elite, 300 battles per cell

## Style vs style (row win % vs column, mirrored teams)
| | aggressive | balanced | cautious | charger | focus | roles | deep | greedy |
|---|---|---|---|---|---|---|---|---|
| aggressive |  50 |  50 |  74 |  83 |  37 |  48 |  22 |  64 |
| balanced |  50 |  50 |  66 |  81 |  35 |  48 |  24 |  69 |
| cautious |  25 |  33 |  50 |  58 |  19 |  31 |  12 |  66 |
| charger |  17 |  19 |  42 |  50 |  15 |  14 |  11 |  51 |
| focus |  63 |  65 |  81 |  85 |  50 |  53 |  49 |  73 |
| roles |  52 |  52 |  68 |  86 |  47 |  50 |  32 |  74 |
| deep |  78 |  76 |  88 |  89 |  51 |  68 |  50 |  90 |
| greedy |  36 |  31 |  34 |  48 |  27 |  26 |  10 |  50 |

## Which style suits each class (team containing the class plays the style vs a balanced opponent)
| Class | aggressive | balanced | cautious | charger | focus | roles | deep | best |
|---|---|---|---|---|---|---|---|---|
| Bulwark |  43 |  50 |  35 |   7 |  51 |  64 |  70 | deep |
| Mantis |  43 |  50 |  48 |  29 |  61 |  42 |  69 | deep |
| Leviathan |  43 |  50 |  42 |  26 |  53 |  59 |  64 | deep |
| Tempest |  44 |  50 |  39 |  25 |  51 |  52 |  71 | deep |
| Specter |  53 |  50 |  27 |  13 |  69 |  45 |  77 | deep |
| Sentinel |  49 |  50 |  31 |  19 |  62 |  32 |  69 | deep |
| Reaver |  50 |  50 |  27 |  25 |  62 |  55 |  74 | deep |
| Abyss |  51 |  50 |  30 |  21 |  72 |  48 |  81 | deep |
| Kraken |  53 |  50 |  10 |   9 |  71 |  50 |  81 | deep |
| Ember |  44 |  50 |  30 |  17 |  56 |  54 |  57 | deep |

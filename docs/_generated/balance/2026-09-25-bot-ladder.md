# Bot ladder — 2026-09-25 (current rules: #114 depth levers on)

`bun run styles -- --n 150 --tier elite` (packages/game-logic): every practice bot against every
other, 300 mirrored battles per pairing, varied purity. Drives the order and difficulty labels in
`apps/web/src/lib/bot-catalog.ts`. `cautious` was missing from the script before this run.

## Average win % against the other seven

| Bot | Avg | Difficulty |
|---|---|---|
| charger | 24.3 | Easy |
| greedy | 32.0 | Easy |
| cautious | 36.6 | Easy |
| balanced | 55.7 | Medium |
| aggressive | 56.1 | Medium |
| roles | 60.1 | Medium |
| deep | 65.6 | Hard |
| focus | 68.9 | Hard |

**Open balance question (not changed here):** naive focus-fire is the strongest bot, beating the
2-ply `deep` 62–38 and `balanced` 65–35. The #114 report measured focus vs balanced at 56.9%
(different team/purity setup). A dominant strategy conflicts with the design principle; worth a
dedicated look before the V1 rules freeze.

# Strategy styles — tier=elite, 300 battles per cell

## Style vs style (row win % vs column, mirrored teams)
| | aggressive | balanced | cautious | charger | focus | roles | deep | greedy |
|---|---|---|---|---|---|---|---|---|
| aggressive |  50 |  50 |  74 |  83 |  37 |  48 |  37 |  64 |
| balanced |  50 |  50 |  66 |  81 |  35 |  48 |  41 |  69 |
| cautious |  25 |  33 |  50 |  58 |  19 |  31 |  24 |  66 |
| charger |  17 |  19 |  42 |  50 |  15 |  14 |  12 |  51 |
| focus |  63 |  65 |  81 |  85 |  50 |  53 |  62 |  73 |
| roles |  52 |  52 |  68 |  86 |  47 |  50 |  42 |  74 |
| deep |  63 |  59 |  76 |  88 |  38 |  58 |  50 |  77 |
| greedy |  36 |  31 |  34 |  48 |  27 |  26 |  22 |  50 |

## Which style suits each class (team containing the class plays the style vs a balanced opponent)
| Class | aggressive | balanced | cautious | charger | focus | roles | deep | best |
|---|---|---|---|---|---|---|---|---|
| Bulwark |  43 |  50 |  35 |   7 |  51 |  64 |  53 | roles |
| Mantis |  43 |  50 |  48 |  29 |  61 |  42 |  55 | focus |
| Leviathan |  43 |  50 |  42 |  26 |  53 |  59 |  59 | roles |
| Tempest |  44 |  50 |  39 |  25 |  51 |  52 |  49 | roles |
| Specter |  53 |  50 |  27 |  13 |  69 |  45 |  59 | focus |
| Sentinel |  49 |  50 |  31 |  19 |  62 |  32 |  51 | focus |
| Reaver |  50 |  50 |  27 |  25 |  62 |  55 |  63 | deep |
| Abyss |  51 |  50 |  30 |  21 |  72 |  48 |  59 | focus |
| Kraken |  53 |  50 |  10 |   9 |  71 |  50 |  51 | focus |
| Ember |  44 |  50 |  30 |  17 |  56 |  54 |  61 | deep |

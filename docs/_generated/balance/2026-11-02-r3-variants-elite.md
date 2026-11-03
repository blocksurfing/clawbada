# Strong-play balance — tier=elite, n=1000 battles per config × pilot (8 processes)

Targets: every class 45–55 % and spread ≤ 12pp under the planner · 100-turn cap ≤ 3 % · median 40–55 turns · under balanced no class outside 42–58 %.

## pkgB_focus40

| Pilot | median turns (p10–p90) | 100-turn cap | draws | class spread | strongest | weakest | verdict |
|---|---|---|---|---|---|---|---|
| planner | 60 (46–81) | 1.4% | 0 | 17.1pp | Tempest 58.4 | Sentinel 41.2 | misses targets |
| deep | 53 (40–70) | 0.1% | 0 | 13.5pp | Leviathan 55.7 | Mantis 42.3 | second pilot |
| balanced | 50 (39–67) | 0.4% | 0 | 24.8pp | Leviathan 60.9 | Mantis 36.1 | misses targets |

| Class | planner win % | deep win % | balanced win % |
|---|---|---|---|
| Bulwark | 47.2 ± 2.0 | 51.8 ± 2.0 | 54.3 ± 2.0 |
| Mantis | 51.7 ± 2.0 | 42.3 ± 2.0 | 36.1 ± 2.0 |
| Leviathan | 43.8 ± 2.0 | 55.7 ± 2.0 | 60.9 ± 2.0 |
| Tempest | 58.4 ± 2.0 | 51.9 ± 2.0 | 52.1 ± 2.0 |
| Specter | 52.1 ± 2.0 | 49.6 ± 2.0 | 43.6 ± 2.0 |
| Sentinel | 41.2 ± 2.0 | 48.1 ± 2.0 | 52.4 ± 2.0 |
| Reaver | 53.3 ± 2.0 | 48.2 ± 2.0 | 50.1 ± 2.0 |
| Abyss | 51.3 ± 2.0 | 52.0 ± 2.0 | 53.0 ± 2.0 |
| Kraken | 47.6 ± 2.0 | 49.6 ± 2.0 | 42.7 ± 2.0 |
| Ember | 53.4 ± 2.0 | 50.7 ± 2.0 | 54.7 ± 2.0 |

### Why — per lobster, per battle (planner)
| Class | turns | damage dealt | damage taken | kills | Specials | stuns landed | survives | lands the first hit |
|---|---|---|---|---|---|---|---|---|
| Bulwark | 11.3 | 659 | 678 | 0.69 | 1.73 | 0.00 | 47.2% | 2.8% of battles |
| Mantis | 7.7 | 675 | 591 | 0.53 | 1.16 | 0.00 | 15.5% | 8.9% of battles |
| Leviathan | 9.6 | 834 | 915 | 0.77 | 1.15 | 0.00 | 38.1% | 3.4% of battles |
| Tempest | 8.7 | 779 | 565 | 0.63 | 1.55 | 0.00 | 35.2% | 15.7% of battles |
| Specter | 12.0 | 572 | 511 | 0.57 | 2.32 | 0.00 | 34.6% | 27.6% of battles |
| Sentinel | 12.4 | 394 | 1010 | 0.53 | 2.64 | 0.00 | 37.6% | 5.6% of battles |
| Reaver | 10.5 | 564 | 560 | 0.41 | 2.18 | 0.00 | 36.6% | 15.1% of battles |
| Abyss | 10.4 | 880 | 750 | 0.82 | 1.68 | 0.00 | 43.1% | 10.8% of battles |
| Kraken | 11.7 | 614 | 771 | 0.67 | 2.46 | 2.39 | 38.9% | 9.6% of battles |
| Ember | 6.0 | 431 | 656 | 0.49 | 0.90 | 0.00 | 9.8% | 0.5% of battles |

### The 14 battles that hit the cap (planner)
HP gap at the cap 21.3 points on average · last damage on average 0.7 turns before the cap · both teams above 50 % HP in 0 of them (a standoff, not a slow grind).

## pkgB_focus50

| Pilot | median turns (p10–p90) | 100-turn cap | draws | class spread | strongest | weakest | verdict |
|---|---|---|---|---|---|---|---|
| planner | 59 (45–80) | 0.8% | 0 | 20.0pp | Tempest 57.9 | Sentinel 37.9 | misses targets |
| deep | 53 (41–70) | 0.3% | 0 | 10.1pp | Leviathan 54.2 | Mantis 44.1 | second pilot |
| balanced | 51 (39–67) | 0.6% | 0 | 24.5pp | Leviathan 59.6 | Mantis 35.1 | misses targets |

| Class | planner win % | deep win % | balanced win % |
|---|---|---|---|
| Bulwark | 44.2 ± 2.0 | 51.5 ± 2.0 | 55.6 ± 2.0 |
| Mantis | 57.7 ± 2.0 | 44.1 ± 2.0 | 35.1 ± 2.0 |
| Leviathan | 39.3 ± 2.0 | 54.2 ± 2.0 | 59.6 ± 2.0 |
| Tempest | 57.9 ± 2.0 | 51.4 ± 2.0 | 53.6 ± 2.0 |
| Specter | 56.2 ± 2.0 | 49.8 ± 2.0 | 44.6 ± 2.0 |
| Sentinel | 37.9 ± 2.0 | 49.6 ± 2.0 | 51.4 ± 2.0 |
| Reaver | 54.4 ± 2.0 | 47.7 ± 2.0 | 49.4 ± 2.0 |
| Abyss | 51.3 ± 2.0 | 50.5 ± 2.0 | 53.7 ± 2.0 |
| Kraken | 48.1 ± 2.0 | 52.6 ± 2.0 | 40.7 ± 2.0 |
| Ember | 52.9 ± 2.0 | 48.6 ± 2.0 | 56.2 ± 2.0 |

### Why — per lobster, per battle (planner)
| Class | turns | damage dealt | damage taken | kills | Specials | stuns landed | survives | lands the first hit |
|---|---|---|---|---|---|---|---|---|
| Bulwark | 11.2 | 658 | 726 | 0.67 | 1.71 | 0.00 | 42.7% | 3.6% of battles |
| Mantis | 8.0 | 761 | 581 | 0.63 | 1.26 | 0.00 | 18.1% | 6.8% of battles |
| Leviathan | 9.5 | 829 | 911 | 0.71 | 1.10 | 0.00 | 36.9% | 5.4% of battles |
| Tempest | 8.2 | 783 | 570 | 0.59 | 1.49 | 0.00 | 34.3% | 14.6% of battles |
| Specter | 12.0 | 593 | 494 | 0.59 | 2.28 | 0.00 | 38.8% | 29.7% of battles |
| Sentinel | 12.2 | 376 | 1050 | 0.54 | 2.61 | 0.00 | 34.7% | 6.2% of battles |
| Reaver | 10.1 | 570 | 561 | 0.42 | 2.07 | 0.00 | 36.4% | 12.6% of battles |
| Abyss | 10.5 | 893 | 758 | 0.87 | 1.64 | 0.00 | 43.1% | 10.0% of battles |
| Kraken | 11.4 | 584 | 749 | 0.57 | 2.43 | 2.36 | 40.5% | 11.0% of battles |
| Ember | 5.8 | 450 | 651 | 0.56 | 0.94 | 0.00 | 11.8% | 0.1% of battles |

### The 8 battles that hit the cap (planner)
HP gap at the cap 27.1 points on average · last damage on average 0.3 turns before the cap · both teams above 50 % HP in 0 of them (a standoff, not a slow grind).

## pkgB_ramp30

| Pilot | median turns (p10–p90) | 100-turn cap | draws | class spread | strongest | weakest | verdict |
|---|---|---|---|---|---|---|---|
| planner | 59 (47–77) | 0.7% | 0 | 11.2pp | Specter 55.6 | Sentinel 44.4 | misses targets |
| deep | 49 (39–62) | 0.2% | 0 | 12.5pp | Leviathan 54.7 | Mantis 42.3 | second pilot |
| balanced | 47 (38–60) | 0.1% | 0 | 19.8pp | Leviathan 57.6 | Mantis 37.8 | misses targets |

| Class | planner win % | deep win % | balanced win % |
|---|---|---|---|
| Bulwark | 47.3 ± 2.0 | 53.7 ± 2.0 | 56.3 ± 2.0 |
| Mantis | 51.9 ± 2.0 | 42.3 ± 2.0 | 37.8 ± 2.0 |
| Leviathan | 47.9 ± 2.0 | 54.7 ± 2.0 | 57.6 ± 2.0 |
| Tempest | 51.9 ± 2.0 | 53.1 ± 2.0 | 52.7 ± 2.0 |
| Specter | 55.6 ± 2.0 | 49.3 ± 2.0 | 44.9 ± 2.0 |
| Sentinel | 44.4 ± 2.0 | 46.4 ± 2.0 | 53.1 ± 2.0 |
| Reaver | 49.9 ± 2.0 | 50.4 ± 2.0 | 47.1 ± 2.0 |
| Abyss | 49.7 ± 2.0 | 51.5 ± 2.0 | 55.5 ± 2.0 |
| Kraken | 52.4 ± 2.0 | 49.2 ± 2.0 | 43.2 ± 2.0 |
| Ember | 48.9 ± 2.0 | 49.4 ± 2.0 | 51.7 ± 2.0 |

### Why — per lobster, per battle (planner)
| Class | turns | damage dealt | damage taken | kills | Specials | stuns landed | survives | lands the first hit |
|---|---|---|---|---|---|---|---|---|
| Bulwark | 11.3 | 759 | 691 | 0.75 | 1.59 | 0.00 | 46.2% | 0.2% of battles |
| Mantis | 7.5 | 596 | 571 | 0.50 | 1.07 | 0.00 | 15.1% | 9.1% of battles |
| Leviathan | 9.8 | 932 | 871 | 0.83 | 1.19 | 0.00 | 42.6% | 2.9% of battles |
| Tempest | 8.1 | 644 | 618 | 0.54 | 1.30 | 0.00 | 23.7% | 17.8% of battles |
| Specter | 12.0 | 604 | 493 | 0.61 | 2.20 | 0.00 | 37.1% | 30.5% of battles |
| Sentinel | 12.1 | 435 | 984 | 0.57 | 2.65 | 0.00 | 40.9% | 4.1% of battles |
| Reaver | 10.4 | 610 | 605 | 0.50 | 2.19 | 0.00 | 32.2% | 14.9% of battles |
| Abyss | 10.3 | 909 | 790 | 0.89 | 1.63 | 0.00 | 39.9% | 11.4% of battles |
| Kraken | 11.3 | 652 | 759 | 0.69 | 2.41 | 2.34 | 41.4% | 8.9% of battles |
| Ember | 5.4 | 300 | 664 | 0.41 | 0.70 | 0.00 | 6.0% | 0.2% of battles |

### The 7 battles that hit the cap (planner)
HP gap at the cap 33.0 points on average · last damage on average 6.4 turns before the cap · both teams above 50 % HP in 0 of them (a standoff, not a slow grind).

_Generated by `bun scripts/strong-balance.ts`._

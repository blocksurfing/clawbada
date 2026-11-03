# Strong-play balance — tier=elite, n=800 battles per config × pilot (8 processes)

Targets: every class 45–55 % and spread ≤ 12pp under the planner · 100-turn cap ≤ 3 % · median 40–55 turns · under balanced no class outside 42–58 %.

## baseline

| Pilot | median turns (p10–p90) | 100-turn cap | draws | class spread | strongest | weakest | verdict |
|---|---|---|---|---|---|---|---|
| planner | 66 (46–100) | 14.0% | 0 | 32.6pp | Mantis 69.0 | Leviathan 36.4 | misses targets |

| Class | planner win % |
|---|---|
| Bulwark | 41.2 ± 2.3 |
| Mantis | 69.0 ± 2.3 |
| Leviathan | 36.4 ± 2.3 |
| Tempest | 48.9 ± 2.3 |
| Specter | 62.1 ± 2.3 |
| Sentinel | 46.2 ± 2.3 |
| Reaver | 45.1 ± 2.3 |
| Abyss | 45.2 ± 2.3 |
| Kraken | 68.5 ± 2.3 |
| Ember | 37.6 ± 2.3 |

### Why — per lobster, per battle (planner)
| Class | turns | damage dealt | damage taken | kills | Specials | stuns landed | survives | lands the first hit |
|---|---|---|---|---|---|---|---|---|
| Bulwark | 14.0 | 601 | 645 | 0.57 | 1.97 | 0.00 | 48.4% | 1.6% of battles |
| Mantis | 8.4 | 721 | 543 | 0.67 | 1.47 | 0.00 | 23.1% | 10.3% of battles |
| Leviathan | 9.4 | 723 | 903 | 0.56 | 1.22 | 0.00 | 32.8% | 0.9% of battles |
| Tempest | 8.7 | 638 | 613 | 0.46 | 1.54 | 0.00 | 24.0% | 21.8% of battles |
| Specter | 14.6 | 626 | 410 | 0.62 | 2.92 | 0.00 | 52.7% | 30.3% of battles |
| Sentinel | 14.4 | 324 | 899 | 0.47 | 3.26 | 0.00 | 53.4% | 4.0% of battles |
| Reaver | 11.2 | 581 | 586 | 0.42 | 2.51 | 0.00 | 30.9% | 15.0% of battles |
| Abyss | 12.4 | 855 | 771 | 0.79 | 2.18 | 0.00 | 42.9% | 10.0% of battles |
| Kraken | 14.2 | 598 | 648 | 0.71 | 3.17 | 3.12 | 62.4% | 5.8% of battles |
| Ember | 4.8 | 228 | 571 | 0.31 | 0.59 | 0.00 | 6.1% | 0.5% of battles |

### The 112 battles that hit the cap (planner)
HP gap at the cap 31.9 points on average · last damage on average 0.5 turns before the cap · both teams above 50 % HP in 14 of them (a standoff, not a slow grind).

## kraken-immunity3

| Pilot | median turns (p10–p90) | 100-turn cap | draws | class spread | strongest | weakest | verdict |
|---|---|---|---|---|---|---|---|
| planner | 66 (46–100) | 14.8% | 0 | 31.4pp | Mantis 67.6 | Leviathan 36.2 | misses targets |

| Class | planner win % |
|---|---|
| Bulwark | 42.8 ± 2.3 |
| Mantis | 67.6 ± 2.3 |
| Leviathan | 36.2 ± 2.3 |
| Tempest | 49.9 ± 2.3 |
| Specter | 61.9 ± 2.3 |
| Sentinel | 45.3 ± 2.3 |
| Reaver | 45.1 ± 2.3 |
| Abyss | 47.1 ± 2.3 |
| Kraken | 66.6 ± 2.3 |
| Ember | 37.6 ± 2.3 |

### Why — per lobster, per battle (planner)
| Class | turns | damage dealt | damage taken | kills | Specials | stuns landed | survives | lands the first hit |
|---|---|---|---|---|---|---|---|---|
| Bulwark | 14.1 | 604 | 633 | 0.58 | 1.98 | 0.00 | 50.5% | 1.6% of battles |
| Mantis | 8.5 | 722 | 541 | 0.68 | 1.48 | 0.00 | 23.5% | 10.3% of battles |
| Leviathan | 9.4 | 721 | 910 | 0.55 | 1.21 | 0.00 | 32.0% | 0.9% of battles |
| Tempest | 8.8 | 643 | 612 | 0.47 | 1.54 | 0.00 | 24.4% | 21.8% of battles |
| Specter | 14.8 | 625 | 412 | 0.59 | 2.98 | 0.00 | 53.3% | 30.3% of battles |
| Sentinel | 14.5 | 325 | 906 | 0.47 | 3.29 | 0.00 | 54.7% | 4.0% of battles |
| Reaver | 11.2 | 580 | 588 | 0.42 | 2.48 | 0.00 | 30.5% | 15.0% of battles |
| Abyss | 12.6 | 873 | 767 | 0.82 | 2.23 | 0.00 | 44.3% | 10.0% of battles |
| Kraken | 14.2 | 591 | 673 | 0.68 | 2.95 | 2.89 | 60.1% | 5.8% of battles |
| Ember | 4.8 | 232 | 572 | 0.31 | 0.60 | 0.00 | 6.1% | 0.5% of battles |

### The 118 battles that hit the cap (planner)
HP gap at the cap 32.7 points on average · last damage on average 0.6 turns before the cap · both teams above 50 % HP in 14 of them (a standoff, not a slow grind).

## kraken-speed-10

| Pilot | median turns (p10–p90) | 100-turn cap | draws | class spread | strongest | weakest | verdict |
|---|---|---|---|---|---|---|---|
| planner | 69 (48–100) | 16.3% | 0 | 24.5pp | Mantis 62.6 | Leviathan 38.0 | misses targets |

| Class | planner win % |
|---|---|
| Bulwark | 44.9 ± 2.3 |
| Mantis | 62.6 ± 2.3 |
| Leviathan | 38.0 ± 2.3 |
| Tempest | 51.3 ± 2.3 |
| Specter | 62.3 ± 2.3 |
| Sentinel | 41.4 ± 2.3 |
| Reaver | 48.2 ± 2.3 |
| Abyss | 50.2 ± 2.3 |
| Kraken | 58.5 ± 2.3 |
| Ember | 42.6 ± 2.3 |

### Why — per lobster, per battle (planner)
| Class | turns | damage dealt | damage taken | kills | Specials | stuns landed | survives | lands the first hit |
|---|---|---|---|---|---|---|---|---|
| Bulwark | 14.0 | 603 | 620 | 0.55 | 1.95 | 0.00 | 50.3% | 1.5% of battles |
| Mantis | 8.2 | 617 | 555 | 0.56 | 1.31 | 0.00 | 18.3% | 8.6% of battles |
| Leviathan | 10.2 | 758 | 903 | 0.57 | 1.34 | 0.00 | 34.7% | 1.1% of battles |
| Tempest | 9.0 | 652 | 602 | 0.47 | 1.59 | 0.00 | 26.1% | 20.4% of battles |
| Specter | 16.0 | 672 | 410 | 0.62 | 3.27 | 0.00 | 52.7% | 31.4% of battles |
| Sentinel | 15.4 | 327 | 954 | 0.53 | 3.52 | 0.00 | 51.8% | 3.1% of battles |
| Reaver | 11.4 | 589 | 573 | 0.42 | 2.56 | 0.00 | 33.6% | 16.9% of battles |
| Abyss | 13.0 | 880 | 732 | 0.92 | 2.30 | 0.00 | 46.6% | 16.0% of battles |
| Kraken | 13.4 | 560 | 735 | 0.58 | 2.76 | 2.72 | 53.2% | 0.5% of battles |
| Ember | 5.3 | 276 | 566 | 0.40 | 0.71 | 0.00 | 6.9% | 0.5% of battles |

### The 130 battles that hit the cap (planner)
HP gap at the cap 34.5 points on average · last damage on average 0.4 turns before the cap · both teams above 50 % HP in 7 of them (a standoff, not a slow grind).

## kraken-hp-10

| Pilot | median turns (p10–p90) | 100-turn cap | draws | class spread | strongest | weakest | verdict |
|---|---|---|---|---|---|---|---|
| planner | 65 (47–100) | 13.3% | 0 | 34.3pp | Mantis 68.6 | Leviathan 34.3 | misses targets |

| Class | planner win % |
|---|---|
| Bulwark | 42.8 ± 2.3 |
| Mantis | 68.6 ± 2.3 |
| Leviathan | 34.3 ± 2.3 |
| Tempest | 50.3 ± 2.3 |
| Specter | 63.8 ± 2.3 |
| Sentinel | 43.0 ± 2.3 |
| Reaver | 45.9 ± 2.3 |
| Abyss | 48.3 ± 2.3 |
| Kraken | 64.3 ± 2.3 |
| Ember | 38.6 ± 2.3 |

### Why — per lobster, per battle (planner)
| Class | turns | damage dealt | damage taken | kills | Specials | stuns landed | survives | lands the first hit |
|---|---|---|---|---|---|---|---|---|
| Bulwark | 13.9 | 600 | 638 | 0.59 | 1.94 | 0.00 | 48.6% | 1.6% of battles |
| Mantis | 8.6 | 740 | 537 | 0.70 | 1.52 | 0.00 | 24.3% | 10.3% of battles |
| Leviathan | 9.4 | 700 | 925 | 0.53 | 1.21 | 0.00 | 30.4% | 0.9% of battles |
| Tempest | 9.0 | 655 | 606 | 0.47 | 1.58 | 0.00 | 24.4% | 21.8% of battles |
| Specter | 14.9 | 629 | 397 | 0.62 | 3.01 | 0.00 | 53.3% | 30.3% of battles |
| Sentinel | 14.3 | 329 | 927 | 0.51 | 3.23 | 0.00 | 50.3% | 4.0% of battles |
| Reaver | 11.1 | 571 | 583 | 0.44 | 2.44 | 0.00 | 31.1% | 15.0% of battles |
| Abyss | 12.4 | 848 | 752 | 0.83 | 2.15 | 0.00 | 43.9% | 10.0% of battles |
| Kraken | 13.3 | 549 | 612 | 0.65 | 2.90 | 2.85 | 56.2% | 5.8% of battles |
| Ember | 4.8 | 236 | 569 | 0.32 | 0.61 | 0.00 | 5.8% | 0.5% of battles |

### The 106 battles that hit the cap (planner)
HP gap at the cap 30.0 points on average · last damage on average 0.5 turns before the cap · both teams above 50 % HP in 13 of them (a standoff, not a slow grind).

## mantis-speed-8

| Pilot | median turns (p10–p90) | 100-turn cap | draws | class spread | strongest | weakest | verdict |
|---|---|---|---|---|---|---|---|
| planner | 65 (47–100) | 14.8% | 0 | 32.9pp | Kraken 70.8 | Leviathan 37.8 | misses targets |

| Class | planner win % |
|---|---|
| Bulwark | 41.6 ± 2.3 |
| Mantis | 67.2 ± 2.3 |
| Leviathan | 37.8 ± 2.3 |
| Tempest | 52.4 ± 2.3 |
| Specter | 54.4 ± 2.3 |
| Sentinel | 49.9 ± 2.3 |
| Reaver | 47.6 ± 2.3 |
| Abyss | 40.3 ± 2.3 |
| Kraken | 70.8 ± 2.3 |
| Ember | 38.0 ± 2.3 |

### Why — per lobster, per battle (planner)
| Class | turns | damage dealt | damage taken | kills | Specials | stuns landed | survives | lands the first hit |
|---|---|---|---|---|---|---|---|---|
| Bulwark | 13.8 | 596 | 631 | 0.58 | 1.93 | 0.00 | 49.9% | 1.9% of battles |
| Mantis | 7.8 | 667 | 554 | 0.61 | 1.38 | 0.00 | 21.4% | 3.5% of battles |
| Leviathan | 9.8 | 733 | 879 | 0.62 | 1.24 | 0.00 | 35.8% | 0.9% of battles |
| Tempest | 8.6 | 659 | 609 | 0.50 | 1.57 | 0.00 | 25.1% | 21.8% of battles |
| Specter | 14.1 | 586 | 440 | 0.58 | 2.79 | 0.00 | 44.6% | 37.4% of battles |
| Sentinel | 14.8 | 338 | 859 | 0.48 | 3.38 | 0.00 | 58.2% | 4.8% of battles |
| Reaver | 11.3 | 585 | 579 | 0.42 | 2.53 | 0.00 | 31.5% | 15.1% of battles |
| Abyss | 12.4 | 855 | 812 | 0.79 | 2.22 | 0.00 | 39.5% | 8.6% of battles |
| Kraken | 14.2 | 619 | 630 | 0.70 | 3.13 | 3.10 | 62.6% | 5.6% of battles |
| Ember | 4.9 | 226 | 570 | 0.31 | 0.58 | 0.00 | 6.1% | 0.5% of battles |

### The 118 battles that hit the cap (planner)
HP gap at the cap 36.4 points on average · last damage on average 0.4 turns before the cap · both teams above 50 % HP in 17 of them (a standoff, not a slow grind).

## mantis-crit-25

| Pilot | median turns (p10–p90) | 100-turn cap | draws | class spread | strongest | weakest | verdict |
|---|---|---|---|---|---|---|---|
| planner | 66 (46–100) | 14.1% | 0 | 30.4pp | Kraken 68.7 | Leviathan 38.3 | misses targets |

| Class | planner win % |
|---|---|
| Bulwark | 41.6 ± 2.3 |
| Mantis | 66.7 ± 2.3 |
| Leviathan | 38.3 ± 2.3 |
| Tempest | 49.9 ± 2.3 |
| Specter | 58.8 ± 2.3 |
| Sentinel | 48.2 ± 2.3 |
| Reaver | 45.7 ± 2.3 |
| Abyss | 43.7 ± 2.3 |
| Kraken | 68.7 ± 2.3 |
| Ember | 38.4 ± 2.3 |

### Why — per lobster, per battle (planner)
| Class | turns | damage dealt | damage taken | kills | Specials | stuns landed | survives | lands the first hit |
|---|---|---|---|---|---|---|---|---|
| Bulwark | 14.0 | 607 | 645 | 0.60 | 1.91 | 0.00 | 48.6% | 1.6% of battles |
| Mantis | 8.4 | 727 | 546 | 0.64 | 1.48 | 0.00 | 22.9% | 9.6% of battles |
| Leviathan | 9.4 | 728 | 910 | 0.57 | 1.22 | 0.00 | 33.9% | 0.9% of battles |
| Tempest | 8.7 | 638 | 616 | 0.48 | 1.54 | 0.00 | 23.6% | 21.8% of battles |
| Specter | 14.4 | 608 | 426 | 0.59 | 2.83 | 0.00 | 48.5% | 30.6% of battles |
| Sentinel | 14.5 | 325 | 884 | 0.48 | 3.31 | 0.00 | 55.3% | 4.3% of battles |
| Reaver | 11.2 | 577 | 584 | 0.40 | 2.52 | 0.00 | 31.7% | 14.8% of battles |
| Abyss | 12.4 | 863 | 776 | 0.82 | 2.19 | 0.00 | 42.9% | 9.4% of battles |
| Kraken | 14.1 | 597 | 642 | 0.71 | 3.11 | 3.07 | 62.0% | 6.6% of battles |
| Ember | 4.8 | 226 | 568 | 0.30 | 0.59 | 0.00 | 6.3% | 0.5% of battles |

### The 113 battles that hit the cap (planner)
HP gap at the cap 30.4 points on average · last damage on average 0.7 turns before the cap · both teams above 50 % HP in 13 of them (a standoff, not a slow grind).

## specter-dodge20

| Pilot | median turns (p10–p90) | 100-turn cap | draws | class spread | strongest | weakest | verdict |
|---|---|---|---|---|---|---|---|
| planner | 65 (47–100) | 12.9% | 0 | 28.5pp | Mantis 65.1 | Leviathan 36.6 | misses targets |

| Class | planner win % |
|---|---|
| Bulwark | 45.1 ± 2.3 |
| Mantis | 65.1 ± 2.3 |
| Leviathan | 36.6 ± 2.3 |
| Tempest | 51.8 ± 2.3 |
| Specter | 59.6 ± 2.3 |
| Sentinel | 45.7 ± 2.3 |
| Reaver | 46.8 ± 2.3 |
| Abyss | 46.2 ± 2.3 |
| Kraken | 64.7 ± 2.3 |
| Ember | 38.4 ± 2.3 |

### Why — per lobster, per battle (planner)
| Class | turns | damage dealt | damage taken | kills | Specials | stuns landed | survives | lands the first hit |
|---|---|---|---|---|---|---|---|---|
| Bulwark | 13.6 | 598 | 615 | 0.55 | 1.91 | 0.00 | 50.1% | 1.5% of battles |
| Mantis | 8.4 | 727 | 538 | 0.65 | 1.48 | 0.00 | 24.3% | 9.5% of battles |
| Leviathan | 9.4 | 717 | 909 | 0.57 | 1.23 | 0.00 | 32.6% | 0.9% of battles |
| Tempest | 8.8 | 658 | 600 | 0.52 | 1.54 | 0.00 | 27.1% | 21.0% of battles |
| Specter | 13.9 | 570 | 432 | 0.58 | 2.68 | 0.00 | 46.5% | 30.4% of battles |
| Sentinel | 14.3 | 327 | 893 | 0.48 | 3.17 | 0.00 | 53.4% | 4.0% of battles |
| Reaver | 11.4 | 589 | 577 | 0.45 | 2.51 | 0.00 | 32.6% | 15.8% of battles |
| Abyss | 12.0 | 832 | 744 | 0.87 | 2.05 | 0.00 | 43.7% | 9.9% of battles |
| Kraken | 13.9 | 595 | 650 | 0.67 | 3.04 | 3.00 | 58.7% | 6.6% of battles |
| Ember | 4.7 | 225 | 569 | 0.30 | 0.58 | 0.00 | 5.6% | 0.5% of battles |

### The 103 battles that hit the cap (planner)
HP gap at the cap 34.0 points on average · last damage on average 0.4 turns before the cap · both teams above 50 % HP in 10 of them (a standoff, not a slow grind).

## specter-dodge10

| Pilot | median turns (p10–p90) | 100-turn cap | draws | class spread | strongest | weakest | verdict |
|---|---|---|---|---|---|---|---|
| planner | 64 (47–100) | 15.1% | 0 | 26.0pp | Kraken 64.5 | Leviathan 38.5 | misses targets |

| Class | planner win % |
|---|---|
| Bulwark | 45.9 ± 2.3 |
| Mantis | 61.5 ± 2.3 |
| Leviathan | 38.5 ± 2.3 |
| Tempest | 55.5 ± 2.3 |
| Specter | 52.7 ± 2.3 |
| Sentinel | 48.9 ± 2.3 |
| Reaver | 47.6 ± 2.3 |
| Abyss | 45.4 ± 2.3 |
| Kraken | 64.5 ± 2.3 |
| Ember | 39.5 ± 2.3 |

### Why — per lobster, per battle (planner)
| Class | turns | damage dealt | damage taken | kills | Specials | stuns landed | survives | lands the first hit |
|---|---|---|---|---|---|---|---|---|
| Bulwark | 13.5 | 600 | 589 | 0.58 | 1.85 | 0.00 | 53.0% | 1.5% of battles |
| Mantis | 8.2 | 679 | 558 | 0.60 | 1.37 | 0.00 | 20.6% | 13.0% of battles |
| Leviathan | 9.4 | 733 | 906 | 0.58 | 1.23 | 0.00 | 32.8% | 0.9% of battles |
| Tempest | 8.9 | 688 | 584 | 0.56 | 1.57 | 0.00 | 29.4% | 21.3% of battles |
| Specter | 13.6 | 556 | 464 | 0.55 | 2.59 | 0.00 | 42.3% | 26.1% of battles |
| Sentinel | 14.7 | 342 | 891 | 0.51 | 3.32 | 0.00 | 56.5% | 4.0% of battles |
| Reaver | 11.3 | 594 | 577 | 0.44 | 2.53 | 0.00 | 33.4% | 15.8% of battles |
| Abyss | 12.1 | 855 | 751 | 0.80 | 2.16 | 0.00 | 44.3% | 9.6% of battles |
| Kraken | 14.1 | 598 | 667 | 0.71 | 3.06 | 3.02 | 58.9% | 7.4% of battles |
| Ember | 4.7 | 234 | 569 | 0.32 | 0.58 | 0.00 | 5.6% | 0.5% of battles |

### The 121 battles that hit the cap (planner)
HP gap at the cap 32.4 points on average · last damage on average 0.6 turns before the cap · both teams above 50 % HP in 17 of them (a standoff, not a slow grind).

## levi-move2

| Pilot | median turns (p10–p90) | 100-turn cap | draws | class spread | strongest | weakest | verdict |
|---|---|---|---|---|---|---|---|
| planner | 67 (47–100) | 18.9% | 0 | 33.9pp | Mantis 68.0 | Bulwark 34.1 | misses targets |

| Class | planner win % |
|---|---|
| Bulwark | 34.1 ± 2.3 |
| Mantis | 68.0 ± 2.3 |
| Leviathan | 44.9 ± 2.3 |
| Tempest | 41.4 ± 2.3 |
| Specter | 60.4 ± 2.3 |
| Sentinel | 53.4 ± 2.3 |
| Reaver | 42.0 ± 2.3 |
| Abyss | 42.6 ± 2.3 |
| Kraken | 67.8 ± 2.3 |
| Ember | 45.3 ± 2.3 |

### Why — per lobster, per battle (planner)
| Class | turns | damage dealt | damage taken | kills | Specials | stuns landed | survives | lands the first hit |
|---|---|---|---|---|---|---|---|---|
| Bulwark | 14.3 | 614 | 682 | 0.54 | 2.01 | 0.00 | 46.4% | 1.8% of battles |
| Mantis | 8.9 | 732 | 526 | 0.71 | 1.54 | 0.00 | 24.9% | 7.8% of battles |
| Leviathan | 9.7 | 737 | 873 | 0.67 | 1.46 | 0.00 | 41.2% | 2.5% of battles |
| Tempest | 9.0 | 624 | 612 | 0.40 | 1.53 | 0.00 | 22.8% | 13.5% of battles |
| Specter | 15.0 | 602 | 415 | 0.60 | 2.94 | 0.00 | 53.1% | 32.8% of battles |
| Sentinel | 15.0 | 313 | 849 | 0.44 | 3.43 | 0.00 | 61.1% | 11.4% of battles |
| Reaver | 10.9 | 545 | 571 | 0.43 | 2.41 | 0.00 | 33.0% | 14.8% of battles |
| Abyss | 12.5 | 844 | 758 | 0.74 | 2.14 | 0.00 | 42.4% | 9.1% of battles |
| Kraken | 14.1 | 588 | 654 | 0.64 | 3.07 | 3.01 | 60.8% | 6.0% of battles |
| Ember | 5.4 | 245 | 573 | 0.32 | 0.68 | 0.00 | 6.3% | 0.5% of battles |

### The 151 battles that hit the cap (planner)
HP gap at the cap 32.6 points on average · last damage on average 0.5 turns before the cap · both teams above 50 % HP in 12 of them (a standoff, not a slow grind).

## levi-speed+15

| Pilot | median turns (p10–p90) | 100-turn cap | draws | class spread | strongest | weakest | verdict |
|---|---|---|---|---|---|---|---|
| planner | 66 (48–100) | 16.8% | 0 | 27.1pp | Kraken 66.2 | Bulwark 39.1 | misses targets |

| Class | planner win % |
|---|---|
| Bulwark | 39.1 ± 2.3 |
| Mantis | 65.5 ± 2.3 |
| Leviathan | 43.2 ± 2.3 |
| Tempest | 45.5 ± 2.3 |
| Specter | 61.0 ± 2.3 |
| Sentinel | 48.4 ± 2.3 |
| Reaver | 43.4 ± 2.3 |
| Abyss | 45.6 ± 2.3 |
| Kraken | 66.2 ± 2.3 |
| Ember | 42.0 ± 2.3 |

### Why — per lobster, per battle (planner)
| Class | turns | damage dealt | damage taken | kills | Specials | stuns landed | survives | lands the first hit |
|---|---|---|---|---|---|---|---|---|
| Bulwark | 14.3 | 621 | 656 | 0.57 | 1.93 | 0.00 | 49.1% | 1.0% of battles |
| Mantis | 8.1 | 661 | 550 | 0.62 | 1.33 | 0.00 | 20.4% | 10.3% of battles |
| Leviathan | 11.0 | 825 | 852 | 0.62 | 1.47 | 0.00 | 38.9% | 0.1% of battles |
| Tempest | 8.6 | 606 | 621 | 0.46 | 1.46 | 0.00 | 23.2% | 20.5% of battles |
| Specter | 14.6 | 627 | 424 | 0.64 | 2.93 | 0.00 | 52.5% | 30.3% of battles |
| Sentinel | 14.7 | 330 | 883 | 0.48 | 3.33 | 0.00 | 56.5% | 4.3% of battles |
| Reaver | 11.0 | 557 | 585 | 0.43 | 2.38 | 0.00 | 30.9% | 14.5% of battles |
| Abyss | 12.3 | 842 | 768 | 0.74 | 2.09 | 0.00 | 41.2% | 12.5% of battles |
| Kraken | 14.4 | 601 | 680 | 0.70 | 3.16 | 3.11 | 61.2% | 6.4% of battles |
| Ember | 4.6 | 237 | 567 | 0.30 | 0.58 | 0.00 | 5.6% | 0.3% of battles |

### The 134 battles that hit the cap (planner)
HP gap at the cap 31.3 points on average · last damage on average 0.3 turns before the cap · both teams above 50 % HP in 10 of them (a standoff, not a slow grind).

## levi-hp+15

| Pilot | median turns (p10–p90) | 100-turn cap | draws | class spread | strongest | weakest | verdict |
|---|---|---|---|---|---|---|---|
| planner | 67 (48–100) | 16.6% | 0 | 29.9pp | Kraken 69.3 | Ember 39.5 | misses targets |

| Class | planner win % |
|---|---|
| Bulwark | 39.7 ± 2.3 |
| Mantis | 66.1 ± 2.3 |
| Leviathan | 42.0 ± 2.3 |
| Tempest | 46.2 ± 2.3 |
| Specter | 59.8 ± 2.3 |
| Sentinel | 49.7 ± 2.3 |
| Reaver | 44.7 ± 2.3 |
| Abyss | 43.1 ± 2.3 |
| Kraken | 69.3 ± 2.3 |
| Ember | 39.5 ± 2.3 |

### Why — per lobster, per battle (planner)
| Class | turns | damage dealt | damage taken | kills | Specials | stuns landed | survives | lands the first hit |
|---|---|---|---|---|---|---|---|---|
| Bulwark | 14.4 | 613 | 657 | 0.57 | 2.04 | 0.00 | 48.0% | 1.6% of battles |
| Mantis | 8.5 | 740 | 551 | 0.64 | 1.49 | 0.00 | 20.8% | 10.3% of battles |
| Leviathan | 10.7 | 797 | 962 | 0.67 | 1.30 | 0.00 | 42.0% | 0.9% of battles |
| Tempest | 8.8 | 647 | 620 | 0.43 | 1.57 | 0.00 | 22.6% | 21.8% of battles |
| Specter | 15.0 | 625 | 420 | 0.61 | 3.00 | 0.00 | 51.7% | 30.3% of battles |
| Sentinel | 14.5 | 309 | 911 | 0.44 | 3.30 | 0.00 | 55.5% | 4.0% of battles |
| Reaver | 11.4 | 578 | 594 | 0.43 | 2.56 | 0.00 | 29.6% | 15.0% of battles |
| Abyss | 12.5 | 860 | 775 | 0.78 | 2.22 | 0.00 | 41.2% | 10.0% of battles |
| Kraken | 14.5 | 615 | 654 | 0.70 | 3.23 | 3.18 | 61.8% | 5.8% of battles |
| Ember | 4.6 | 220 | 570 | 0.30 | 0.57 | 0.00 | 5.2% | 0.5% of battles |

### The 133 battles that hit the cap (planner)
HP gap at the cap 31.9 points on average · last damage on average 0.3 turns before the cap · both teams above 50 % HP in 12 of them (a standoff, not a slow grind).

## ember-hp+20

| Pilot | median turns (p10–p90) | 100-turn cap | draws | class spread | strongest | weakest | verdict |
|---|---|---|---|---|---|---|---|
| planner | 67 (50–100) | 14.9% | 0 | 28.9pp | Mantis 65.1 | Bulwark 36.2 | misses targets |

| Class | planner win % |
|---|---|
| Bulwark | 36.2 ± 2.3 |
| Mantis | 65.1 ± 2.3 |
| Leviathan | 44.1 ± 2.3 |
| Tempest | 45.3 ± 2.3 |
| Specter | 60.4 ± 2.3 |
| Sentinel | 47.4 ± 2.3 |
| Reaver | 47.0 ± 2.3 |
| Abyss | 43.5 ± 2.3 |
| Kraken | 63.5 ± 2.3 |
| Ember | 47.6 ± 2.3 |

### Why — per lobster, per battle (planner)
| Class | turns | damage dealt | damage taken | kills | Specials | stuns landed | survives | lands the first hit |
|---|---|---|---|---|---|---|---|---|
| Bulwark | 14.2 | 594 | 695 | 0.51 | 2.00 | 0.00 | 44.7% | 1.8% of battles |
| Mantis | 8.2 | 679 | 554 | 0.63 | 1.39 | 0.00 | 20.0% | 10.3% of battles |
| Leviathan | 9.7 | 738 | 869 | 0.58 | 1.22 | 0.00 | 39.9% | 1.0% of battles |
| Tempest | 8.7 | 631 | 592 | 0.49 | 1.46 | 0.00 | 26.9% | 21.6% of battles |
| Specter | 14.8 | 640 | 413 | 0.62 | 2.97 | 0.00 | 52.1% | 30.3% of battles |
| Sentinel | 15.2 | 347 | 907 | 0.51 | 3.45 | 0.00 | 54.7% | 4.3% of battles |
| Reaver | 11.6 | 594 | 570 | 0.44 | 2.57 | 0.00 | 35.1% | 15.1% of battles |
| Abyss | 12.4 | 853 | 779 | 0.76 | 2.14 | 0.00 | 41.2% | 9.6% of battles |
| Kraken | 14.5 | 620 | 677 | 0.66 | 3.23 | 3.19 | 57.4% | 5.8% of battles |
| Ember | 5.6 | 312 | 665 | 0.42 | 0.76 | 0.00 | 8.4% | 0.4% of battles |

### The 119 battles that hit the cap (planner)
HP gap at the cap 34.0 points on average · last damage on average 0.4 turns before the cap · both teams above 50 % HP in 14 of them (a standoff, not a slow grind).

## ember-armor+25

| Pilot | median turns (p10–p90) | 100-turn cap | draws | class spread | strongest | weakest | verdict |
|---|---|---|---|---|---|---|---|
| planner | 68 (50–100) | 15.6% | 0 | 29.7pp | Mantis 66.1 | Bulwark 36.4 | misses targets |

| Class | planner win % |
|---|---|
| Bulwark | 36.4 ± 2.3 |
| Mantis | 66.1 ± 2.3 |
| Leviathan | 41.6 ± 2.3 |
| Tempest | 46.6 ± 2.3 |
| Specter | 61.3 ± 2.3 |
| Sentinel | 45.3 ± 2.3 |
| Reaver | 48.6 ± 2.3 |
| Abyss | 43.3 ± 2.3 |
| Kraken | 63.0 ± 2.3 |
| Ember | 47.8 ± 2.3 |

### Why — per lobster, per battle (planner)
| Class | turns | damage dealt | damage taken | kills | Specials | stuns landed | survives | lands the first hit |
|---|---|---|---|---|---|---|---|---|
| Bulwark | 14.2 | 575 | 701 | 0.50 | 2.00 | 0.00 | 44.1% | 0.8% of battles |
| Mantis | 8.2 | 690 | 556 | 0.64 | 1.42 | 0.00 | 19.8% | 10.3% of battles |
| Leviathan | 9.7 | 711 | 866 | 0.57 | 1.29 | 0.00 | 37.8% | 0.0% of battles |
| Tempest | 8.8 | 613 | 587 | 0.47 | 1.47 | 0.00 | 27.5% | 19.8% of battles |
| Specter | 14.8 | 626 | 413 | 0.61 | 2.93 | 0.00 | 52.7% | 30.3% of battles |
| Sentinel | 15.2 | 322 | 902 | 0.45 | 3.41 | 0.00 | 54.1% | 6.9% of battles |
| Reaver | 11.7 | 585 | 557 | 0.46 | 2.58 | 0.00 | 35.7% | 13.9% of battles |
| Abyss | 12.5 | 849 | 780 | 0.78 | 2.22 | 0.00 | 42.0% | 11.6% of battles |
| Kraken | 14.5 | 579 | 685 | 0.68 | 3.22 | 3.17 | 57.8% | 5.8% of battles |
| Ember | 5.9 | 345 | 568 | 0.43 | 0.88 | 0.00 | 10.4% | 0.9% of battles |

### The 125 battles that hit the cap (planner)
HP gap at the cap 32.1 points on average · last damage on average 0.4 turns before the cap · both teams above 50 % HP in 15 of them (a standoff, not a slow grind).

## bulwark-atk+15

| Pilot | median turns (p10–p90) | 100-turn cap | draws | class spread | strongest | weakest | verdict |
|---|---|---|---|---|---|---|---|
| planner | 65 (46–100) | 14.8% | 0 | 29.0pp | Kraken 64.9 | Leviathan 36.0 | misses targets |

| Class | planner win % |
|---|---|
| Bulwark | 48.6 ± 2.3 |
| Mantis | 63.0 ± 2.3 |
| Leviathan | 36.0 ± 2.3 |
| Tempest | 52.6 ± 2.3 |
| Specter | 60.4 ± 2.3 |
| Sentinel | 45.5 ± 2.3 |
| Reaver | 44.1 ± 2.3 |
| Abyss | 48.7 ± 2.3 |
| Kraken | 64.9 ± 2.3 |
| Ember | 36.1 ± 2.3 |

### Why — per lobster, per battle (planner)
| Class | turns | damage dealt | damage taken | kills | Specials | stuns landed | survives | lands the first hit |
|---|---|---|---|---|---|---|---|---|
| Bulwark | 13.7 | 718 | 586 | 0.65 | 1.87 | 0.00 | 56.3% | 1.4% of battles |
| Mantis | 8.3 | 707 | 539 | 0.65 | 1.42 | 0.00 | 23.7% | 9.3% of battles |
| Leviathan | 9.3 | 727 | 938 | 0.59 | 1.22 | 0.00 | 31.2% | 0.6% of battles |
| Tempest | 8.6 | 636 | 608 | 0.49 | 1.51 | 0.00 | 24.0% | 21.9% of battles |
| Specter | 14.4 | 602 | 419 | 0.58 | 2.83 | 0.00 | 49.8% | 30.6% of battles |
| Sentinel | 14.7 | 314 | 921 | 0.46 | 3.41 | 0.00 | 53.4% | 4.1% of battles |
| Reaver | 11.3 | 572 | 585 | 0.42 | 2.55 | 0.00 | 31.3% | 15.3% of battles |
| Abyss | 12.1 | 840 | 762 | 0.78 | 2.16 | 0.00 | 43.5% | 8.6% of battles |
| Kraken | 13.9 | 579 | 671 | 0.70 | 3.09 | 3.04 | 60.3% | 7.8% of battles |
| Ember | 4.5 | 214 | 576 | 0.28 | 0.56 | 0.00 | 3.5% | 0.5% of battles |

### The 118 battles that hit the cap (planner)
HP gap at the cap 34.1 points on average · last damage on average 0.6 turns before the cap · both teams above 50 % HP in 16 of them (a standoff, not a slow grind).

## bulwark-hp+10

| Pilot | median turns (p10–p90) | 100-turn cap | draws | class spread | strongest | weakest | verdict |
|---|---|---|---|---|---|---|---|
| planner | 66 (47–100) | 15.1% | 0 | 32.6pp | Mantis 68.8 | Leviathan 36.2 | misses targets |

| Class | planner win % |
|---|---|
| Bulwark | 42.0 ± 2.3 |
| Mantis | 68.8 ± 2.3 |
| Leviathan | 36.2 ± 2.3 |
| Tempest | 48.7 ± 2.3 |
| Specter | 62.7 ± 2.3 |
| Sentinel | 45.9 ± 2.3 |
| Reaver | 44.7 ± 2.3 |
| Abyss | 45.6 ± 2.3 |
| Kraken | 68.5 ± 2.3 |
| Ember | 37.0 ± 2.3 |

### Why — per lobster, per battle (planner)
| Class | turns | damage dealt | damage taken | kills | Specials | stuns landed | survives | lands the first hit |
|---|---|---|---|---|---|---|---|---|
| Bulwark | 14.2 | 610 | 685 | 0.58 | 1.99 | 0.00 | 51.6% | 1.6% of battles |
| Mantis | 8.5 | 722 | 541 | 0.68 | 1.48 | 0.00 | 23.3% | 10.3% of battles |
| Leviathan | 9.4 | 727 | 912 | 0.56 | 1.22 | 0.00 | 32.8% | 0.9% of battles |
| Tempest | 8.8 | 640 | 614 | 0.45 | 1.54 | 0.00 | 23.8% | 21.8% of battles |
| Specter | 14.8 | 637 | 408 | 0.63 | 2.98 | 0.00 | 53.3% | 30.3% of battles |
| Sentinel | 14.5 | 328 | 900 | 0.47 | 3.31 | 0.00 | 53.4% | 4.0% of battles |
| Reaver | 11.4 | 586 | 590 | 0.42 | 2.55 | 0.00 | 30.1% | 15.0% of battles |
| Abyss | 12.4 | 853 | 776 | 0.76 | 2.20 | 0.00 | 43.3% | 10.0% of battles |
| Kraken | 14.3 | 605 | 643 | 0.71 | 3.21 | 3.16 | 63.0% | 5.8% of battles |
| Ember | 4.8 | 228 | 570 | 0.29 | 0.60 | 0.00 | 5.2% | 0.5% of battles |

### The 121 battles that hit the cap (planner)
HP gap at the cap 31.7 points on average · last damage on average 0.4 turns before the cap · both teams above 50 % HP in 17 of them (a standoff, not a slow grind).

## sentinel-rally30

| Pilot | median turns (p10–p90) | 100-turn cap | draws | class spread | strongest | weakest | verdict |
|---|---|---|---|---|---|---|---|
| planner | 67 (47–100) | 15.8% | 0 | 33.4pp | Kraken 71.6 | Bulwark 38.3 | misses targets |

| Class | planner win % |
|---|---|
| Bulwark | 38.3 ± 2.3 |
| Mantis | 68.6 ± 2.3 |
| Leviathan | 39.9 ± 2.3 |
| Tempest | 47.0 ± 2.3 |
| Specter | 59.0 ± 2.3 |
| Sentinel | 51.4 ± 2.3 |
| Reaver | 43.0 ± 2.3 |
| Abyss | 42.2 ± 2.3 |
| Kraken | 71.6 ± 2.3 |
| Ember | 39.0 ± 2.3 |

### Why — per lobster, per battle (planner)
| Class | turns | damage dealt | damage taken | kills | Specials | stuns landed | survives | lands the first hit |
|---|---|---|---|---|---|---|---|---|
| Bulwark | 14.0 | 595 | 664 | 0.53 | 1.96 | 0.00 | 48.0% | 1.6% of battles |
| Mantis | 8.6 | 746 | 550 | 0.72 | 1.49 | 0.00 | 23.1% | 10.3% of battles |
| Leviathan | 9.8 | 731 | 912 | 0.58 | 1.29 | 0.00 | 37.8% | 0.9% of battles |
| Tempest | 8.8 | 641 | 609 | 0.43 | 1.55 | 0.00 | 24.4% | 21.8% of battles |
| Specter | 14.5 | 610 | 420 | 0.58 | 2.92 | 0.00 | 51.5% | 30.3% of battles |
| Sentinel | 14.7 | 317 | 865 | 0.49 | 3.28 | 0.00 | 58.6% | 4.0% of battles |
| Reaver | 11.3 | 592 | 580 | 0.42 | 2.49 | 0.00 | 30.9% | 15.0% of battles |
| Abyss | 12.3 | 845 | 772 | 0.78 | 2.12 | 0.00 | 41.4% | 10.0% of battles |
| Kraken | 14.5 | 607 | 659 | 0.66 | 3.18 | 3.14 | 64.3% | 5.8% of battles |
| Ember | 4.8 | 233 | 575 | 0.30 | 0.59 | 0.00 | 5.8% | 0.5% of battles |

### The 126 battles that hit the cap (planner)
HP gap at the cap 34.4 points on average · last damage on average 0.3 turns before the cap · both teams above 50 % HP in 20 of them (a standoff, not a slow grind).

## sentinel-atk+15

| Pilot | median turns (p10–p90) | 100-turn cap | draws | class spread | strongest | weakest | verdict |
|---|---|---|---|---|---|---|---|
| planner | 66 (47–100) | 15.0% | 0 | 35.0pp | Kraken 70.8 | Bulwark 35.8 | misses targets |

| Class | planner win % |
|---|---|
| Bulwark | 35.8 ± 2.3 |
| Mantis | 70.3 ± 2.3 |
| Leviathan | 40.7 ± 2.3 |
| Tempest | 44.7 ± 2.3 |
| Specter | 59.6 ± 2.3 |
| Sentinel | 53.6 ± 2.3 |
| Reaver | 40.1 ± 2.3 |
| Abyss | 43.3 ± 2.3 |
| Kraken | 70.8 ± 2.3 |
| Ember | 41.1 ± 2.3 |

### Why — per lobster, per battle (planner)
| Class | turns | damage dealt | damage taken | kills | Specials | stuns landed | survives | lands the first hit |
|---|---|---|---|---|---|---|---|---|
| Bulwark | 14.1 | 595 | 681 | 0.53 | 1.97 | 0.00 | 45.5% | 1.5% of battles |
| Mantis | 8.7 | 720 | 536 | 0.69 | 1.48 | 0.00 | 25.4% | 10.0% of battles |
| Leviathan | 9.7 | 702 | 895 | 0.51 | 1.23 | 0.00 | 35.6% | 0.9% of battles |
| Tempest | 8.6 | 632 | 616 | 0.45 | 1.53 | 0.00 | 22.8% | 21.8% of battles |
| Specter | 14.7 | 626 | 417 | 0.57 | 3.00 | 0.00 | 51.7% | 30.5% of battles |
| Sentinel | 14.9 | 411 | 853 | 0.59 | 3.35 | 0.00 | 59.0% | 4.4% of battles |
| Reaver | 11.1 | 548 | 589 | 0.40 | 2.41 | 0.00 | 30.3% | 14.8% of battles |
| Abyss | 12.2 | 836 | 783 | 0.81 | 2.15 | 0.00 | 40.3% | 8.9% of battles |
| Kraken | 14.3 | 592 | 633 | 0.68 | 3.12 | 3.09 | 65.3% | 6.9% of battles |
| Ember | 4.9 | 234 | 568 | 0.31 | 0.59 | 0.00 | 6.1% | 0.5% of battles |

### The 120 battles that hit the cap (planner)
HP gap at the cap 34.3 points on average · last damage on average 0.4 turns before the cap · both teams above 50 % HP in 10 of them (a standoff, not a slow grind).

## reaver-bleed65

| Pilot | median turns (p10–p90) | 100-turn cap | draws | class spread | strongest | weakest | verdict |
|---|---|---|---|---|---|---|---|
| planner | 65 (47–100) | 14.3% | 0 | 29.9pp | Mantis 67.4 | Leviathan 37.4 | misses targets |

| Class | planner win % |
|---|---|
| Bulwark | 39.7 ± 2.3 |
| Mantis | 67.4 ± 2.3 |
| Leviathan | 37.4 ± 2.3 |
| Tempest | 49.9 ± 2.3 |
| Specter | 59.8 ± 2.3 |
| Sentinel | 46.2 ± 2.3 |
| Reaver | 48.9 ± 2.3 |
| Abyss | 41.4 ± 2.3 |
| Kraken | 67.0 ± 2.3 |
| Ember | 42.4 ± 2.3 |

### Why — per lobster, per battle (planner)
| Class | turns | damage dealt | damage taken | kills | Specials | stuns landed | survives | lands the first hit |
|---|---|---|---|---|---|---|---|---|
| Bulwark | 13.5 | 593 | 650 | 0.56 | 1.92 | 0.00 | 48.0% | 1.6% of battles |
| Mantis | 8.5 | 718 | 541 | 0.69 | 1.47 | 0.00 | 23.9% | 10.3% of battles |
| Leviathan | 9.3 | 716 | 919 | 0.53 | 1.23 | 0.00 | 32.8% | 0.9% of battles |
| Tempest | 8.7 | 623 | 598 | 0.47 | 1.49 | 0.00 | 25.9% | 21.8% of battles |
| Specter | 14.4 | 620 | 410 | 0.60 | 2.86 | 0.00 | 51.7% | 30.3% of battles |
| Sentinel | 14.5 | 320 | 888 | 0.48 | 3.26 | 0.00 | 53.2% | 4.0% of battles |
| Reaver | 11.1 | 570 | 573 | 0.43 | 2.53 | 0.00 | 33.2% | 15.0% of battles |
| Abyss | 12.2 | 840 | 784 | 0.78 | 2.12 | 0.00 | 40.1% | 10.0% of battles |
| Kraken | 14.2 | 593 | 660 | 0.70 | 3.16 | 3.11 | 61.6% | 5.8% of battles |
| Ember | 4.8 | 240 | 572 | 0.29 | 0.61 | 0.00 | 5.4% | 0.5% of battles |

### The 114 battles that hit the cap (planner)
HP gap at the cap 31.1 points on average · last damage on average 0.4 turns before the cap · both teams above 50 % HP in 14 of them (a standoff, not a slow grind).

## reaver-hp+10

| Pilot | median turns (p10–p90) | 100-turn cap | draws | class spread | strongest | weakest | verdict |
|---|---|---|---|---|---|---|---|
| planner | 66 (48–100) | 16.0% | 0 | 27.9pp | Kraken 67.2 | Bulwark 39.3 | misses targets |

| Class | planner win % |
|---|---|
| Bulwark | 39.3 ± 2.3 |
| Mantis | 66.9 ± 2.3 |
| Leviathan | 39.5 ± 2.3 |
| Tempest | 47.8 ± 2.3 |
| Specter | 60.4 ± 2.3 |
| Sentinel | 45.9 ± 2.3 |
| Reaver | 49.5 ± 2.3 |
| Abyss | 41.0 ± 2.3 |
| Kraken | 67.2 ± 2.3 |
| Ember | 42.4 ± 2.3 |

### Why — per lobster, per battle (planner)
| Class | turns | damage dealt | damage taken | kills | Specials | stuns landed | survives | lands the first hit |
|---|---|---|---|---|---|---|---|---|
| Bulwark | 13.7 | 605 | 638 | 0.55 | 1.99 | 0.00 | 50.5% | 1.6% of battles |
| Mantis | 8.4 | 712 | 538 | 0.66 | 1.46 | 0.00 | 22.5% | 10.3% of battles |
| Leviathan | 9.1 | 714 | 906 | 0.51 | 1.21 | 0.00 | 32.8% | 0.9% of battles |
| Tempest | 8.8 | 629 | 602 | 0.47 | 1.54 | 0.00 | 24.6% | 21.8% of battles |
| Specter | 14.5 | 622 | 413 | 0.62 | 2.89 | 0.00 | 51.7% | 30.3% of battles |
| Sentinel | 15.1 | 332 | 940 | 0.44 | 3.45 | 0.00 | 53.8% | 4.0% of battles |
| Reaver | 12.2 | 636 | 607 | 0.49 | 2.73 | 0.00 | 38.4% | 14.9% of battles |
| Abyss | 12.2 | 836 | 772 | 0.73 | 2.11 | 0.00 | 41.0% | 10.1% of battles |
| Kraken | 14.3 | 604 | 656 | 0.72 | 3.22 | 3.18 | 60.5% | 5.8% of battles |
| Ember | 4.8 | 216 | 569 | 0.30 | 0.58 | 0.00 | 5.8% | 0.5% of battles |

### The 128 battles that hit the cap (planner)
HP gap at the cap 32.5 points on average · last damage on average 0.3 turns before the cap · both teams above 50 % HP in 14 of them (a standoff, not a slow grind).

## cap80

| Pilot | median turns (p10–p90) | 100-turn cap | draws | class spread | strongest | weakest | verdict |
|---|---|---|---|---|---|---|---|
| planner | 66 (46–80) | 30.1% | 0 | 31.1pp | Kraken 67.6 | Leviathan 36.6 | misses targets |

| Class | planner win % |
|---|---|
| Bulwark | 43.5 ± 2.3 |
| Mantis | 66.9 ± 2.3 |
| Leviathan | 36.6 ± 2.3 |
| Tempest | 49.9 ± 2.3 |
| Specter | 61.9 ± 2.3 |
| Sentinel | 45.3 ± 2.3 |
| Reaver | 45.5 ± 2.3 |
| Abyss | 46.0 ± 2.3 |
| Kraken | 67.6 ± 2.3 |
| Ember | 36.7 ± 2.3 |

### Why — per lobster, per battle (planner)
| Class | turns | damage dealt | damage taken | kills | Specials | stuns landed | survives | lands the first hit |
|---|---|---|---|---|---|---|---|---|
| Bulwark | 12.6 | 553 | 585 | 0.53 | 1.84 | 0.00 | 58.4% | 1.6% of battles |
| Mantis | 8.4 | 717 | 542 | 0.66 | 1.47 | 0.00 | 23.7% | 10.3% of battles |
| Leviathan | 8.8 | 692 | 875 | 0.54 | 1.13 | 0.00 | 36.0% | 0.9% of battles |
| Tempest | 8.6 | 632 | 609 | 0.44 | 1.53 | 0.00 | 24.4% | 21.8% of battles |
| Specter | 13.8 | 580 | 398 | 0.56 | 2.71 | 0.00 | 54.8% | 30.3% of battles |
| Sentinel | 12.8 | 297 | 800 | 0.43 | 2.88 | 0.00 | 61.1% | 4.0% of battles |
| Reaver | 11.2 | 578 | 586 | 0.41 | 2.48 | 0.00 | 31.1% | 15.0% of battles |
| Abyss | 11.4 | 793 | 728 | 0.75 | 1.97 | 0.00 | 47.9% | 10.0% of battles |
| Kraken | 13.2 | 558 | 610 | 0.63 | 2.96 | 2.91 | 65.6% | 5.8% of battles |
| Ember | 4.8 | 228 | 571 | 0.31 | 0.59 | 0.00 | 6.3% | 0.5% of battles |

### The 241 battles that hit the cap (planner)
HP gap at the cap 33.1 points on average · last damage on average 0.4 turns before the cap · both teams above 50 % HP in 29 of them (a standoff, not a slow grind).

## ramp50x2

| Pilot | median turns (p10–p90) | 100-turn cap | draws | class spread | strongest | weakest | verdict |
|---|---|---|---|---|---|---|---|
| planner | 64 (46–90) | 5.3% | 0 | 31.2pp | Mantis 67.4 | Leviathan 36.2 | misses targets |

| Class | planner win % |
|---|---|
| Bulwark | 43.0 ± 2.3 |
| Mantis | 67.4 ± 2.3 |
| Leviathan | 36.2 ± 2.3 |
| Tempest | 49.1 ± 2.3 |
| Specter | 64.6 ± 2.3 |
| Sentinel | 42.8 ± 2.3 |
| Reaver | 46.6 ± 2.3 |
| Abyss | 46.0 ± 2.3 |
| Kraken | 67.0 ± 2.3 |
| Ember | 37.4 ± 2.3 |

### Why — per lobster, per battle (planner)
| Class | turns | damage dealt | damage taken | kills | Specials | stuns landed | survives | lands the first hit |
|---|---|---|---|---|---|---|---|---|
| Bulwark | 13.0 | 638 | 689 | 0.62 | 1.85 | 0.00 | 43.9% | 1.6% of battles |
| Mantis | 8.3 | 716 | 548 | 0.68 | 1.42 | 0.00 | 21.8% | 10.3% of battles |
| Leviathan | 8.8 | 733 | 911 | 0.61 | 1.14 | 0.00 | 29.5% | 0.9% of battles |
| Tempest | 8.6 | 644 | 611 | 0.48 | 1.52 | 0.00 | 24.6% | 21.8% of battles |
| Specter | 14.0 | 660 | 417 | 0.67 | 2.77 | 0.00 | 50.8% | 30.3% of battles |
| Sentinel | 13.5 | 355 | 961 | 0.53 | 3.03 | 0.00 | 43.2% | 4.0% of battles |
| Reaver | 11.1 | 590 | 591 | 0.43 | 2.46 | 0.00 | 30.7% | 15.0% of battles |
| Abyss | 11.7 | 887 | 795 | 0.85 | 2.00 | 0.00 | 38.4% | 10.0% of battles |
| Kraken | 13.4 | 632 | 661 | 0.74 | 2.96 | 2.90 | 57.8% | 5.8% of battles |
| Ember | 4.8 | 230 | 574 | 0.31 | 0.59 | 0.00 | 5.6% | 0.5% of battles |

### The 42 battles that hit the cap (planner)
HP gap at the cap 31.0 points on average · last damage on average 0.4 turns before the cap · both teams above 50 % HP in 2 of them (a standoff, not a slow grind).

## ramp40x3

| Pilot | median turns (p10–p90) | 100-turn cap | draws | class spread | strongest | weakest | verdict |
|---|---|---|---|---|---|---|---|
| planner | 61 (46–80) | 1.4% | 0 | 32.8pp | Mantis 67.8 | Leviathan 34.9 | misses targets |

| Class | planner win % |
|---|---|
| Bulwark | 44.3 ± 2.3 |
| Mantis | 67.8 ± 2.3 |
| Leviathan | 34.9 ± 2.3 |
| Tempest | 50.1 ± 2.3 |
| Specter | 64.6 ± 2.3 |
| Sentinel | 42.4 ± 2.3 |
| Reaver | 45.3 ± 2.3 |
| Abyss | 48.9 ± 2.3 |
| Kraken | 66.0 ± 2.3 |
| Ember | 35.7 ± 2.3 |

### Why — per lobster, per battle (planner)
| Class | turns | damage dealt | damage taken | kills | Specials | stuns landed | survives | lands the first hit |
|---|---|---|---|---|---|---|---|---|
| Bulwark | 11.9 | 667 | 701 | 0.69 | 1.70 | 0.00 | 43.9% | 1.6% of battles |
| Mantis | 8.2 | 729 | 543 | 0.70 | 1.40 | 0.00 | 22.9% | 10.3% of battles |
| Leviathan | 8.1 | 739 | 924 | 0.65 | 1.01 | 0.00 | 28.3% | 0.9% of battles |
| Tempest | 8.2 | 647 | 620 | 0.49 | 1.42 | 0.00 | 23.4% | 21.8% of battles |
| Specter | 13.1 | 671 | 419 | 0.68 | 2.56 | 0.00 | 50.8% | 30.3% of battles |
| Sentinel | 12.4 | 354 | 974 | 0.49 | 2.73 | 0.00 | 38.5% | 4.0% of battles |
| Reaver | 10.6 | 599 | 606 | 0.46 | 2.33 | 0.00 | 29.2% | 15.0% of battles |
| Abyss | 10.9 | 892 | 780 | 0.88 | 1.81 | 0.00 | 39.1% | 10.0% of battles |
| Kraken | 12.3 | 636 | 658 | 0.72 | 2.73 | 2.69 | 54.1% | 5.8% of battles |
| Ember | 4.7 | 231 | 574 | 0.29 | 0.58 | 0.00 | 5.2% | 0.5% of battles |

### The 11 battles that hit the cap (planner)
HP gap at the cap 41.0 points on average · last damage on average 0.0 turns before the cap · both teams above 50 % HP in 0 of them (a standoff, not a slow grind).

_Generated by `bun scripts/strong-balance.ts`._

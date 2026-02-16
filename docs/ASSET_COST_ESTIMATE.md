# Clawbada: Asset Production Cost Estimate

**Date**: February 2026
**Assumes**: AI-augmented design studio (generative AI for concepting/iteration, human artists for final polish, consistency, and bespoke work)

---

## Executive Summary

| Metric | Estimate |
|--------|----------|
| **Total unique assets** | ~1,260 |
| **Estimated cost range** | $45,000 - $75,000 |
| **Recommended target** | $40,000 - $55,000 (mid-tier AI-augmented studio) |
| **Timeline** | 8-12 weeks |
| **Team size** | 3-5 artists |

---

## Breakdown by Category

| Category | Assets | Traditional Estimate | AI-Augmented Estimate | Notes |
|----------|--------|---------------------|----------------------|-------|
| Class concepting | 10 design sheets | $4K-6K | $2K-4K | AI generates concepts fast; artists lock silhouettes and palettes |
| 960 body part PNGs | 960 files | $40K-60K | $15K-25K | Biggest AI savings. Batch-generate variants per affinity, artist does template setup + consistency/compositing QA. Cross-affinity layering constraint is the hard part — that's manual. |
| Evolution/Legend/Palette effects | 78 defs + overlays | $5K-8K | $3K-5K | Mostly shader/overlay definitions, some particle PNGs |
| Animations | 10 JSON defs | $5K-8K | $3K-5K | Frame transforms, not redraws — technical animation work |
| 20 Special VFX | 20 sprite sheets | $6K-10K | $4K-7K | Specialized VFX skill; AI helps less here |
| Status/Damage/Badges | ~30 small assets | $2K-4K | $1K-2K | Small, straightforward icon work |
| UI components + 8 backgrounds | ~50 assets | $12K-20K | $8K-14K | Backgrounds benefit from AI; UI elements need pixel-precision |
| Logos + 10 hero illustrations | 12 bespoke pieces | $10K-18K | $7K-12K | Least AI-reducible. Heroes need a real illustrator. Logos need iteration. |
| Social/favicon/graph | ~15 assets | $2K-3K | $1K-2K | Derivative of existing assets, fast |
| **Total** | **~1,260** | **$86K-137K** | **$44K-78K** | **~50% reduction with AI tooling** |

---

## Where AI Helps Most vs Least

### Massive Savings (50-70% Reduction)

- **960 body part variants** — Set up 60 base templates (6 parts x 10 affinities), AI generates 16 variants each, artist cleans up and ensures consistency
- **64 breed type palettes** — AI can generate color transforms almost instantly
- **Screen backgrounds** — AI-generate base compositions, artist paints over for coherence

### Moderate Savings (30-40%)

- **VFX sprite sheets** — AI helps with concepting, less with frame-by-frame sprite work
- **UI components** — AI can mockup layouts, but pixel-precision is manual

### Minimal Savings (<20%)

- **Cross-affinity compositing QA** — Someone has to manually verify that 960 parts layer cleanly in any combination. This is the hidden cost center.
- **Hero illustrations** — These sell the game; they need a real illustrator's hand
- **Logo design** — Iterative process with stakeholder feedback, AI can't shortcut much
- **Animation frame transforms** — Technical work, not generative

---

## The Hidden Cost: Compositing QA

The spec requires any of 160 variants per body part slot to work with any of 160 variants in every other slot. That's a combinatorial problem.

**Budget $3K-5K specifically** for a QA pass where someone composites hundreds of random combinations and flags gaps, z-order issues, and outline mismatches. This is easy to underestimate and should be called out as a separate line item in any studio contract.

Recommended QA approach:
1. Automated compositing script generates 500+ random lobster combinations
2. QA artist reviews rendered outputs for visual defects
3. Fix pass on flagged parts (typically 10-15% of parts need adjustment)
4. Re-run automated check to verify fixes

---

## Timeline Estimate

| Phase | Duration | Team | Dependencies |
|-------|----------|------|-------------|
| Concepting + class design | 2 weeks | 1 lead artist + AI | None — start here |
| Body part template setup | 1 week | 1-2 artists | Concepting complete |
| Body part variant production | 3-5 weeks | 2-3 artists + AI pipeline | Templates complete |
| VFX + animations | 3-4 weeks | 1 VFX artist | Class designs complete (parallel with body parts) |
| UI components + backgrounds | 3-4 weeks | 1 UI artist | Class designs complete (parallel with body parts) |
| Heroes + logos + brand | 2-3 weeks | 1 illustrator | Class designs complete (parallel with body parts) |
| Compositing QA + fixes | 1-2 weeks | 1 QA artist | All body parts complete |
| **Total (critical path)** | **8-12 weeks** | **3-5 artists** | |

**Critical path**: Concepting (2w) → Body part production (4-6w) → Compositing QA (1-2w) = **7-10 weeks minimum**

VFX, UI, heroes, and brand assets run in parallel with body part production.

---

## Phased Delivery by Priority Tier

Delivery can be phased to match the priority tiers defined in the asset spec. This lets the project ship earlier with core assets while polish items arrive later.

### Phase 1 — P0: Launch-Critical (~60% of total cost)

| Deliverable | Est. Cost |
|------------|-----------|
| 960 body part PNGs | $15K-25K |
| 4 evolution tier effects | $1K-2K |
| 10 class icons + 5 stat icons | $500-1K |
| Lobster card template + HP/damage bars | $500-1K |
| Logos (Clawbada + Studio) | $2K-4K |
| Favicons | $500 |
| **Phase 1 Total** | **$20K-34K** |
| **Timeline** | **6-8 weeks** |

### Phase 2 — P1: Full Gameplay (~30% of total cost)

| Deliverable | Est. Cost |
|------------|-----------|
| 20 Special move VFX | $4K-7K |
| 10 animation definitions | $3K-5K |
| 9 status effect icons + overlays | $1K-2K |
| 4 damage overlays + 5 state badges | $500-1K |
| Battle/Mining/Breeding/Marketplace UI | $5K-8K |
| 8 screen backgrounds | $3K-5K |
| **Phase 2 Total** | **$17K-28K** |
| **Timeline** | **4-6 weeks (parallel with Phase 1 tail)** |

### Phase 3 — P2: Polish & Marketing (~10% of total cost)

| Deliverable | Est. Cost |
|------------|-----------|
| 10 legend effect packs | $2K-3K |
| 64 breed type palettes + overlays | $1.5K-3K |
| 10 hero illustrations | $5K-8K |
| Social media assets | $1K-2K |
| Tournament graph | $500-1K |
| Purity display, tier badges | $500-1K |
| **Phase 3 Total** | **$11K-18K** |
| **Timeline** | **3-4 weeks** |

---

## Studio Tier Comparison

| Studio Tier | Expected Range | Pros | Cons |
|-------------|---------------|------|------|
| **Offshore AI-augmented** (SEA, Eastern Europe) | $30K-45K | Lowest cost, fast turnaround | May need more revision cycles, timezone challenges, potential consistency issues |
| **Mid-tier Western studio with AI tooling** | $50K-75K | Strong quality, experienced with game asset pipelines, responsive | Higher cost |
| **Premium game art studio** | $80K-120K+ | Top polish, dedicated project manager, proven AAA pipelines | Paying for overhead you may not need at this stage |

### Recommendation

For Clawbada's current stage (pre-launch, ~$20K total ETH budget), target the **$40K-55K range** with a mid-tier studio that has:

1. **Proven modular character experience** — they've built compositing systems before and understand the layering constraints
2. **AI-augmented pipeline** — not just marketing buzz, but actual integration of generative tools into their variant production workflow
3. **Game asset portfolio** — idle/battler/NFT game experience is a strong plus
4. **Willingness to phase delivery** — P0 first, P1/P2 as the project progresses

The phased approach lets you ship P0 (~$25K) to get the game playable, then fund P1 and P2 from early protocol revenue.

---

## Contract Recommendations

When negotiating with studios, consider:

- **Fixed price per phase** (not hourly) — reduces risk and aligns incentives
- **Compositing QA as a separate line item** — don't let it get buried in "body part production"
- **Revision caps** — 2-3 rounds per asset category is standard; more rounds = more cost
- **Source file delivery** — require layered PSD/AI files, not just flat PNGs, for future modifications
- **Style guide milestone** — pay for a small style guide deliverable (3-5 sample lobsters fully composited) before committing to the full 960 body part run
- **Kill clause** — if the style guide doesn't meet quality bar, ability to exit with partial payment

---

*This estimate is based on 2025-2026 market rates for AI-augmented game art studios. Actual quotes will vary based on studio location, availability, and project fit.*

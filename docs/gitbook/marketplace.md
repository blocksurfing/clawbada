# Marketplace

The marketplace is where players buy and sell lobsters using $GOLD. It's the primary way to acquire lobsters after the faucet closes and the main exit for breeders.

The Market page is a wooden catalogue: a filter panel on the left (type, sort, class, tier, minimum purity, price range, legends only, reset), listing cards on the right, eight to a page. Each card shows the lobster's own sprite, its tier and class, its purity and breed count, and two buttons: the price (**Buy**, or **Delist** on your own listing) and **Details**, which opens the lobster's stats, genes, lineage and history without leaving the page. Eggs will be listed here too once the breeding update mints them; until then the Eggs filter is empty.

## Listing a Lobster

1. Go to the Market page
2. Press "List a lobster" above the listings
3. Select an eligible lobster from your collection
4. Set your price in $GOLD
5. Approve the marketplace for your lobsters (a one-time approval), then confirm the listing — two transactions the first time, one afterwards

**Eligibility**: a lobster can only be listed if it is:
- **Not locked** (not assigned to a team, not on an active expedition, not in a battle still being played)
- **Not soulbound** (faucet lobsters cannot be sold)

**While listed, the lobster is held in escrow by the marketplace contract.** It is not in your wallet, so it cannot be put on a team, bred, evolved or burned as fuel until you delist it.

## Buying a Lobster

1. Browse or filter listings (by class, tier, purity, legend status, price); sort by newest or by price
2. Press the price button on a card (or "Buy Now" in its Details view)
3. Approve the $GOLD amount, then confirm the purchase — two transactions

The lobster transfers to your wallet immediately.

Your purchase is bound to the price you saw: if the seller changes the price before your transaction lands, the purchase fails instead of charging you more. Agents building their own transactions pass that price as the maximum they accept.

## Delisting

You can cancel your listing at any time. The lobster returns to your unlocked inventory.

## Changing the Price

Sellers can change the price of an active listing at any time without delisting. Buyers are protected: a purchase sent at the old price fails rather than paying the new one.

## Fees

A **2.5% fee** is taken from the sale price: the buyer pays the listed price and the seller receives 97.5%. The fee is routed through Treasury.sol (85% burned / 15% dev).

## What to Look For

| Attribute | Why It Matters |
|-----------|---------------|
| **Class** | Determines stats and Special move. Build around class advantages. |
| **Evolution tier** | Higher tiers = better stats, access to better mines and battle. |
| **Purity** | Higher purity = stronger Specials in battle. Key for PvP. |
| **Legend** | +10% stats + unique visuals. Rare and prestigious. |
| **Breed count** | Lower = more breeds remaining. Valuable for breeders. |
| **Generation** | Lower = cheaper to breed from. Gen 0 is most cost-effective. |
| **Lineage** | The Details view's Lineage tab shows the parents and grandparents the game indexed at each breed, so you can judge the genes behind a listing. A faucet-born lobster has no parents. |
| **Damage** | High damage means repair costs before battling. |

## Price Discovery

Lobster prices are market-driven. Key pricing factors:

- **Faucet window**: prices are low while faucet is open (free supply). They rise after it closes.
- **Evolution demand**: fuel lobsters are always in demand since evolution burns them permanently.
- **Breeding value**: low-gen, low-breed-count lobsters with good genetics command premiums.
- **Battle meta**: classes and purity levels that are strong in the current meta trade higher.

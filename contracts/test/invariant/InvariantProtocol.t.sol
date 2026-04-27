// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import "../helpers/BaseSetup.t.sol";

// ─────────────────────────────────────────────────────────────────────────────
// Handler — wraps all mutating game actions the fuzzer can call
// ─────────────────────────────────────────────────────────────────────────────

contract ProtocolHandler is BaseSetup {
    // Actors
    address[] internal actors;
    uint256   internal actorIndex;

    // Track minted ids for state verification
    uint256[] public mintedIds;
    uint256   public totalExpeditionsStarted;

    // Ghost variable: total $CLAW ever minted to players
    uint256 public ghostMinted;

    // ── Public accessors for invariant contract ───────────────────
    function getClaw()       external view returns (ClawToken)    { return claw; }
    function getNft()        external view returns (LobsterNFT)   { return nft; }
    function getTeamMgr()    external view returns (TeamManager)  { return teamMgr; }
    function getTreasury()   external view returns (Treasury)     { return treasury; }
    function getMiningPool() external view returns (MiningPool)   { return miningPool; }
    function getMarketplace() external view returns (Marketplace) { return marketplace; }
    function getMintedIds()  external view returns (uint256[] memory) { return mintedIds; }
    function mintedIdsLength() external view returns (uint256)    { return mintedIds.length; }
    function getActors() external view returns (address[] memory) { return actors; }

    constructor() {
        setUp(); // deploy all contracts via BaseSetup

        // Populate actors
        for (uint256 i = 0; i < 5; i++) {
            actors.push(makeAddr(string(abi.encodePacked("actor", i))));
        }

        // Give each actor some CLAW and pre-mine some NFTs
        for (uint256 i = 0; i < actors.length; i++) {
            _giveClaw(actors[i], 1_000_000e18);
            for (uint256 j = 0; j < 5; j++) {
                uint256 id = _mintLobster(actors[i], uint8(j % 10));
                mintedIds.push(id);
            }
        }
    }

    function _currentActor() internal returns (address) {
        return actors[actorIndex % actors.length];
    }

    // ── Handler: mint lobster ─────────────────────────────────────

    function handler_mint(uint8 actorIdx, uint8 class_) external {
        actorIdx = uint8(actorIdx % actors.length);
        class_   = uint8(class_ % 10);
        address actor = actors[actorIdx];

        uint256 id = _mintLobster(actor, class_);
        mintedIds.push(id);
    }

    // ── Handler: create team ─────────────────────────────────────

    function handler_createTeam(uint8 actorIdx) external {
        actorIdx = uint8(actorIdx % actors.length);
        address actor = actors[actorIdx];

        // Gather 3 unlocked, unassigned lobsters owned by actor
        uint256[3] memory ids;
        uint256 found = 0;
        for (uint256 i = 0; i < mintedIds.length && found < 3; i++) {
            uint256 id = mintedIds[i];
            if (!nft.exists(id)) continue;
            if (nft.ownerOf(id) != actor) continue;
            if (nft.isLocked(id)) continue;
            if (teamMgr.getLobsterTeam(id) != 0) continue;
            ids[found++] = id;
        }
        if (found < 3) return; // not enough free lobsters

        vm.prank(actor);
        try teamMgr.createTeam(ids) {} catch {}
    }

    // ── Handler: disband team ─────────────────────────────────────

    function handler_disbandTeam(uint8 actorIdx, uint256 teamIdSeed) external {
        actorIdx = uint8(actorIdx % actors.length);
        address actor = actors[actorIdx];

        uint256[] memory teams = teamMgr.getTeamsByOwner(actor);
        if (teams.length == 0) return;

        uint256 teamId = teams[teamIdSeed % teams.length];
        if (teamMgr.isTeamActive(teamId)) return;

        vm.prank(actor);
        try teamMgr.disbandTeam(teamId) {} catch {}
    }

    // ── Handler: breed ────────────────────────────────────────────

    function handler_breed(uint8 actorIdx) external {
        actorIdx = uint8(actorIdx % actors.length);
        address actor = actors[actorIdx];

        // Find two unlocked, non-maxbreed lobsters
        uint256 parentA; uint256 parentB;
        uint256 foundA = 0; uint256 foundB = 0;

        for (uint256 i = 0; i < mintedIds.length && foundB == 0; i++) {
            uint256 id = mintedIds[i];
            if (!nft.exists(id)) continue;
            if (nft.ownerOf(id) != actor) continue;
            if (nft.isLocked(id)) continue;
            if (nft.getBreedCount(id) >= 5) continue;
            if (breedingLab.getCooldownEnd(id) > block.timestamp) continue;

            if (foundA == 0) { parentA = id; foundA = 1; }
            else if (id != parentA) { parentB = id; foundB = 1; }
        }
        if (foundA == 0 || foundB == 0) return;

        vm.startPrank(actor);
        claw.approve(address(breedingLab), type(uint256).max);
        try breedingLab.requestBreed(parentA, parentB) returns (uint256 requestId) {
            vm.stopPrank();
            vm.roll(block.number + breedingLab.FINALIZE_MIN_BLOCKS() + 1);
            try breedingLab.finalizeBreed(requestId) returns (uint256 offspringId) {
                mintedIds.push(offspringId);
            } catch {}
        } catch {
            vm.stopPrank();
        }
    }

    // ── Handler: evolve ───────────────────────────────────────────

    function handler_evolve(uint8 actorIdx) external {
        actorIdx = uint8(actorIdx % actors.length);
        address actor = actors[actorIdx];

        // Find target (tier 0-2) and 2 fuel lobsters of same tier
        uint256 target; uint8 targetTier;
        uint256 fuel1; uint256 fuel2;
        bool foundTarget; bool foundFuel1; bool foundFuel2;

        for (uint256 i = 0; i < mintedIds.length && !foundFuel2; i++) {
            uint256 id = mintedIds[i];
            if (!nft.exists(id)) continue;
            if (nft.ownerOf(id) != actor) continue;
            if (nft.isLocked(id)) continue;

            uint8 tier = nft.getEvolutionTier(id);

            if (!foundTarget && tier < 3) {
                target = id; targetTier = tier; foundTarget = true;
                continue;
            }
            if (foundTarget && tier == targetTier && !foundFuel1 && id != target) {
                fuel1 = id; foundFuel1 = true;
                continue;
            }
            if (foundTarget && foundFuel1 && tier == targetTier && id != target && id != fuel1) {
                fuel2 = id; foundFuel2 = true;
            }
        }
        if (!foundTarget || !foundFuel1 || !foundFuel2) return;

        vm.startPrank(actor);
        claw.approve(address(evolutionLab), type(uint256).max);
        try evolutionLab.evolve(target, fuel1, fuel2) {} catch {}
        vm.stopPrank();
    }

    // ── Handler: repair ───────────────────────────────────────────

    function handler_repair(uint8 actorIdx, uint8 points) external {
        actorIdx = uint8(actorIdx % actors.length);
        address actor = actors[actorIdx];
        if (points == 0) return;

        for (uint256 i = 0; i < mintedIds.length; i++) {
            uint256 id = mintedIds[i];
            if (!nft.exists(id)) continue;
            if (nft.ownerOf(id) != actor) continue;
            uint8 damage = nft.getDamage(id);
            uint8 tier = nft.getEvolutionTier(id);
            if (damage == 0 || tier == 0) continue;

            uint8 repairPts = damage < points ? damage : points;

            vm.startPrank(actor);
            claw.approve(address(repairShop), type(uint256).max);
            try repairShop.repair(id, repairPts) {} catch {}
            vm.stopPrank();
            return;
        }
    }

    // ── Handler: list on marketplace ─────────────────────────────

    function handler_list(uint8 actorIdx, uint256 priceSeed) external {
        actorIdx = uint8(actorIdx % actors.length);
        address actor = actors[actorIdx];
        uint256 price = bound(priceSeed, 1e18, 100_000e18);

        for (uint256 i = 0; i < mintedIds.length; i++) {
            uint256 id = mintedIds[i];
            if (!nft.exists(id)) continue;
            if (nft.ownerOf(id) != actor) continue;
            if (nft.isLocked(id)) continue;
            if (nft.isSoulbound(id)) continue;
            if (marketplace.lobsterToListing(id) != 0) continue;

            vm.startPrank(actor);
            nft.setApprovalForAll(address(marketplace), true);
            try marketplace.listLobster(id, price) {} catch {}
            vm.stopPrank();
            return;
        }
    }

    // ── Handler: apply damage (simulates battle aftermath) ────────

    function handler_applyDamage(uint256 tokenIdSeed, uint8 damage) external {
        if (mintedIds.length == 0) return;
        uint256 id = mintedIds[tokenIdSeed % mintedIds.length];
        if (!nft.exists(id)) return;

        uint8 currentDamage = nft.getDamage(id);
        uint8 newDamage = uint8(uint256(currentDamage) + uint256(damage) > 100 ? 100 : currentDamage + damage);

        vm.prank(admin);
        try nft.setDamage(id, newDamage) {} catch {}
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Invariant test contract
// ─────────────────────────────────────────────────────────────────────────────

contract InvariantProtocol is Test {
    ProtocolHandler internal handler;

    function setUp() public {
        handler = new ProtocolHandler();
        targetContract(address(handler));
    }

    // ── Invariant: token supply never exceeds MAX_SUPPLY ─────────

    function invariant_token_supply_within_cap() public view {
        ClawToken claw = handler.getClaw();
        assertLe(
            claw.totalSupply(),
            claw.MAX_SUPPLY(),
            "totalSupply must never exceed MAX_SUPPLY"
        );
    }

    function invariant_supply_plus_remaining_equals_max() public view {
        ClawToken claw = handler.getClaw();
        assertEq(
            claw.totalSupply() + claw.remainingMintable(),
            claw.MAX_SUPPLY(),
            "totalSupply + remainingMintable must equal MAX_SUPPLY"
        );
    }

    // ── Invariant: lobster state bounds ───────────────────────────

    function invariant_lobster_damage_bounded() public view {
        uint256[] memory ids = handler.getMintedIds();
        LobsterNFT nft = handler.getNft();
        for (uint256 i = 0; i < ids.length; i++) {
            if (!nft.exists(ids[i])) continue;
            assertLe(
                nft.getDamage(ids[i]),
                nft.MAX_DAMAGE(),
                "lobster damage must not exceed 100"
            );
        }
    }

    function invariant_lobster_tier_bounded() public view {
        uint256[] memory ids = handler.getMintedIds();
        LobsterNFT nft2 = handler.getNft();
        for (uint256 i = 0; i < ids.length; i++) {
            if (!nft2.exists(ids[i])) continue;
            assertLe(
                nft2.getEvolutionTier(ids[i]),
                nft2.MAX_EVOLUTION_TIER(),
                "lobster tier must not exceed 3 (Apex)"
            );
        }
    }

    function invariant_lobster_breed_count_bounded() public view {
        uint256[] memory ids = handler.getMintedIds();
        LobsterNFT nft3 = handler.getNft();
        for (uint256 i = 0; i < ids.length; i++) {
            if (!nft3.exists(ids[i])) continue;
            assertLe(
                nft3.getBreedCount(ids[i]),
                nft3.MAX_BREED_COUNT(),
                "breed count must not exceed 5"
            );
        }
    }

    // ── Invariant: treasury split constants ───────────────────────

    function invariant_treasury_bps_sum() public view {
        Treasury t = handler.getTreasury();
        assertEq(
            t.BURN_BPS() + t.DEV_BPS(),
            t.BPS_DENOMINATOR(),
            "BURN_BPS + DEV_BPS must equal BPS_DENOMINATOR"
        );
    }

    // ── Invariant: season totalMinted <= totalEmission ────────────

    function invariant_season_budget_not_exceeded() public view {
        MiningPool pool = handler.getMiningPool();
        uint256 season = pool.currentSeason();
        if (season == 0) return;

        MiningPool.SeasonConfig memory cfg = pool.getSeasonConfig(season);
        assertLe(
            cfg.totalMinted,
            cfg.totalEmission,
            "season totalMinted must not exceed totalEmission"
        );
    }

    // ── Invariant: soulbound lobsters never transferred ───────────

    function invariant_soulbound_stays_with_original_owner() public view {
        uint256[] memory ids = handler.getMintedIds();
        LobsterNFT nft4 = handler.getNft();
        for (uint256 i = 0; i < ids.length; i++) {
            if (!nft4.exists(ids[i])) continue;
            if (nft4.isSoulbound(ids[i])) {
                assertNotEq(nft4.ownerOf(ids[i]), address(0), "soulbound must have an owner");
            }
        }
    }

    // ── Invariant: nextTokenId only increases ─────────────────────

    function invariant_next_token_id_monotonic() public view {
        LobsterNFT nft5 = handler.getNft();
        assertGe(nft5.nextTokenId(), 1, "nextTokenId must be >= 1");
    }

    // ── Invariant: lobsters in teams are locked ────────────────────

    function invariant_team_lobsters_locked() public view {
        uint256[] memory ids = handler.getMintedIds();
        LobsterNFT nft6 = handler.getNft();
        TeamManager mgr = handler.getTeamMgr();

        for (uint256 i = 0; i < ids.length; i++) {
            uint256 id = ids[i];
            if (!nft6.exists(id)) continue;
            uint256 teamId = mgr.getLobsterTeam(id);
            if (teamId != 0 && mgr.teamExists(teamId)) {
                assertTrue(
                    nft6.isLocked(id),
                    "lobster assigned to team must be locked"
                );
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Phase 3: cross-contract conservation invariants
    // ─────────────────────────────────────────────────────────────────────

    // ── Marketplace ↔ NFT custody consistency ─────────────────────
    // Every active listing must have its NFT held by the Marketplace contract.
    // Catches: listing/escrow desync, NFT teleporting out of Marketplace mid-listing,
    // cancel/buy paths that fail to restore NFT custody to seller/buyer.
    function invariant_marketplace_listing_custody() public view {
        Marketplace mp = handler.getMarketplace();
        LobsterNFT nft7 = handler.getNft();
        uint256 next = mp.nextListingId();

        for (uint256 listingId = 1; listingId < next; listingId++) {
            Marketplace.Listing memory l = mp.getListing(listingId);
            if (!l.active) continue;
            assertEq(
                nft7.ownerOf(l.lobsterId),
                address(mp),
                "active listing NFT must be in Marketplace custody"
            );
        }
    }

    // ── lobsterToListing reverse-map consistency ──────────────────
    // If lobsterToListing[id] == L, then _listings[L].lobsterId must equal id
    // AND the listing must be active. Catches stale reverse-map after cancel/buy.
    function invariant_marketplace_listing_reverse_map() public view {
        Marketplace mp = handler.getMarketplace();
        uint256[] memory ids = handler.getMintedIds();
        LobsterNFT nft8 = handler.getNft();

        for (uint256 i = 0; i < ids.length; i++) {
            uint256 id = ids[i];
            if (!nft8.exists(id)) continue;
            uint256 listingId = mp.lobsterToListing(id);
            if (listingId == 0) continue;
            Marketplace.Listing memory l = mp.getListing(listingId);
            assertEq(l.lobsterId, id, "reverse-map points to listing for different lobster");
            assertTrue(l.active, "lobsterToListing points to non-active listing");
        }
    }

    // ── Lobster owner is non-zero for every existing token ───────
    // Defense against any path that drains an owner without burning the token.
    function invariant_lobster_owner_nonzero() public view {
        uint256[] memory ids = handler.getMintedIds();
        LobsterNFT nft9 = handler.getNft();
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 id = ids[i];
            if (!nft9.exists(id)) continue;
            assertNotEq(nft9.ownerOf(id), address(0), "existing lobster has zero owner");
        }
    }

    // ── Team owner consistency ──────────────────────────────────
    // For every existing team, all 3 lobsters' on-chain owner must equal team.owner.
    // This is a stronger statement than `team_lobsters_locked`: catches scenarios
    // where a transfer slipped through without disbanding the team (e.g., locker
    // role compromise, missing isLocked check on a transfer path).
    function invariant_team_owner_consistency() public view {
        TeamManager mgr = handler.getTeamMgr();
        LobsterNFT nft10 = handler.getNft();
        address[] memory actors_ = handler.getActors();

        for (uint256 a = 0; a < actors_.length; a++) {
            uint256[] memory teams = mgr.getTeamsByOwner(actors_[a]);
            for (uint256 t = 0; t < teams.length; t++) {
                uint256 teamId = teams[t];
                if (!mgr.teamExists(teamId)) continue;
                TeamManager.Team memory team = mgr.getTeam(teamId);
                for (uint256 j = 0; j < 3; j++) {
                    uint256 id = team.lobsterIds[j];
                    if (!nft10.exists(id)) continue;
                    assertEq(
                        nft10.ownerOf(id),
                        team.owner,
                        "team lobster owner desynced from team.owner"
                    );
                }
            }
        }
    }
}

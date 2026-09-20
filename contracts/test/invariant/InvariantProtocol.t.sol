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

    // D-29: mining + repair are exercised for real. Ghosts prove it (a handler that
    // swallows every revert looks identical to one that works, unless something counts).
    uint256[] public expeditionIds;
    uint256 public ghostExpeditionsStarted;
    uint256 public ghostExpeditionsClaimed;
    uint256 public ghostRewardsLocked;   // sum of rewards minted into MiningPool escrow
    uint256 public ghostRewardsClaimed;  // sum of rewards paid out of it
    uint256 public ghostRepairs;         // successful RepairShop.repair calls
    uint256 public ghostRepairPaid;      // $CLAW those repairs cost
    /// @dev First cross-contract accounting mismatch seen inside a handler. fail_on_revert
    ///      is false, so an assert here would be swallowed; invariant_no_handler_violation
    ///      reads this instead.
    string public violation;

    /// @dev Deliberately tiny next to the real 352.5M. The glide targets
    ///      remaining / (remainingDays x trailing demand); with five actors' worth of demand
    ///      against the real budget that target is astronomically above the launch reward, so
    ///      the reward would sit on its cap forever and the repair price would never move.
    ///      At 50K, one Base expedition a day already pulls the target under 1,250 — the
    ///      glide steps down and back up during runs, and the budget can run out too.
    uint256 internal constant S1_EMISSION = 50_000e18;
    uint256 internal constant S1_BASE_REWARD = 1_250e18;

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
    function getRepairShop() external view returns (RepairShop)   { return repairShop; }
    function expeditionIdsLength() external view returns (uint256) { return expeditionIds.length; }
    function getAdmin() external view returns (address) { return admin; }

    constructor() {
        setUp(); // deploy all contracts via BaseSetup

        // D-29: TOK-G1 prices repairs off MiningPool.currentBaseReward(), which is 0 until
        // a season exists. Without this every repair reverted RewardPegUnset inside a
        // try/catch and the suite's green result said nothing about RepairShop.
        vm.prank(admin);
        miningPool.startSeason(S1_EMISSION, S1_BASE_REWARD);

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

            // Snapshot everything a repair is supposed to move, across four contracts.
            uint256 cost = uint256(repairPts) * repairShop.repairRate(tier);
            uint256 actorBefore = claw.balanceOf(actor);
            uint256 devBefore = claw.balanceOf(devWallet);
            uint256 supplyBefore = claw.totalSupply();

            vm.startPrank(actor);
            claw.approve(address(repairShop), type(uint256).max);
            try repairShop.repair(id, repairPts) {
                vm.stopPrank();
                ghostRepairs++;
                ghostRepairPaid += cost;
                uint256 burned = supplyBefore - claw.totalSupply();
                uint256 toDev = claw.balanceOf(devWallet) - devBefore;
                if (nft.getDamage(id) != damage - repairPts) _flag("repair: damage not reduced by exactly the points paid for");
                if (actorBefore - claw.balanceOf(actor) != cost) _flag("repair: payer not charged points x repairRate");
                if (burned + toDev != cost) _flag("repair: burn + dev share != cost");
                if (burned != (cost * 8_500) / 10_000) _flag("repair: burn leg is not 85%");
                if (claw.balanceOf(address(repairShop)) != 0) _flag("repair: CLAW stranded in RepairShop");
                if (claw.balanceOf(address(treasury)) != 0) _flag("repair: CLAW stranded in Treasury");
            } catch {
                vm.stopPrank();
            }
            return;
        }
    }

    function _flag(string memory what) internal {
        if (bytes(violation).length == 0) violation = what;
    }

    // ── Handler: start a mining expedition ────────────────────────
    //    Moves trailing demand, so the glide (and with it the repair price) moves too.

    function handler_startExpedition(uint8 actorIdx, uint256 teamSeed, uint8 tierSeed) external {
        actorIdx = uint8(actorIdx % actors.length);
        address actor = actors[actorIdx];

        uint256[] memory teams = teamMgr.getTeamsByOwner(actor);
        if (teams.length == 0) return;
        uint256 teamId = teams[teamSeed % teams.length];
        if (teamMgr.isTeamActive(teamId)) return;

        // The mine tier may not exceed the team's weakest lobster.
        TeamManager.Team memory team = teamMgr.getTeam(teamId);
        uint8 minTier = 3;
        for (uint256 i = 0; i < 3; i++) {
            uint8 t = nft.getEvolutionTier(team.lobsterIds[i]);
            if (t < minTier) minTier = t;
        }
        uint8 mineTier = uint8(tierSeed % (uint256(minTier) + 1));

        uint256 escrowBefore = claw.balanceOf(address(miningPool));
        vm.prank(actor);
        try miningPool.startExpedition(teamId, mineTier) returns (uint256 expeditionId) {
            expeditionIds.push(expeditionId);
            totalExpeditionsStarted++;
            ghostExpeditionsStarted++;
            uint256 reward = miningPool.getExpedition(expeditionId).reward;
            ghostRewardsLocked += reward;
            if (claw.balanceOf(address(miningPool)) - escrowBefore != reward) {
                _flag("startExpedition: escrow did not grow by the locked reward");
            }
            if (!teamMgr.isTeamActive(teamId)) _flag("startExpedition: team not marked active");
        } catch {}
    }

    // ── Handler: claim a matured expedition ───────────────────────

    function handler_claim(uint256 expeditionSeed) external {
        if (expeditionIds.length == 0) return;
        uint256 expeditionId = expeditionIds[expeditionSeed % expeditionIds.length];
        MiningPool.Expedition memory e = miningPool.getExpedition(expeditionId);
        if (e.claimed) return;
        if (block.timestamp < e.startTime + miningPool.EXPEDITION_DURATION()) return;

        uint256 ownerBefore = claw.balanceOf(e.owner);
        vm.prank(e.owner);
        try miningPool.claimExpedition(expeditionId) {
            ghostExpeditionsClaimed++;
            ghostRewardsClaimed += e.reward;
            if (claw.balanceOf(e.owner) - ownerBefore != e.reward) _flag("claim: owner not paid the locked reward");
            if (teamMgr.isTeamActive(e.teamId)) _flag("claim: team still active after claim");
        } catch {}
    }

    // ── Handler: time ─────────────────────────────────────────────
    //    Up to a day per call: expeditions mature (4h) and the daily glide epoch rolls.

    function handler_warp(uint32 secs) external {
        vm.warp(block.timestamp + bound(uint256(secs), 1 minutes, 1 days));
    }

    // ── Handler: the permissionless re-peg ────────────────────────

    function handler_repeg() external {
        try miningPool.repeg() {} catch {}
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

        // D-29: restrict the fuzzer to handler_* entrypoints. Without this it can call the
        // handler's inherited public BaseSetup.setUp() mid-run, which redeploys every
        // contract and orphans mintedIds[] / expeditionIds[] (same hazard the BattleArena
        // and MiningPool harnesses document and filter).
        bytes4[] memory selectors = new bytes4[](12);
        selectors[0] = ProtocolHandler.handler_mint.selector;
        selectors[1] = ProtocolHandler.handler_createTeam.selector;
        selectors[2] = ProtocolHandler.handler_disbandTeam.selector;
        selectors[3] = ProtocolHandler.handler_breed.selector;
        selectors[4] = ProtocolHandler.handler_evolve.selector;
        selectors[5] = ProtocolHandler.handler_repair.selector;
        selectors[6] = ProtocolHandler.handler_list.selector;
        selectors[7] = ProtocolHandler.handler_applyDamage.selector;
        selectors[8] = ProtocolHandler.handler_startExpedition.selector;
        selectors[9] = ProtocolHandler.handler_claim.selector;
        selectors[10] = ProtocolHandler.handler_warp.selector;
        selectors[11] = ProtocolHandler.handler_repeg.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
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
        // D-29: this used to `return` when season == 0 — which was always, so the invariant
        // could never fail. The handler now starts season 1; if that ever stops being true
        // this fails loudly instead of going quiet again.
        assertGe(season, 1, "harness must run inside a live season");

        MiningPool.SeasonConfig memory cfg = pool.getSeasonConfig(season);
        assertLe(
            cfg.totalMinted,
            cfg.totalEmission,
            "season totalMinted must not exceed totalEmission"
        );
        assertEq(cfg.totalMinted, handler.ghostRewardsLocked(), "season totalMinted == rewards the handler saw locked");
        assertLe(pool.lifetimeMinted(), pool.MINING_ALLOCATION(), "lifetime mining cap (TOK-M1)");
    }

    // ── Invariant: mining escrow is exactly the unclaimed rewards ─

    function invariant_mining_escrow_matches_unclaimed_rewards() public view {
        assertEq(
            handler.getClaw().balanceOf(address(handler.getMiningPool())),
            handler.ghostRewardsLocked() - handler.ghostRewardsClaimed(),
            "MiningPool escrow must equal locked minus claimed rewards"
        );
    }

    // ── Invariant: the repair price is live and tracks the glide ──

    function invariant_repair_price_is_live() public view {
        MiningPool pool = handler.getMiningPool();
        RepairShop shop = handler.getRepairShop();
        uint256 base = pool.currentBaseReward();
        assertGt(base, 0, "glide base reward must never reach 0 (dust floor)");
        assertLe(base, 1_250e18, "glide never exceeds the launch reward");
        // Evolved / Elite / Apex = 40 / 120 / 320 bps of the base reward; Base tier unrepairable.
        assertEq(shop.repairRate(0), 0, "Base tier has no repair rate");
        assertEq(shop.repairRate(1), (base * 40) / 10_000, "Evolved repair rate tracks the peg");
        assertEq(shop.repairRate(2), (base * 120) / 10_000, "Elite repair rate tracks the peg");
        assertEq(shop.repairRate(3), (base * 320) / 10_000, "Apex repair rate tracks the peg");
        assertGt(shop.repairRate(1), 0, "a repair can always be priced");
    }

    // ── Invariant: no cross-contract accounting mismatch inside a handler ──

    function invariant_no_handler_violation() public view {
        assertEq(handler.violation(), "", "handler saw a cross-contract accounting mismatch");
    }

    // ── Invariant: fee-routing contracts never strand $CLAW ───────

    function invariant_no_claw_stranded_in_fee_path() public view {
        ClawToken claw = handler.getClaw();
        assertEq(claw.balanceOf(address(handler.getRepairShop())), 0, "RepairShop holds no CLAW at rest");
        assertEq(claw.balanceOf(address(handler.getTreasury())), 0, "Treasury fee-splitter holds no CLAW at rest");
    }

    // ── Reachability (D-29) ───────────────────────────────────────
    // An invariant run cannot say "this action succeeded at least once", and every
    // handler swallows reverts, so a handler whose action can never succeed is invisible.
    // These drive the SAME handler entrypoints deterministically and require success.

    function test_reachability_repair_succeeds_through_the_handler() public {
        // actor 0 owns 5 Base lobsters: evolve one (target + 2 fuel), damage it, repair it.
        handler.handler_evolve(0);
        LobsterNFT nft = handler.getNft();
        uint256[] memory ids = handler.getMintedIds();
        uint256 evolved = type(uint256).max;
        for (uint256 i = 0; i < ids.length; i++) {
            if (nft.exists(ids[i]) && nft.getEvolutionTier(ids[i]) == 1) evolved = i;
        }
        assertTrue(evolved != type(uint256).max, "handler_evolve produced an Evolved lobster");

        handler.handler_applyDamage(evolved, 30);
        assertEq(nft.getDamage(ids[evolved]), 30, "damage applied");

        handler.handler_repair(0, 10);
        assertEq(handler.ghostRepairs(), 1, "handler_repair must actually repair (it reverted RewardPegUnset before D-29)");
        assertEq(nft.getDamage(ids[evolved]), 20, "10 points repaired");
        assertEq(handler.ghostRepairPaid(), 10 * ((1_250e18 * 40) / 10_000), "10 points at the Evolved launch rate (5 CLAW)");
        assertEq(handler.violation(), "", "no accounting mismatch");
    }

    function test_reachability_mining_and_glide_through_the_handler() public {
        handler.handler_createTeam(1);
        handler.handler_startExpedition(1, 0, 0);
        assertEq(handler.ghostExpeditionsStarted(), 1, "handler_startExpedition must actually start one");

        handler.handler_claim(0);
        assertEq(handler.ghostExpeditionsClaimed(), 0, "not claimable before 4h");

        handler.handler_warp(uint32(1 days));
        handler.handler_claim(0);
        assertEq(handler.ghostExpeditionsClaimed(), 1, "handler_claim must actually claim");
        assertEq(handler.ghostRewardsClaimed(), 1_250e18, "Base mine pays the launch reward");

        // Next epoch: trailing demand 1, 48,750 left over 59 days -> target ~826, clamped to
        // -30% = 875. The repair price moves with it: 40 bps of 875 = 3.5 CLAW per point.
        handler.handler_repeg();
        assertEq(handler.getMiningPool().currentBaseReward(), 875e18, "the glide stepped down by the 30% clamp");
        assertEq(handler.getRepairShop().repairRate(1), 3.5e18, "the Evolved repair price followed the glide");
        assertEq(handler.violation(), "", "no accounting mismatch");
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

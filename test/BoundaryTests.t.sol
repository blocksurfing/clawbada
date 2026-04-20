// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

// Contracts
import {ClawToken} from "../contracts/ClawToken.sol";
import {LobsterNFT} from "../contracts/LobsterNFT.sol";
import {Treasury} from "../contracts/Treasury.sol";
import {TeamManager} from "../contracts/TeamManager.sol";
import {MiningPool} from "../contracts/MiningPool.sol";
import {BreedingLab} from "../contracts/BreedingLab.sol";
import {EvolutionLab} from "../contracts/EvolutionLab.sol";
import {RepairShop} from "../contracts/RepairShop.sol";
import {Marketplace} from "../contracts/Marketplace.sol";
import {BattleArena} from "../contracts/BattleArena.sol";
import {BattleVRF} from "../contracts/BattleVRF.sol";
import {Faucet} from "../contracts/Faucet.sol";

// Libraries
import {DNALib} from "../contracts/libraries/DNALib.sol";
import {BattleResolver} from "../contracts/libraries/BattleResolver.sol";

/// @dev Expose DNALib internals for boundary testing.
contract DNABoundaryHarness {
    function encode(uint8 class_, uint8 legend, uint8 breedType, uint8[18] memory alleles)
        external
        pure
        returns (uint256)
    {
        return DNALib.encode(class_, legend, breedType, alleles);
    }

    function decodeClass(uint256 dna) external pure returns (uint8) {
        return DNALib.decodeClass(dna);
    }

    function decodeLegend(uint256 dna) external pure returns (uint8) {
        return DNALib.decodeLegend(dna);
    }

    function decodeBodyPart(uint256 dna, uint8 slot) external pure returns (uint8, uint8, uint8) {
        return DNALib.decodeBodyPart(dna, slot);
    }

    function decodeAllele(uint8 allele) external pure returns (uint8, uint8) {
        return DNALib.decodeAllele(allele);
    }

    function calculatePurity(uint256 dna) external pure returns (uint8) {
        return DNALib.calculatePurity(dna);
    }

    function isValid(uint256 dna) external pure returns (bool) {
        return DNALib.isValid(dna);
    }
}

/// @dev Expose BattleResolver internals for boundary testing.
contract ResolverBoundaryHarness {
    function getBaseStats(uint8 classId) external pure returns (BattleResolver.Stats memory) {
        return BattleResolver.getBaseStats(classId);
    }

    function scaleStats(BattleResolver.Stats memory base, uint8 tier, bool legend)
        external
        pure
        returns (BattleResolver.Stats memory)
    {
        return BattleResolver.scaleStats(base, tier, legend);
    }

    function getClassAdvantage(uint8 atkClass, uint8 defClass) external pure returns (uint256) {
        return BattleResolver.getClassAdvantage(atkClass, defClass);
    }

    function calculateAttackDamage(uint256 atk, uint256 armor, uint256 classMult, bool isCrit, uint256 vrfRoll)
        external
        pure
        returns (uint256)
    {
        return BattleResolver.calculateAttackDamage(atk, armor, classMult, isCrit, vrfRoll);
    }

    function calculateDefendCounter(uint256 atk, uint256 armor, uint256 classMult, uint256 vrfRoll)
        external
        pure
        returns (uint256)
    {
        return BattleResolver.calculateDefendCounter(atk, armor, classMult, vrfRoll);
    }

    function calculateSpecialDamage(
        uint256 basePower,
        uint256 atk,
        uint256 armor,
        uint256 classMult,
        uint8 purity,
        uint256 vrfRoll
    ) external pure returns (uint256) {
        return BattleResolver.calculateSpecialDamage(basePower, atk, armor, classMult, purity, vrfRoll);
    }

    function critChance(uint256 critStat) external pure returns (uint256) {
        return BattleResolver.critChance(critStat);
    }

    function getSpecialBasePower(uint8 classId) external pure returns (uint256) {
        return BattleResolver.getSpecialBasePower(classId);
    }

    function enhancedProcChance(uint8 purity) external pure returns (uint256) {
        return BattleResolver.enhancedProcChance(purity);
    }
}

/// @title BoundaryTests — Exact boundary and edge-case coverage across all Clawbada contracts
/// @notice Tests off-by-one conditions, exact thresholds, and cross-contract boundary interactions.
contract BoundaryTests is Test {
    // ──────────── Contracts ────────────
    ClawToken claw;
    LobsterNFT nft;
    Treasury treasury;
    TeamManager tm;
    MiningPool pool;
    BreedingLab breeding;
    EvolutionLab evolution;
    RepairShop repair;
    Marketplace market;
    BattleArena arena;
    BattleVRF vrf;
    Faucet faucet;
    DNABoundaryHarness dnaHarness;
    ResolverBoundaryHarness resolverHarness;

    // ──────────── Actors ────────────
    address admin = makeAddr("admin");
    address devWallet = makeAddr("devWallet");
    address lpAddress = makeAddr("lpAddress");
    address seasonAdmin = makeAddr("seasonAdmin");
    address matchmaker = makeAddr("matchmaker");
    address resolver = makeAddr("resolver");
    address eligibilityAdmin = makeAddr("eligibilityAdmin");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 validDNA;
    uint256 constant S1_EMISSION = 352_500_000e18;
    uint256 constant BASE_REWARD = 1_250e18;
    uint256 constant STAKE_LOW = 2_500e18;
    uint256 constant STAKE_MID = 10_000e18;
    uint256 constant STAKE_HIGH = 50_000e18;

    function setUp() public {
        vm.startPrank(admin);

        // Deploy core contracts
        nft = new LobsterNFT(admin, "https://api.clawbada.com/lobster/");
        treasury = new Treasury(admin, devWallet);
        claw = new ClawToken(admin, lpAddress, address(treasury));
        treasury.setClawToken(address(claw));
        tm = new TeamManager(admin, address(nft));
        vrf = new BattleVRF(admin);
        pool = new MiningPool(admin, address(claw), address(nft), address(tm));
        breeding = new BreedingLab(address(claw), address(nft), address(treasury));
        evolution = new EvolutionLab(address(claw), address(nft), address(treasury));
        repair = new RepairShop(address(claw), address(nft), address(treasury));
        market = new Marketplace(address(claw), address(nft), address(treasury));
        arena = new BattleArena(
            admin, address(claw), address(nft), address(tm), address(treasury), address(vrf)
        );

        // Faucet with 7-day window
        faucet = new Faucet(admin, address(nft), address(claw), block.timestamp + 7 days);

        // Grant all required roles
        nft.grantRole(nft.MINTER_ROLE(), admin);
        nft.grantRole(nft.MINTER_ROLE(), address(breeding));
        nft.grantRole(nft.MINTER_ROLE(), address(faucet));
        nft.grantRole(nft.LOCKER_ROLE(), address(tm));
        nft.grantRole(nft.EVOLVER_ROLE(), admin);
        nft.grantRole(nft.EVOLVER_ROLE(), address(evolution));
        nft.grantRole(nft.DAMAGE_ROLE(), admin);
        nft.grantRole(nft.DAMAGE_ROLE(), address(arena));
        nft.grantRole(nft.DAMAGE_ROLE(), address(repair));
        nft.grantRole(nft.BURNER_ROLE(), address(evolution));
        nft.grantRole(nft.BREED_ROLE(), address(breeding));

        tm.grantRole(tm.ACTIVITY_ROLE(), address(pool));
        tm.grantRole(tm.ACTIVITY_ROLE(), address(arena));

        claw.grantRole(claw.MINTER_ROLE(), address(pool));
        claw.grantRole(claw.MINTER_ROLE(), address(faucet));

        pool.grantRole(pool.SEASON_ADMIN_ROLE(), seasonAdmin);
        arena.grantRole(arena.MATCHMAKER_ROLE(), matchmaker);
        arena.grantRole(arena.RESOLVER_ROLE(), resolver);
        vrf.grantRole(vrf.OPERATOR_ROLE(), admin);
        faucet.grantRole(faucet.ELIGIBILITY_ROLE(), eligibilityAdmin);

        treasury.setAuthorized(address(breeding), true);
        treasury.setAuthorized(address(evolution), true);
        treasury.setAuthorized(address(repair), true);
        treasury.setAuthorized(address(market), true);
        treasury.setAuthorized(address(arena), true);

        vm.stopPrank();

        // Build valid DNA
        uint8[18] memory alleles;
        for (uint256 i = 0; i < 18; i++) {
            alleles[i] = 0x37; // affinity=3, variant=7
        }
        validDNA = DNALib.encode(3, 0, 5, alleles);

        // Deploy library harnesses
        dnaHarness = new DNABoundaryHarness();
        resolverHarness = new ResolverBoundaryHarness();

        // Fund actors
        vm.prank(lpAddress);
        claw.transfer(alice, 500_000e18);
        vm.prank(lpAddress);
        claw.transfer(bob, 500_000e18);

        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
    }

    // ──────────── Shared Helpers ────────────

    function _mintLobster(address to) internal returns (uint256) {
        vm.prank(admin);
        return nft.mint(to, validDNA, false);
    }

    function _mintLobsterAtTier(address to, uint8 tier) internal returns (uint256) {
        uint256 id = _mintLobster(to);
        if (tier > 0) {
            vm.prank(admin);
            nft.setEvolutionTier(id, tier);
        }
        return id;
    }

    function _createTeam(address owner, uint8 tier) internal returns (uint256) {
        uint256 a = _mintLobsterAtTier(owner, tier);
        uint256 b = _mintLobsterAtTier(owner, tier);
        uint256 c = _mintLobsterAtTier(owner, tier);
        vm.prank(owner);
        return tm.createTeam([a, b, c]);
    }

    function _setDamage(uint256 id, uint8 dmg) internal {
        vm.prank(admin);
        nft.setDamage(id, dmg);
    }

    function _startSeason() internal {
        vm.prank(seasonAdmin);
        pool.startSeason(S1_EMISSION, BASE_REWARD);
    }

    function _startSeasonWith(uint256 emission, uint256 baseReward) internal {
        vm.prank(seasonAdmin);
        pool.startSeason(emission, baseReward);
    }

    // ════════════════════════════════════════════════════════════════
    // 1. LobsterNFT — Damage, tier, breed count exact boundaries
    // ════════════════════════════════════════════════════════════════

    function test_boundary_damageExactly100Succeeds() public {
        uint256 id = _mintLobster(alice);
        vm.prank(admin);
        nft.setDamage(id, 100); // MAX_DAMAGE = 100
        assertEq(nft.getDamage(id), 100);
    }

    function test_boundary_damageFrom100BackToZero() public {
        uint256 id = _mintLobster(alice);
        _setDamage(id, 100);
        vm.prank(admin);
        nft.setDamage(id, 0);
        assertEq(nft.getDamage(id), 0);
    }

    function test_boundary_evolutionTierExactly3Succeeds() public {
        uint256 id = _mintLobster(alice);
        vm.prank(admin);
        nft.setEvolutionTier(id, 3); // MAX_EVOLUTION_TIER = 3
        assertEq(nft.getEvolutionTier(id), 3);
    }

    function test_boundary_breedCountReachesExactly5() public {
        uint256 id = _mintLobster(alice);
        vm.startPrank(address(breeding));
        for (uint256 i = 0; i < 5; i++) {
            nft.incrementBreedCount(id);
        }
        vm.stopPrank();
        assertEq(nft.getBreedCount(id), 5);
    }

    function test_boundary_burnSoulboundAllowed() public {
        vm.prank(admin);
        uint256 id = nft.mint(alice, validDNA, true);
        assertTrue(nft.isSoulbound(id));

        // Soulbound lobster can be burned (used as evolution fuel)
        vm.prank(address(evolution));
        nft.burn(id);
        assertFalse(nft.exists(id));
    }

    // ════════════════════════════════════════════════════════════════
    // 2. MiningPool — Expedition duration & season boundary tests
    // ════════════════════════════════════════════════════════════════

    function test_boundary_claimAtExactDuration() public {
        uint256 teamId = _createTeam(alice, 0);
        _startSeason();

        vm.prank(alice);
        uint256 expId = pool.startExpedition(teamId, 0);

        uint256 startTime = block.timestamp;

        // Exactly at duration: should succeed (check is block.timestamp < startTime + DURATION)
        vm.warp(startTime + 4 hours);
        vm.prank(alice);
        pool.claimExpedition(expId);

        assertEq(claw.balanceOf(alice), 500_000e18 + BASE_REWARD);
    }

    function test_boundary_claimOneSecondBeforeDurationReverts() public {
        uint256 teamId = _createTeam(alice, 0);
        _startSeason();

        vm.prank(alice);
        uint256 expId = pool.startExpedition(teamId, 0);

        uint256 startTime = block.timestamp;

        // 1 second before duration: should revert
        vm.warp(startTime + 4 hours - 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MiningPool.ExpeditionNotComplete.selector, expId));
        pool.claimExpedition(expId);
    }

    function test_boundary_seasonExpiryExactBoundary() public {
        _startSeason();
        uint256 seasonStart = block.timestamp;

        // At exactly 60 days: season is NOT active (check: block.timestamp >= startTime + SEASON_DURATION)
        vm.warp(seasonStart + 60 days);

        uint256 teamId = _createTeam(alice, 0);
        vm.prank(alice);
        vm.expectRevert(MiningPool.SeasonNotActive.selector);
        pool.startExpedition(teamId, 0);
    }

    function test_boundary_seasonActiveOneSecondBefore() public {
        _startSeason();
        uint256 seasonStart = block.timestamp;

        // 1 second before expiry: still active
        vm.warp(seasonStart + 60 days - 1);

        uint256 teamId = _createTeam(alice, 0);
        vm.prank(alice);
        pool.startExpedition(teamId, 0); // should succeed
    }

    function test_boundary_claimAfterSeasonEnds() public {
        uint256 teamId = _createTeam(alice, 0);
        _startSeason();

        vm.prank(alice);
        uint256 expId = pool.startExpedition(teamId, 0);

        // Warp past both expedition duration AND season end
        vm.warp(block.timestamp + 60 days + 1);

        // Claim should still work — reward was locked at start, claim doesn't check active season
        vm.prank(alice);
        pool.claimExpedition(expId);

        assertEq(claw.balanceOf(alice), 500_000e18 + BASE_REWARD);
    }

    function test_boundary_startNewSeasonAtExactExpiry() public {
        _startSeason();
        uint256 seasonStart = block.timestamp;

        // At exactly 60 days, can start a new season
        vm.warp(seasonStart + 60 days);
        vm.prank(seasonAdmin);
        pool.startSeason(S1_EMISSION / 2, BASE_REWARD);
        assertEq(pool.currentSeason(), 2);
    }

    function test_boundary_startNewSeasonOneSecondEarlyReverts() public {
        _startSeason();
        uint256 seasonStart = block.timestamp;

        vm.warp(seasonStart + 60 days - 1);
        vm.prank(seasonAdmin);
        vm.expectRevert(MiningPool.SeasonStillActive.selector);
        pool.startSeason(S1_EMISSION / 2, BASE_REWARD);
    }

    function test_boundary_budgetRemainingLessThanBaseReward() public {
        // Budget = 500, base reward = 1,250 → can't even start 1 expedition
        _startSeasonWith(500e18, BASE_REWARD);

        uint256 teamId = _createTeam(alice, 0);
        vm.prank(alice);
        vm.expectRevert(MiningPool.SeasonBudgetExhausted.selector);
        pool.startExpedition(teamId, 0);
    }

    function test_boundary_mixedTierTeamInHigherMineReverts() public {
        // 2 Evolved + 1 Base trying to enter Evolved mine — Base lobster fails gate
        vm.startPrank(admin);
        uint256 lob1 = nft.mint(alice, validDNA, false);
        nft.setEvolutionTier(lob1, 1);
        uint256 lob2 = nft.mint(alice, validDNA, false);
        nft.setEvolutionTier(lob2, 1);
        uint256 lob3 = nft.mint(alice, validDNA, false); // Base tier (0)
        vm.stopPrank();

        vm.prank(alice);
        uint256 teamId = tm.createTeam([lob1, lob2, lob3]);

        _startSeason();

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MiningPool.TierRequirementNotMet.selector, lob3, 1, 0));
        pool.startExpedition(teamId, 1);
    }

    function test_boundary_apexMineFullLifecycle() public {
        uint256 teamId = _createTeam(alice, 3); // Apex
        _startSeason();

        vm.prank(alice);
        uint256 expId = pool.startExpedition(teamId, 3);

        MiningPool.Expedition memory exp = pool.getExpedition(expId);
        assertEq(exp.reward, BASE_REWARD * 25); // 31,250 $CLAW

        vm.warp(block.timestamp + 4 hours);

        vm.prank(alice);
        pool.claimExpedition(expId);

        assertEq(claw.balanceOf(alice), 500_000e18 + BASE_REWARD * 25);
    }

    // ════════════════════════════════════════════════════════════════
    // 3. BattleArena — Damage 79/80 threshold, stake brackets, timeout
    // ════════════════════════════════════════════════════════════════

    function test_boundary_damage79CanEnterBattle() public {
        // MAX_DAMAGE_FOR_BATTLE = 79, check: damage > MAX → damage=79 should pass
        vm.startPrank(admin);
        uint256 lob1 = nft.mint(alice, validDNA, false);
        nft.setEvolutionTier(lob1, 1);
        nft.setDamage(lob1, 79);
        uint256 lob2 = nft.mint(alice, validDNA, false);
        nft.setEvolutionTier(lob2, 1);
        uint256 lob3 = nft.mint(alice, validDNA, false);
        nft.setEvolutionTier(lob3, 1);
        vm.stopPrank();

        vm.prank(alice);
        uint256 teamIdA = tm.createTeam([lob1, lob2, lob3]);

        uint256 teamIdB = _createTeam(bob, 1);

        vm.prank(matchmaker);
        uint256 battleId = arena.createBattle(alice, bob, STAKE_LOW);

        _depositBothBattle(battleId);

        bytes32 saltA = bytes32("saltA");
        bytes32 saltB = bytes32("saltB");
        bytes32 commitA = keccak256(abi.encodePacked(battleId, alice, teamIdA, saltA));
        bytes32 commitB = keccak256(abi.encodePacked(battleId, bob, teamIdB, saltB));

        vm.prank(alice);
        arena.commitTeam(battleId, commitA);
        vm.prank(bob);
        arena.commitTeam(battleId, commitB);

        // Reveal should succeed with damage=79
        vm.prank(alice);
        arena.revealTeam(battleId, teamIdA, saltA);
        vm.prank(bob);
        arena.revealTeam(battleId, teamIdB, saltB);

        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertTrue(b.phase == BattleArena.BattlePhase.Active);
    }

    function test_boundary_damage80CannotEnterBattle() public {
        vm.startPrank(admin);
        uint256 lob1 = nft.mint(alice, validDNA, false);
        nft.setEvolutionTier(lob1, 1);
        nft.setDamage(lob1, 80); // Over MAX_DAMAGE_FOR_BATTLE
        uint256 lob2 = nft.mint(alice, validDNA, false);
        nft.setEvolutionTier(lob2, 1);
        uint256 lob3 = nft.mint(alice, validDNA, false);
        nft.setEvolutionTier(lob3, 1);
        vm.stopPrank();

        vm.prank(alice);
        uint256 teamIdA = tm.createTeam([lob1, lob2, lob3]);

        uint256 teamIdB = _createTeam(bob, 1);

        vm.prank(matchmaker);
        uint256 battleId = arena.createBattle(alice, bob, STAKE_LOW);

        _depositBothBattle(battleId);

        bytes32 saltA = bytes32("saltA");
        bytes32 saltB = bytes32("saltB");
        bytes32 commitA = keccak256(abi.encodePacked(battleId, alice, teamIdA, saltA));
        bytes32 commitB = keccak256(abi.encodePacked(battleId, bob, teamIdB, saltB));

        vm.prank(alice);
        arena.commitTeam(battleId, commitA);
        vm.prank(bob);
        arena.commitTeam(battleId, commitB);

        // Reveal should REVERT — damage 80 > MAX_DAMAGE_FOR_BATTLE (79)
        vm.expectRevert(abi.encodeWithSelector(BattleArena.LobsterDamageTooHigh.selector, lob1, 80));
        vm.prank(alice);
        arena.revealTeam(battleId, teamIdA, saltA);
    }

    function test_boundary_allThreeStakeBracketsCreateBattle() public {
        // Verify all three stake brackets are valid for battle creation
        vm.startPrank(matchmaker);
        uint256 b1 = arena.createBattle(alice, bob, STAKE_LOW);
        uint256 b2 = arena.createBattle(alice, bob, STAKE_MID);
        uint256 b3 = arena.createBattle(alice, bob, STAKE_HIGH);
        vm.stopPrank();

        assertEq(arena.getBattle(b1).stakeAmount, STAKE_LOW);
        assertEq(arena.getBattle(b2).stakeAmount, STAKE_MID);
        assertEq(arena.getBattle(b3).stakeAmount, STAKE_HIGH);
    }

    function test_boundary_settleWithPlayerBAsWinner() public {
        (uint256 battleId,,) = _setupActiveBattle();

        bytes memory movesA = hex"010203";
        bytes memory movesB = hex"040506";
        (bytes32 sA, bytes32 sB) = _commitBattleMoves(battleId, movesA, movesB);
        _revealBattleMoves(battleId, movesA, movesB, sA, sB);

        uint256 bobBalBefore = claw.balanceOf(bob);
        uint256 antiGrief = STAKE_LOW * 500 / 10_000;
        uint256 combinedPot = STAKE_LOW * 2;
        uint256 protocolFee = combinedPot * 1000 / 10_000;
        uint256 winnerPayout = combinedPot - protocolFee;

        // Bob wins (not alice) — H-01: settle proposes, finalize pays
        vm.prank(resolver);
        arena.settle(battleId, bob, [uint8(10), 5, 8], [uint8(30), 25, 35]);
        vm.warp(block.timestamp + arena.DISPUTE_WINDOW() + 1);
        arena.finalizeBattle(battleId);

        assertEq(claw.balanceOf(bob), bobBalBefore + winnerPayout + antiGrief);
        assertEq(arena.getBattle(battleId).winner, bob);
    }

    function test_boundary_settleDamageCapsAt100() public {
        (uint256 battleId, uint256 teamIdA,) = _setupActiveBattle();

        // Set existing damage on team A's first lobster
        TeamManager.Team memory teamA = tm.getTeam(teamIdA);
        _setDamage(teamA.lobsterIds[0], 90);

        bytes memory movesA = hex"010203";
        bytes memory movesB = hex"040506";
        (bytes32 sA, bytes32 sB) = _commitBattleMoves(battleId, movesA, movesB);
        _revealBattleMoves(battleId, movesA, movesB, sA, sB);

        // Settle with 15 more damage → 90 + 15 = 105, but should cap at 100
        // H-01: damage application now happens in finalizeBattle, not settle
        vm.prank(resolver);
        arena.settle(battleId, alice, [uint8(15), 5, 8], [uint8(30), 25, 35]);
        vm.warp(block.timestamp + arena.DISPUTE_WINDOW() + 1);
        arena.finalizeBattle(battleId);

        assertEq(nft.getDamage(teamA.lobsterIds[0]), 100); // capped
        assertEq(nft.getDamage(teamA.lobsterIds[1]), 5);
    }

    function test_boundary_settleInvalidWinnerReverts() public {
        (uint256 battleId,,) = _setupActiveBattle();

        bytes memory movesA = hex"010203";
        bytes memory movesB = hex"040506";
        (bytes32 sA, bytes32 sB) = _commitBattleMoves(battleId, movesA, movesB);
        _revealBattleMoves(battleId, movesA, movesB, sA, sB);

        address nobody = makeAddr("nobody");
        vm.prank(resolver);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidWinner.selector, battleId));
        arena.settle(battleId, nobody, [uint8(10), 5, 8], [uint8(30), 25, 35]);
    }

    // ════════════════════════════════════════════════════════════════
    // 4. RepairShop — Boundary repair amounts, battle re-entry
    // ════════════════════════════════════════════════════════════════

    function test_boundary_repairSinglePoint() public {
        uint256 id = _mintLobsterAtTier(alice, 1); // Evolved
        _setDamage(id, 50);

        uint256 cost = 1 * 5e18; // 1 point at Evolved rate
        vm.prank(alice);
        claw.approve(address(repair), cost);
        vm.prank(alice);
        repair.repair(id, 1);

        assertEq(nft.getDamage(id), 49);
    }

    function test_boundary_repairMaxDamageAtApex() public {
        uint256 id = _mintLobsterAtTier(alice, 3); // Apex
        _setDamage(id, 100);

        uint256 cost = 100 * 40e18; // 4,000 $CLAW — max possible repair cost
        vm.prank(alice);
        claw.approve(address(repair), cost);
        vm.prank(alice);
        repair.repair(id, 100);

        assertEq(nft.getDamage(id), 0);
    }

    function test_boundary_repairTo80StillBlocksBattle() public {
        uint256 id = _mintLobsterAtTier(alice, 1);
        _setDamage(id, 90);

        // Repair 10 points → damage = 80, still over MAX_DAMAGE_FOR_BATTLE (79)
        uint256 cost = 10 * 5e18;
        vm.prank(alice);
        claw.approve(address(repair), cost);
        vm.prank(alice);
        repair.repair(id, 10);

        assertEq(nft.getDamage(id), 80);
        // damage > 79, would be rejected at battle reveal
    }

    function test_boundary_repairTo79AllowsBattle() public {
        uint256 id = _mintLobsterAtTier(alice, 1);
        _setDamage(id, 90);

        // Repair 11 points → damage = 79, exactly at MAX_DAMAGE_FOR_BATTLE
        uint256 cost = 11 * 5e18;
        vm.prank(alice);
        claw.approve(address(repair), cost);
        vm.prank(alice);
        repair.repair(id, 11);

        assertEq(nft.getDamage(id), 79);
        // damage <= 79, would be accepted at battle reveal
    }

    // ════════════════════════════════════════════════════════════════
    // 5. BreedingLab — Cooldown boundary, asymmetric breed counts
    // ════════════════════════════════════════════════════════════════

    function test_boundary_breedOneParentAtMaxOtherAtZero() public {
        // Parent A: 4 breeds done (one left). Parent B: 0 breeds.
        uint256 a = _mintLobster(alice);
        uint256 b = _mintLobster(alice);

        // Use a dummy to breed A 4 times
        uint256 dummy = _mintLobster(alice);

        vm.startPrank(alice);
        claw.approve(address(breeding), 100_000e18);
        for (uint256 i = 0; i < 4; i++) {
            uint256 rid = breeding.requestBreed(a, dummy);
            vm.roll(block.number + 3);
            breeding.finalizeBreed(rid);
            vm.warp(block.timestamp + 48 hours + 1);
        }

        // A has breedCount=4, B has breedCount=0
        assertEq(nft.getBreedCount(a), 4);
        assertEq(nft.getBreedCount(b), 0);

        // 5th breed of A with B should succeed
        uint256 rid5 = breeding.requestBreed(a, b);
        vm.roll(block.number + 3);
        breeding.finalizeBreed(rid5);
        assertEq(nft.getBreedCount(a), 5);
        assertEq(nft.getBreedCount(b), 1);

        vm.warp(block.timestamp + 48 hours + 1);

        // 6th breed of A should revert
        vm.expectRevert(abi.encodeWithSelector(BreedingLab.BreedLimitReached.selector, a));
        breeding.requestBreed(a, b);
        vm.stopPrank();
    }

    // ════════════════════════════════════════════════════════════════
    // 6. Marketplace — Low price fee boundary
    // ════════════════════════════════════════════════════════════════

    function test_boundary_marketplaceLowPriceZeroFee_rejected() public {
        // T-05 (2026-04-20): pre-fix, price=39 produced fee=0 which was
        // silently skipped, and the listing was buyable with no protocol
        // fee. Post-fix, the listing is rejected at listLobster time
        // because price < MIN_LISTING_PRICE. This makes the marketplace's
        // fee contract honest: every sale pays the 2.5% protocol fee.
        uint256 id = _mintLobster(alice);
        vm.prank(alice);
        nft.setApprovalForAll(address(market), true);

        vm.expectRevert(
            abi.encodeWithSelector(Marketplace.PriceBelowMinimum.selector, 39, market.MIN_LISTING_PRICE())
        );
        vm.prank(alice);
        market.listLobster(id, 39);
    }

    function test_boundary_marketplace_dustPriceList_reverts() public {
        // T-05 (2026-04-20): Marketplace rejects listings cheap enough to
        // produce a sub-Treasury-minimum fee at list time, rather than
        // letting the listing land and then fail on buy. Pre-fix: price=40
        // listed fine, fee=1, buyLobster reverted AmountBelowMinimum.
        // Post-fix: listLobster reverts PriceBelowMinimum immediately.
        uint256 id = _mintLobster(alice);
        vm.prank(alice);
        nft.setApprovalForAll(address(market), true);

        vm.expectRevert(
            abi.encodeWithSelector(Marketplace.PriceBelowMinimum.selector, 40, market.MIN_LISTING_PRICE())
        );
        vm.prank(alice);
        market.listLobster(id, 40);
    }

    // Marketplace listings large enough to produce fee >= 10_000 wei still
    // settle normally. Min listing price for marketplace: fee_rate × price
    // = 0.025 × price >= 10_000 → price >= 400_000. At 18-decimal CLAW
    // this is 4e-13 CLAW, well below any realistic listing.
    function test_boundary_marketplaceMinPriceAtTreasuryMin() public {
        uint256 minPrice = 400_000; // yields fee = 10_000 exactly
        uint256 id = _mintLobster(alice);
        vm.prank(alice);
        nft.setApprovalForAll(address(market), true);
        vm.prank(alice);
        uint256 listingId = market.listLobster(id, minPrice);

        vm.prank(bob);
        claw.approve(address(market), minPrice);

        vm.prank(bob);
        market.buyLobster(listingId);

        assertEq(nft.ownerOf(id), bob);
    }

    // ════════════════════════════════════════════════════════════════
    // 7. DNALib — Bit boundary tests
    // ════════════════════════════════════════════════════════════════

    function test_boundary_dnaMaxClassValue() public view {
        // Class 9 (max valid) encodes/decodes correctly
        uint8[18] memory alleles;
        for (uint256 i = 0; i < 18; i++) {
            alleles[i] = 0x97; // affinity=9, variant=7
        }
        uint256 dna = dnaHarness.encode(9, 0, 0, alleles);
        assertEq(dnaHarness.decodeClass(dna), 9);
        assertTrue(dnaHarness.isValid(dna));
    }

    function test_boundary_dnaMaxAllelesRoundtrip() public view {
        // All 18 alleles at max values: affinity=9, variant=15 = 0x9F
        uint8[18] memory alleles;
        for (uint256 i = 0; i < 18; i++) {
            alleles[i] = 0x9F;
        }
        uint256 dna = dnaHarness.encode(9, 1, 63, alleles);

        assertEq(dnaHarness.decodeClass(dna), 9);
        assertEq(dnaHarness.decodeLegend(dna), 1);

        for (uint8 slot = 0; slot < 6; slot++) {
            (uint8 d, uint8 r1, uint8 r2) = dnaHarness.decodeBodyPart(dna, slot);
            (uint8 dAff, uint8 dVar) = dnaHarness.decodeAllele(d);
            assertEq(dAff, 9);
            assertEq(dVar, 15);
            (uint8 r1Aff, uint8 r1Var) = dnaHarness.decodeAllele(r1);
            assertEq(r1Aff, 9);
            assertEq(r1Var, 15);
            (uint8 r2Aff, uint8 r2Var) = dnaHarness.decodeAllele(r2);
            assertEq(r2Aff, 9);
            assertEq(r2Var, 15);
        }
    }

    function test_boundary_dnaZeroIsValid() public view {
        // DNA=0 has class=0 (valid), legend=0 (valid), all alleles 0x00 (affinity=0, valid)
        assertTrue(dnaHarness.isValid(0));
        assertEq(dnaHarness.decodeClass(0), 0);
        assertEq(dnaHarness.calculatePurity(0), 6); // all affinities=0 match class=0
    }

    function test_boundary_purityIntermediateValues() public view {
        // Test purity scores 1, 2, 4, 5 (not just 0, 3, 6)
        for (uint8 target = 0; target <= 6; target++) {
            uint8[18] memory alleles;
            uint8 otherAffinity = 1; // different from class 0
            for (uint256 i = 0; i < 18; i++) {
                alleles[i] = (otherAffinity << 4) | 0x05;
            }
            // Set `target` dominant alleles (indices 0,3,6,9,12,15) to class 0
            for (uint256 i = 0; i < target; i++) {
                alleles[i * 3] = 0x0A; // affinity=0, variant=10
            }
            uint256 dna = dnaHarness.encode(0, 0, 0, alleles);
            assertEq(dnaHarness.calculatePurity(dna), target);
        }
    }

    // ════════════════════════════════════════════════════════════════
    // 8. BattleResolver — Exhaustive class advantage, VRF, stat ratio
    // ════════════════════════════════════════════════════════════════

    function test_boundary_classAdvantageExhaustive10x10() public view {
        // Verify all 100 pairs match circulant graph:
        // diff 1-4 = ADV (1250), diff 5 = NEUTRAL (1000), diff 6-9 = DISADV (800), diff 0 = NEUTRAL
        for (uint8 atk = 0; atk < 10; atk++) {
            for (uint8 def = 0; def < 10; def++) {
                uint256 mult = resolverHarness.getClassAdvantage(atk, def);
                uint256 diff = (10 + def - atk) % 10;
                if (diff == 0) {
                    assertEq(mult, 1000, "same class should be neutral");
                } else if (diff >= 1 && diff <= 4) {
                    assertEq(mult, 1250, "should be advantage");
                } else if (diff == 5) {
                    assertEq(mult, 1000, "opposite should be neutral");
                } else {
                    assertEq(mult, 800, "should be disadvantage");
                }
            }
        }
    }

    function test_boundary_attackDamageVRFMinMax() public view {
        // VRF at minimum (850) and maximum (1150)
        uint256 dmgMin = resolverHarness.calculateAttackDamage(100, 100, 1000, false, 850);
        uint256 dmgMax = resolverHarness.calculateAttackDamage(100, 100, 1000, false, 1150);

        // 100 × 1.0 × 1.0 × 1.0 × 0.85 = 85
        assertEq(dmgMin, 85);
        // 100 × 1.0 × 1.0 × 1.0 × 1.15 = 115
        assertEq(dmgMax, 115);
    }

    function test_boundary_statRatioExactlyCap() public view {
        // atk/armor = 2.2 exactly → 220/100 = 2200/1000 = cap
        uint256 dmg = resolverHarness.calculateAttackDamage(220, 100, 1000, false, 1000);
        // 100 × 2.2 × 1.0 × 1.0 × 1.0 = 220
        assertEq(dmg, 220);
    }

    function test_boundary_statRatioJustUnderCap() public view {
        // atk/armor = 2.19 → 219/100 = 2190/1000, under cap
        uint256 dmg = resolverHarness.calculateAttackDamage(219, 100, 1000, false, 1000);
        // 100 × 2.19 × 1.0 × 1.0 × 1.0 = 219
        assertEq(dmg, 219);
    }

    function test_boundary_statRatioJustOverCap() public view {
        // atk/armor = 2.21 → 221/100 = 2210/1000, capped to 2200
        uint256 dmg = resolverHarness.calculateAttackDamage(221, 100, 1000, false, 1000);
        // 100 × 2.2 (capped) × 1.0 × 1.0 × 1.0 = 220
        assertEq(dmg, 220);
    }

    function test_boundary_statRatioArmorZeroReturnsCap() public view {
        // S-03 fix: armor=0 should return cap (2200), not revert
        uint256 dmg = resolverHarness.calculateAttackDamage(100, 0, 1000, false, 1000);
        // 100 × 2.2 (capped) × 1.0 × 1.0 × 1.0 = 220
        assertEq(dmg, 220);
    }

    function test_boundary_specialDamageWithZeroBasePower() public view {
        // Bulwark/Sentinel have basePower=0 (utility specials)
        uint256 dmg = resolverHarness.calculateSpecialDamage(0, 100, 100, 1000, 6, 1000);
        assertEq(dmg, 0);
    }

    function test_boundary_allPurityEnhancedProcValues() public view {
        // Test all valid purity values 0-6
        uint256[7] memory expected = [uint256(500), 1000, 1500, 2000, 2500, 3000, 3500];
        for (uint8 p = 0; p <= 6; p++) {
            assertEq(resolverHarness.enhancedProcChance(p), expected[p]);
        }
    }

    function test_boundary_scaleStatsAllTierLegendCombinations() public view {
        BattleResolver.Stats memory base = resolverHarness.getBaseStats(0); // Bulwark

        // tier=0, legend=false
        BattleResolver.Stats memory s = resolverHarness.scaleStats(base, 0, false);
        assertEq(s.attack, 70);

        // tier=0, legend=true
        s = resolverHarness.scaleStats(base, 0, true);
        assertEq(s.attack, 70 * 1100 / 1000); // 77

        // tier=1, legend=true (Evolved+Legend)
        s = resolverHarness.scaleStats(base, 1, true);
        assertEq(s.attack, uint256(70) * 1200 * 1100 / (1000 * 1000)); // 92

        // tier=2, legend=false (Elite)
        s = resolverHarness.scaleStats(base, 2, false);
        assertEq(s.attack, uint256(70) * 1400 / 1000); // 98

        // tier=2, legend=true (Elite+Legend)
        s = resolverHarness.scaleStats(base, 2, true);
        assertEq(s.attack, uint256(70) * 1400 * 1100 / (1000 * 1000)); // 107

        // tier=3, legend=false (Apex)
        s = resolverHarness.scaleStats(base, 3, false);
        assertEq(s.attack, uint256(70) * 1600 / 1000); // 112

        // tier=3, legend=true (Apex+Legend)
        s = resolverHarness.scaleStats(base, 3, true);
        assertEq(s.attack, uint256(70) * 1600 * 1100 / (1000 * 1000)); // 123
    }

    function test_boundary_defendCounterAtCap() public view {
        // Counter damage when atk/armor exceeds 2.2 → capped
        uint256 dmg = resolverHarness.calculateDefendCounter(500, 100, 1000, 1000);
        // 30 × 2.2 (capped) × 1.0 × 1.0 = 66
        assertEq(dmg, 66);
    }

    function test_boundary_critChanceHighValue() public view {
        // Very high crit stat approaches 100%
        uint256 chance = resolverHarness.critChance(10_000);
        // 10000 × 10000 / (10000 + 200) = 9803 BPS (~98%)
        assertEq(chance, 9803);
    }

    // ════════════════════════════════════════════════════════════════
    // 9. ClawToken — Supply boundary
    // ════════════════════════════════════════════════════════════════

    function test_boundary_mintExactly1WhenOnly1Remains() public {
        // Mint to 1 wei below max, then mint exactly 1
        uint256 remaining = claw.remainingMintable();
        bytes32 minterRole = claw.MINTER_ROLE();
        vm.prank(admin);
        claw.grantRole(minterRole, admin);

        // Mint all but 1
        vm.prank(admin);
        claw.mint(alice, remaining - 1);

        assertEq(claw.remainingMintable(), 1);

        // Mint exactly 1 more
        vm.prank(admin);
        claw.mint(alice, 1);

        assertEq(claw.remainingMintable(), 0);
        assertEq(claw.totalSupply(), claw.MAX_SUPPLY());
    }

    function test_boundary_burnThenRemintToMax() public {
        bytes32 minterRole = claw.MINTER_ROLE();
        vm.prank(admin);
        claw.grantRole(minterRole, admin);

        uint256 remaining = claw.remainingMintable();
        vm.prank(admin);
        claw.mint(alice, remaining);

        assertEq(claw.remainingMintable(), 0);

        // Burn some
        vm.prank(alice);
        claw.burn(1_000e18);

        // remainingMintable should reflect burned amount
        assertEq(claw.remainingMintable(), 1_000e18);

        // Can mint again
        vm.prank(admin);
        claw.mint(bob, 1_000e18);

        assertEq(claw.remainingMintable(), 0);
    }

    // ════════════════════════════════════════════════════════════════
    // 10. EvolutionLab — Target==fuelId2, full chain, Treasury routing
    // ════════════════════════════════════════════════════════════════

    function test_boundary_evolveSameLobsterAsFuelId2Reverts() public {
        uint256 target = _mintLobster(alice);
        uint256 fuel1 = _mintLobster(alice);

        vm.prank(alice);
        claw.approve(address(evolution), 10_000e18);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(EvolutionLab.DuplicateId.selector, target));
        evolution.evolve(target, fuel1, target); // target == fuelId2
    }

    function test_boundary_evolveFullChainBaseToApex() public {
        // Create 8 base lobsters for fuel (2 per tier transition × 3 tiers = 6 + target + extras)
        uint256[] memory bases = new uint256[](9);
        for (uint256 i = 0; i < 9; i++) {
            bases[i] = _mintLobster(alice);
        }

        uint256 target = bases[0];

        vm.startPrank(alice);
        claw.approve(address(evolution), 200_000e18);

        // Base → Evolved (needs 2 Base fuel + 2,000 $CLAW)
        evolution.evolve(target, bases[1], bases[2]);
        assertEq(nft.getEvolutionTier(target), 1);

        // Create 2 evolved fuel
        uint256 fuel1 = bases[3];
        uint256 fuel2 = bases[4];
        vm.stopPrank();
        vm.prank(admin);
        nft.setEvolutionTier(fuel1, 1);
        vm.prank(admin);
        nft.setEvolutionTier(fuel2, 1);
        vm.startPrank(alice);

        // Evolved → Elite (needs 2 Evolved fuel + 10,000 $CLAW)
        evolution.evolve(target, fuel1, fuel2);
        assertEq(nft.getEvolutionTier(target), 2);

        // Create 2 elite fuel
        uint256 fuel3 = bases[5];
        uint256 fuel4 = bases[6];
        vm.stopPrank();
        vm.prank(admin);
        nft.setEvolutionTier(fuel3, 2);
        vm.prank(admin);
        nft.setEvolutionTier(fuel4, 2);
        vm.startPrank(alice);

        // Elite → Apex (needs 2 Elite fuel + 50,000 $CLAW)
        evolution.evolve(target, fuel3, fuel4);
        assertEq(nft.getEvolutionTier(target), 3);

        vm.stopPrank();
    }

    // ════════════════════════════════════════════════════════════════
    // 11. TeamManager — Duplicate lobster edge cases
    // ════════════════════════════════════════════════════════════════

    function test_boundary_createTeamDuplicatePositions12() public {
        uint256 lob1 = _mintLobster(alice);
        uint256 lob2 = _mintLobster(alice);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TeamManager.DuplicateLobster.selector, lob2));
        tm.createTeam([lob1, lob2, lob2]);
    }

    function test_boundary_createTeamAllThreeSame() public {
        uint256 lob = _mintLobster(alice);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TeamManager.DuplicateLobster.selector, lob));
        tm.createTeam([lob, lob, lob]);
    }

    function test_boundary_disbandLastTeamInArray() public {
        // Create 3 teams, disband the last one (no swap needed, only pop)
        uint256 t1 = _createTeam(alice, 0);
        uint256 t2 = _createTeam(alice, 0);
        uint256 t3 = _createTeam(alice, 0);

        uint256[] memory teamsBefore = tm.getTeamsByOwner(alice);
        assertEq(teamsBefore.length, 3);

        vm.prank(alice);
        tm.disbandTeam(t3);

        uint256[] memory teamsAfter = tm.getTeamsByOwner(alice);
        assertEq(teamsAfter.length, 2);
        assertEq(teamsAfter[0], t1);
        assertEq(teamsAfter[1], t2);
    }

    function test_boundary_disbandFirstTeamSwapsCorrectly() public {
        uint256 t1 = _createTeam(alice, 0);
        uint256 t2 = _createTeam(alice, 0);
        uint256 t3 = _createTeam(alice, 0);

        // Disband first — last should swap in
        vm.prank(alice);
        tm.disbandTeam(t1);

        uint256[] memory teamsAfter = tm.getTeamsByOwner(alice);
        assertEq(teamsAfter.length, 2);
        // t3 should have swapped into position 0
        assertEq(teamsAfter[0], t3);
        assertEq(teamsAfter[1], t2);
    }

    // ════════════════════════════════════════════════════════════════
    // 12. Treasury — Small fee boundary
    // ════════════════════════════════════════════════════════════════

    function test_boundary_processFeeAmount2_reverts() public {
        // T-03 (2026-04-20): amounts below BPS_DENOMINATOR are rejected to
        // preserve the 85/15 split contract. Pre-fix behavior: amount=2
        // produced burn=1, dev=1 — a 50/50 split. Now: AmountBelowMinimum.
        vm.prank(admin);
        treasury.setAuthorized(alice, true);

        vm.prank(alice);
        claw.approve(address(treasury), 2);

        vm.expectRevert(abi.encodeWithSelector(Treasury.AmountBelowMinimum.selector, 2, treasury.BPS_DENOMINATOR()));
        vm.prank(alice);
        treasury.processFee(2);
    }

    function test_boundary_processFeeExactBPS() public {
        // amount=10000: burn = (10000 * 8500) / 10000 = 8500, dev = 10000 - 8500 = 1500
        vm.prank(admin);
        treasury.setAuthorized(alice, true);

        vm.prank(alice);
        claw.approve(address(treasury), 10_000);

        uint256 devBalBefore = claw.balanceOf(devWallet);

        vm.prank(alice);
        treasury.processFee(10_000);

        assertEq(claw.balanceOf(devWallet), devBalBefore + 1500);
    }

    // ════════════════════════════════════════════════════════════════
    // 13. Faucet — Close time boundary, exact ETH boundary
    // ════════════════════════════════════════════════════════════════

    function test_boundary_faucetClaimOneSecondBeforeClose() public {
        uint256 closeTime = block.timestamp + 7 days;

        vm.prank(eligibilityAdmin);
        faucet.setEligible(alice, true);

        vm.warp(closeTime - 1);

        vm.prank(alice);
        faucet.claimLobsters();

        // Verify 5 lobsters minted
        assertEq(nft.totalMinted(), 5);
    }

    function test_boundary_faucetClaimAtExactCloseReverts() public {
        uint256 closeTime = block.timestamp + 7 days;

        vm.prank(eligibilityAdmin);
        faucet.setEligible(alice, true);

        vm.warp(closeTime);

        vm.prank(alice);
        vm.expectRevert(Faucet.FaucetIsClosed.selector);
        faucet.claimLobsters();
    }

    function test_boundary_faucetExactMinETH() public {
        // Min ETH = 0.001 ether, alice has 10 ether → OK
        address carol = makeAddr("carol");
        vm.deal(carol, 0.001 ether); // exactly minimum

        vm.prank(eligibilityAdmin);
        faucet.setEligible(carol, true);

        vm.prank(carol);
        faucet.claimLobsters(); // should succeed
    }

    function test_boundary_faucetBelowMinETHReverts() public {
        address carol = makeAddr("carol");
        vm.deal(carol, 0.001 ether - 1); // 1 wei below minimum

        vm.prank(eligibilityAdmin);
        faucet.setEligible(carol, true);

        vm.prank(carol);
        vm.expectRevert(Faucet.InsufficientETHBalance.selector);
        faucet.claimLobsters();
    }

    // ════════════════════════════════════════════════════════════════
    // 14. Cross-Contract Integration — Damage→Repair→Battle re-entry
    // ════════════════════════════════════════════════════════════════

    function test_integration_damageRepairBattleReentry() public {
        // 1. Create lobster at Evolved tier with damage=85
        uint256 lob = _mintLobsterAtTier(alice, 1);
        _setDamage(lob, 85);

        // 2. Verify damage > 79 blocks battle reveal
        // (We just check the state — the battle test above covers the revert)
        assertTrue(nft.getDamage(lob) > 79);

        // 3. Repair to exactly 79
        uint256 cost = 6 * 5e18; // repair 6 points at Evolved rate
        vm.prank(alice);
        claw.approve(address(repair), cost);
        vm.prank(alice);
        repair.repair(lob, 6);

        assertEq(nft.getDamage(lob), 79);

        // 4. Now lobster can enter battle (damage <= 79)
        // Create a team with this lobster + 2 healthy ones
        uint256 lob2 = _mintLobsterAtTier(alice, 1);
        uint256 lob3 = _mintLobsterAtTier(alice, 1);
        vm.prank(alice);
        uint256 teamIdA = tm.createTeam([lob, lob2, lob3]);

        uint256 teamIdB = _createTeam(bob, 1);

        vm.prank(matchmaker);
        uint256 battleId = arena.createBattle(alice, bob, STAKE_LOW);
        _depositBothBattle(battleId);

        bytes32 saltA = bytes32("saltA");
        bytes32 saltB = bytes32("saltB");
        bytes32 commitA = keccak256(abi.encodePacked(battleId, alice, teamIdA, saltA));
        bytes32 commitB = keccak256(abi.encodePacked(battleId, bob, teamIdB, saltB));

        vm.prank(alice);
        arena.commitTeam(battleId, commitA);
        vm.prank(bob);
        arena.commitTeam(battleId, commitB);

        // Reveal succeeds — lobster at damage=79 is accepted
        vm.prank(alice);
        arena.revealTeam(battleId, teamIdA, saltA);
        vm.prank(bob);
        arena.revealTeam(battleId, teamIdB, saltB);

        assertTrue(arena.getBattle(battleId).phase == BattleArena.BattlePhase.Active);
    }

    function test_integration_damagedLobsterCanStillMine() public {
        // Damaged lobsters (even >= 80) can mine — damage only gates battle
        uint256 lob1 = _mintLobsterAtTier(alice, 1);
        uint256 lob2 = _mintLobsterAtTier(alice, 1);
        uint256 lob3 = _mintLobsterAtTier(alice, 1);

        _setDamage(lob1, 100); // max damage

        vm.prank(alice);
        uint256 teamId = tm.createTeam([lob1, lob2, lob3]);

        _startSeason();

        // Mining should succeed even with max damage
        vm.prank(alice);
        uint256 expId = pool.startExpedition(teamId, 1); // Evolved mine

        vm.warp(block.timestamp + 4 hours);

        vm.prank(alice);
        pool.claimExpedition(expId);

        assertEq(claw.balanceOf(alice), 500_000e18 + BASE_REWARD * 3);
    }

    function test_integration_marketplaceLockedLobsterReverts() public {
        // A lobster on a team is locked — cannot list on marketplace
        uint256 lob1 = _mintLobster(alice);
        uint256 lob2 = _mintLobster(alice);
        uint256 lob3 = _mintLobster(alice);

        vm.prank(alice);
        tm.createTeam([lob1, lob2, lob3]);

        assertTrue(nft.isLocked(lob1));

        vm.prank(alice);
        nft.setApprovalForAll(address(market), true);

        // Attempting to list a locked lobster — the transfer will revert
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(LobsterNFT.LobsterIsLocked.selector, lob1));
        market.listLobster(lob1, 1_000e18);
    }

    function test_integration_faucetLobstersAsEvolutionFuel() public {
        // Faucet mints soulbound lobsters; they can be burned as evolution fuel
        vm.prank(eligibilityAdmin);
        faucet.setEligible(alice, true);

        vm.prank(alice);
        uint256[5] memory faucetIds = faucet.claimLobsters();

        // All should be soulbound
        for (uint256 i = 0; i < 5; i++) {
            assertTrue(nft.isSoulbound(faucetIds[i]));
        }

        // Evolve faucetIds[0] using faucetIds[1] and faucetIds[2] as fuel
        vm.prank(alice);
        claw.approve(address(evolution), 10_000e18);

        vm.prank(alice);
        evolution.evolve(faucetIds[0], faucetIds[1], faucetIds[2]);

        assertEq(nft.getEvolutionTier(faucetIds[0]), 1); // Evolved
        assertFalse(nft.exists(faucetIds[1])); // fuel burned
        assertFalse(nft.exists(faucetIds[2])); // fuel burned
    }

    // ──────────── Battle Helpers (local to this test) ────────────

    function _depositBothBattle(uint256 battleId) internal {
        uint256 antiGrief = STAKE_LOW * 500 / 10_000;
        uint256 total = STAKE_LOW + antiGrief;

        vm.prank(alice);
        claw.approve(address(arena), total);
        vm.prank(alice);
        arena.deposit(battleId);

        vm.prank(bob);
        claw.approve(address(arena), total);
        vm.prank(bob);
        arena.deposit(battleId);
    }

    function _setupActiveBattle() internal returns (uint256 battleId, uint256 teamIdA, uint256 teamIdB) {
        teamIdA = _createTeam(alice, 1); // Evolved
        teamIdB = _createTeam(bob, 1);

        vm.prank(matchmaker);
        battleId = arena.createBattle(alice, bob, STAKE_LOW);
        _depositBothBattle(battleId);

        bytes32 saltA = bytes32("saltA");
        bytes32 saltB = bytes32("saltB");
        bytes32 commitA = keccak256(abi.encodePacked(battleId, alice, teamIdA, saltA));
        bytes32 commitB = keccak256(abi.encodePacked(battleId, bob, teamIdB, saltB));

        vm.prank(alice);
        arena.commitTeam(battleId, commitA);
        vm.prank(bob);
        arena.commitTeam(battleId, commitB);

        vm.prank(alice);
        arena.revealTeam(battleId, teamIdA, saltA);
        vm.prank(bob);
        arena.revealTeam(battleId, teamIdB, saltB);
    }

    function _commitBattleMoves(uint256 battleId, bytes memory movesA, bytes memory movesB)
        internal
        returns (bytes32 saltA, bytes32 saltB)
    {
        BattleArena.Battle memory b = arena.getBattle(battleId);
        saltA = bytes32("moveSaltA");
        saltB = bytes32("moveSaltB");

        bytes32 commitA = keccak256(abi.encodePacked(battleId, b.currentRound, alice, movesA, saltA));
        bytes32 commitB = keccak256(abi.encodePacked(battleId, b.currentRound, bob, movesB, saltB));

        vm.prank(alice);
        arena.commitMoves(battleId, commitA);
        vm.prank(bob);
        arena.commitMoves(battleId, commitB);
    }

    function _revealBattleMoves(uint256 battleId, bytes memory movesA, bytes memory movesB, bytes32 saltA, bytes32 saltB)
        internal
    {
        vm.prank(alice);
        arena.revealMoves(battleId, movesA, saltA);
        vm.prank(bob);
        arena.revealMoves(battleId, movesB, saltB);
    }
}

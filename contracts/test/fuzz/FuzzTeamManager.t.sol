// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import "../helpers/BaseSetup.t.sol";

/// @dev Fuzz tests for TeamManager — team creation, locking, disband, and single-assignment invariant.
contract FuzzTeamManager is BaseSetup {
    address internal alice = makeAddr("alice");
    address internal bob   = makeAddr("bob");

    // ── Lobsters locked on team creation ─────────────────────────

    function test_lobsters_locked_after_create_team() public {
        uint256[3] memory ids = _mint3(alice);

        vm.prank(alice);
        uint256 teamId = teamMgr.createTeam(ids);

        for (uint256 i = 0; i < 3; i++) {
            assertTrue(nft.isLocked(ids[i]), "lobster should be locked");
        }
        assertTrue(teamMgr.teamExists(teamId));
    }

    // ── Lobsters unlocked on disband ──────────────────────────────

    function test_lobsters_unlocked_after_disband() public {
        uint256[3] memory ids = _mint3(alice);

        vm.startPrank(alice);
        uint256 teamId = teamMgr.createTeam(ids);
        teamMgr.disbandTeam(teamId);
        vm.stopPrank();

        for (uint256 i = 0; i < 3; i++) {
            assertFalse(nft.isLocked(ids[i]), "lobster should be unlocked");
        }
        assertFalse(teamMgr.teamExists(teamId));
    }

    // ── Duplicate lobster reverts ─────────────────────────────────

    function test_duplicate_lobster_reverts() public {
        uint256[3] memory ids = _mint3(alice);

        // Replace slot 1 with slot 0 (duplicate)
        uint256[3] memory dup = [ids[0], ids[0], ids[2]];

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TeamManager.DuplicateLobster.selector, ids[0]));
        teamMgr.createTeam(dup);
    }

    function test_duplicate_lobster_2_3_reverts() public {
        uint256[3] memory ids = _mint3(alice);
        uint256[3] memory dup = [ids[0], ids[2], ids[2]];

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TeamManager.DuplicateLobster.selector, ids[2]));
        teamMgr.createTeam(dup);
    }

    // ── Not owned lobster reverts ─────────────────────────────────

    function test_not_owned_reverts() public {
        uint256[3] memory aliceIds = _mint3(alice);
        uint256    bobId          = _mintLobster(bob, 1);

        uint256[3] memory mixed = [aliceIds[0], aliceIds[1], bobId];

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TeamManager.LobsterNotOwned.selector, bobId));
        teamMgr.createTeam(mixed);
    }

    // ── Already assigned lobster reverts ──────────────────────────

    function test_already_assigned_reverts() public {
        uint256[] memory ids = _mintN(alice, 4);
        uint256[3] memory firstTeam = [ids[0], ids[1], ids[2]];

        vm.prank(alice);
        teamMgr.createTeam(firstTeam);

        // Try to create second team using ids[0] which is already assigned
        uint256[3] memory secondTeam = [ids[0], ids[3], ids[3]]; // ids[3] dup too, but assignment check fires first
        // ids[3] == ids[3] dup — but let's test a non-dup scenario
        uint256 extraId = _mintLobster(alice, 5);
        secondTeam = [ids[0], ids[3], extraId];

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TeamManager.LobsterAlreadyAssigned.selector, ids[0]));
        teamMgr.createTeam(secondTeam);
    }

    // ── Active team cannot be disbanded ───────────────────────────

    function test_disband_active_team_reverts() public {
        uint256[3] memory ids = _mint3(alice);

        vm.prank(alice);
        uint256 teamId = teamMgr.createTeam(ids);

        // Activate team via ACTIVITY_ROLE — cache role first so prank isn't consumed by getter
        bytes32 activityRole = teamMgr.ACTIVITY_ROLE();
        vm.prank(admin);
        teamMgr.grantRole(activityRole, admin);

        vm.prank(admin);
        teamMgr.setTeamActive(teamId, true);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TeamManager.TeamIsActive.selector, teamId));
        teamMgr.disbandTeam(teamId);
    }

    // ── Single assignment invariant ───────────────────────────────

    function testFuzz_lobster_can_only_be_in_one_team(uint8 extraLobsters) public {
        extraLobsters = uint8(bound(extraLobsters, 3, 6));
        uint256[] memory ids = _mintN(alice, extraLobsters);

        uint256[3] memory firstTeam = [ids[0], ids[1], ids[2]];
        vm.prank(alice);
        uint256 team1 = teamMgr.createTeam(firstTeam);

        // Lobster mapping should point to team1
        assertEq(teamMgr.getLobsterTeam(ids[0]), team1);
        assertEq(teamMgr.getLobsterTeam(ids[1]), team1);
        assertEq(teamMgr.getLobsterTeam(ids[2]), team1);

        // Free lobsters not in any team
        for (uint256 i = 3; i < extraLobsters; i++) {
            assertEq(teamMgr.getLobsterTeam(ids[i]), 0);
        }
    }

    // ── getTeamsByOwner tracking ───────────────────────────────────

    function test_teams_by_owner_tracking() public {
        uint256[3] memory ids1 = _mint3(alice);
        uint256[3] memory ids2 = _mint3(alice);

        vm.startPrank(alice);
        uint256 t1 = teamMgr.createTeam(ids1);
        uint256 t2 = teamMgr.createTeam(ids2);
        vm.stopPrank();

        uint256[] memory aliceTeams = teamMgr.getTeamsByOwner(alice);
        assertEq(aliceTeams.length, 2);

        // Disband first team, owner array shrinks
        vm.prank(alice);
        teamMgr.disbandTeam(t1);

        aliceTeams = teamMgr.getTeamsByOwner(alice);
        assertEq(aliceTeams.length, 1);
        assertEq(aliceTeams[0], t2);
    }

    // ── Non-owner cannot disband ───────────────────────────────────

    function test_non_owner_disband_reverts() public {
        uint256[3] memory ids = _mint3(alice);

        vm.prank(alice);
        uint256 teamId = teamMgr.createTeam(ids);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(TeamManager.NotTeamOwner.selector, teamId));
        teamMgr.disbandTeam(teamId);
    }

    // ── Nonexistent team reverts ──────────────────────────────────

    function testFuzz_nonexistent_team_reverts(uint256 teamId) public {
        vm.assume(!teamMgr.teamExists(teamId));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TeamManager.TeamDoesNotExist.selector, teamId));
        teamMgr.disbandTeam(teamId);
    }

    // ─────────────────────────────────────────────────────────────
    // Phase 2 TeamManager pass — gap coverage
    // ─────────────────────────────────────────────────────────────

    // createTeam with a non-existent lobster reverts LobsterDoesNotExist.
    function test_createTeam_nonExistentLobster_reverts() public {
        uint256 lob1 = _mintLobster(alice, 0);
        uint256 lob2 = _mintLobster(alice, 1);
        uint256 ghost = 99_999_999; // never minted

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TeamManager.LobsterDoesNotExist.selector, ghost));
        teamMgr.createTeam([lob1, lob2, ghost]);
    }

    // disbandTeam clears _lobsterToTeam for every member, unlocking all 3.
    function test_disband_clears_lobsterToTeam_forAll() public {
        uint256[3] memory ids = _mint3(alice);

        vm.prank(alice);
        uint256 teamId = teamMgr.createTeam(ids);
        for (uint256 i = 0; i < 3; i++) {
            assertEq(teamMgr.getLobsterTeam(ids[i]), teamId);
        }

        vm.prank(alice);
        teamMgr.disbandTeam(teamId);

        for (uint256 i = 0; i < 3; i++) {
            assertEq(teamMgr.getLobsterTeam(ids[i]), 0, "lobster-to-team cleared after disband");
            assertFalse(nft.isLocked(ids[i]), "unlocked after disband");
        }
    }

    // Swap-and-pop on a mid-list team keeps the remaining teams consistent
    // with their owner-list indices.
    function test_disband_midList_swapAndPop_consistency() public {
        // Create 3 teams for alice
        uint256[3] memory a = _mint3(alice);
        uint256[3] memory b = _mint3(alice);
        uint256[3] memory c = _mint3(alice);

        vm.prank(alice); uint256 t1 = teamMgr.createTeam(a);
        vm.prank(alice); uint256 t2 = teamMgr.createTeam(b);
        vm.prank(alice); uint256 t3 = teamMgr.createTeam(c);

        uint256[] memory teams = teamMgr.getTeamsByOwner(alice);
        assertEq(teams.length, 3);

        // Disband the middle team (t2)
        vm.prank(alice);
        teamMgr.disbandTeam(t2);

        teams = teamMgr.getTeamsByOwner(alice);
        assertEq(teams.length, 2, "one team removed");

        // Remaining: t1 + t3 (in some order via swap-and-pop)
        bool foundT1 = false;
        bool foundT3 = false;
        for (uint256 i = 0; i < teams.length; i++) {
            if (teams[i] == t1) foundT1 = true;
            if (teams[i] == t3) foundT3 = true;
        }
        assertTrue(foundT1, "t1 preserved");
        assertTrue(foundT3, "t3 preserved");

        // Can still disband the remaining teams cleanly (no stale index).
        vm.prank(alice); teamMgr.disbandTeam(t1);
        vm.prank(alice); teamMgr.disbandTeam(t3);

        assertEq(teamMgr.getTeamsByOwner(alice).length, 0);
    }

    // setTeamActive requires ACTIVITY_ROLE.
    function testFuzz_setTeamActive_unauthorized_reverts(address caller) public {
        vm.assume(caller != admin && caller != address(miningPool) && caller != address(battleArena));

        uint256[3] memory ids = _mint3(alice);
        vm.prank(alice);
        uint256 teamId = teamMgr.createTeam(ids);

        vm.prank(caller);
        vm.expectRevert();
        teamMgr.setTeamActive(teamId, true);
    }

    // setTeamActive on nonexistent team reverts. ACTIVITY_ROLE holder
    // is MiningPool/BattleArena in production; we impersonate MiningPool
    // to pass the role gate and hit the TeamDoesNotExist check beneath.
    function testFuzz_setTeamActive_nonExistentTeam_reverts(uint256 teamId) public {
        vm.assume(!teamMgr.teamExists(teamId));
        vm.prank(address(miningPool));
        vm.expectRevert(abi.encodeWithSelector(TeamManager.TeamDoesNotExist.selector, teamId));
        teamMgr.setTeamActive(teamId, true);
    }

    // I-05 scenario (prior audit): disbandTeam uses team.owner for auth,
    // not current ownerOf(lobster). Since lobsters are locked on team
    // creation and cannot be transferred, team.owner remains authoritative.
    // This test documents the invariant: the original creator disbands
    // even though current NFT ownership is identical (locked prevents
    // transfer), and the setLocked(false) call succeeds on every lobster.
    function test_I05_disbandAuthByTeamOwner_lobsterLockPreservesInvariant() public {
        uint256[3] memory ids = _mint3(alice);
        vm.prank(alice);
        uint256 teamId = teamMgr.createTeam(ids);

        // Lobsters are locked. ownerOf is still alice (locked doesn't change
        // ERC-1155 ownership, just blocks transfer). Confirm.
        for (uint256 i = 0; i < 3; i++) {
            assertEq(nft.ownerOf(ids[i]), alice);
            assertTrue(nft.isLocked(ids[i]));
        }

        // Alice disbands (team.owner matches msg.sender).
        vm.prank(alice);
        teamMgr.disbandTeam(teamId);

        for (uint256 i = 0; i < 3; i++) {
            assertFalse(nft.isLocked(ids[i]));
        }
    }

    // Disband reverts if a team lobster was burned (defence-in-depth:
    // today this can't happen because team lobsters are locked, but if
    // LOCKER_ROLE + BURNER_ROLE are ever both compromised, disband would
    // try to setLocked on a non-existent lobster and revert. This test
    // pins the current behavior.)
    function test_disband_burnedLobster_revertsOnSetLocked() public {
        uint256[3] memory ids = _mint3(alice);
        vm.prank(alice);
        uint256 teamId = teamMgr.createTeam(ids);

        // Admin has both LOCKER_ROLE (to unlock) and BURNER_ROLE (to burn)
        // in BaseSetup — simulate a compromised-role scenario.
        vm.prank(admin);
        nft.setLocked(ids[0], false);
        vm.prank(admin);
        nft.burn(ids[0]);

        // Alice tries to disband. setLocked on the burned lobster reverts.
        vm.prank(alice);
        vm.expectRevert(); // TokenDoesNotExist from LobsterNFT._requireExists
        teamMgr.disbandTeam(teamId);
    }
}

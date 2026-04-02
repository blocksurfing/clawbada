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
}

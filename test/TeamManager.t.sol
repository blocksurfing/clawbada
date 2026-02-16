// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TeamManager} from "../contracts/TeamManager.sol";
import {LobsterNFT} from "../contracts/LobsterNFT.sol";
import {DNALib} from "../contracts/libraries/DNALib.sol";

contract TeamManagerTest is Test {
    TeamManager tm;
    LobsterNFT nft;

    address admin = makeAddr("admin");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address activityCaller = makeAddr("activityCaller");

    uint256 validDNA;

    function setUp() public {
        vm.startPrank(admin);
        nft = new LobsterNFT(admin, "https://api.clawbada.com/lobster/");
        tm = new TeamManager(admin, address(nft));

        // Grant roles
        nft.grantRole(nft.MINTER_ROLE(), admin);
        nft.grantRole(nft.LOCKER_ROLE(), address(tm));
        tm.grantRole(tm.ACTIVITY_ROLE(), activityCaller);
        vm.stopPrank();

        // Build valid DNA: class 3, legend 0, breed type 5, all alleles affinity 3 variant 7
        uint8[18] memory alleles;
        for (uint256 i = 0; i < 18; i++) {
            alleles[i] = 0x37;
        }
        validDNA = DNALib.encode(3, 0, 5, alleles);
    }

    // ──────────── Helpers ────────────

    function _mintLobster(address to) internal returns (uint256) {
        vm.prank(admin);
        return nft.mint(to, validDNA, false);
    }

    function _mintLobsters(address to, uint256 count) internal returns (uint256[] memory ids) {
        ids = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            ids[i] = _mintLobster(to);
        }
    }

    function _createTeamForAlice() internal returns (uint256 teamId, uint256[3] memory lobsterIds) {
        uint256[] memory ids = _mintLobsters(alice, 3);
        lobsterIds = [ids[0], ids[1], ids[2]];
        vm.prank(alice);
        teamId = tm.createTeam(lobsterIds);
    }

    // ──────────── Constructor ────────────

    function test_constructorSetsState() public view {
        assertEq(address(tm.lobsterNFT()), address(nft));
        assertTrue(tm.hasRole(tm.DEFAULT_ADMIN_ROLE(), admin));
        assertEq(tm.nextTeamId(), 1);
    }

    function test_constructorZeroAdminReverts() public {
        vm.expectRevert(TeamManager.ZeroAddress.selector);
        new TeamManager(address(0), address(nft));
    }

    function test_constructorZeroNFTReverts() public {
        vm.expectRevert(TeamManager.ZeroAddress.selector);
        new TeamManager(admin, address(0));
    }

    // ──────────── createTeam ────────────

    function test_createTeam() public {
        (uint256 teamId, uint256[3] memory lobsterIds) = _createTeamForAlice();
        assertEq(teamId, 1);

        TeamManager.Team memory team = tm.getTeam(teamId);
        assertEq(team.owner, alice);
        assertEq(team.lobsterIds[0], lobsterIds[0]);
        assertEq(team.lobsterIds[1], lobsterIds[1]);
        assertEq(team.lobsterIds[2], lobsterIds[2]);
        assertFalse(team.active);
    }

    function test_createTeamSequentialIds() public {
        _createTeamForAlice();
        uint256[] memory ids2 = _mintLobsters(alice, 3);
        vm.prank(alice);
        uint256 teamId2 = tm.createTeam([ids2[0], ids2[1], ids2[2]]);
        assertEq(teamId2, 2);
        assertEq(tm.nextTeamId(), 3);
    }

    function test_createTeamLocksLobsters() public {
        (, uint256[3] memory lobsterIds) = _createTeamForAlice();
        for (uint256 i = 0; i < 3; i++) {
            assertTrue(nft.isLocked(lobsterIds[i]));
        }
    }

    function test_createTeamUpdatesOwnerTeams() public {
        _createTeamForAlice();
        uint256[] memory teams = tm.getTeamsByOwner(alice);
        assertEq(teams.length, 1);
        assertEq(teams[0], 1);
    }

    function test_createTeamUpdatesLobsterMapping() public {
        (, uint256[3] memory lobsterIds) = _createTeamForAlice();
        for (uint256 i = 0; i < 3; i++) {
            assertEq(tm.getLobsterTeam(lobsterIds[i]), 1);
        }
    }

    function test_createTeamEmitsEvent() public {
        uint256[] memory ids = _mintLobsters(alice, 3);
        uint256[3] memory lobsterIds = [ids[0], ids[1], ids[2]];

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit TeamManager.TeamCreated(1, alice, lobsterIds);
        tm.createTeam(lobsterIds);
    }

    function test_createTeamLobsterNotOwnedReverts() public {
        uint256[] memory aliceIds = _mintLobsters(alice, 2);
        uint256 bobId = _mintLobster(bob);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TeamManager.LobsterNotOwned.selector, bobId));
        tm.createTeam([aliceIds[0], aliceIds[1], bobId]);
    }

    function test_createTeamDuplicateLobsterReverts() public {
        uint256[] memory ids = _mintLobsters(alice, 2);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TeamManager.DuplicateLobster.selector, ids[0]));
        tm.createTeam([ids[0], ids[0], ids[1]]);
    }

    function test_createTeamLobsterAlreadyAssignedReverts() public {
        (, uint256[3] memory lobsterIds) = _createTeamForAlice();
        uint256[] memory moreIds = _mintLobsters(alice, 2);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TeamManager.LobsterAlreadyAssigned.selector, lobsterIds[0]));
        tm.createTeam([lobsterIds[0], moreIds[0], moreIds[1]]);
    }

    function test_createTeamLobsterDoesNotExistReverts() public {
        uint256[] memory ids = _mintLobsters(alice, 2);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TeamManager.LobsterDoesNotExist.selector, 999));
        tm.createTeam([ids[0], ids[1], 999]);
    }

    // ──────────── disbandTeam ────────────

    function test_disbandTeam() public {
        (uint256 teamId, uint256[3] memory lobsterIds) = _createTeamForAlice();

        vm.prank(alice);
        tm.disbandTeam(teamId);

        assertFalse(tm.teamExists(teamId));

        // Lobsters unlocked
        for (uint256 i = 0; i < 3; i++) {
            assertFalse(nft.isLocked(lobsterIds[i]));
            assertEq(tm.getLobsterTeam(lobsterIds[i]), 0);
        }

        // Owner teams updated
        uint256[] memory teams = tm.getTeamsByOwner(alice);
        assertEq(teams.length, 0);
    }

    function test_disbandTeamNotOwnerReverts() public {
        (uint256 teamId,) = _createTeamForAlice();

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(TeamManager.NotTeamOwner.selector, teamId));
        tm.disbandTeam(teamId);
    }

    function test_disbandTeamActiveReverts() public {
        (uint256 teamId,) = _createTeamForAlice();

        vm.prank(activityCaller);
        tm.setTeamActive(teamId, true);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TeamManager.TeamIsActive.selector, teamId));
        tm.disbandTeam(teamId);
    }

    function test_disbandTeamDoesNotExistReverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TeamManager.TeamDoesNotExist.selector, 999));
        tm.disbandTeam(999);
    }

    function test_disbandTeamEmitsEvent() public {
        (uint256 teamId,) = _createTeamForAlice();

        vm.prank(alice);
        vm.expectEmit(true, true, false, false);
        emit TeamManager.TeamDisbanded(teamId, alice);
        tm.disbandTeam(teamId);
    }

    function test_disbandFreesLobstersForReassignment() public {
        (uint256 teamId, uint256[3] memory lobsterIds) = _createTeamForAlice();

        vm.prank(alice);
        tm.disbandTeam(teamId);

        // Can create a new team with the same lobsters
        vm.prank(alice);
        uint256 newTeamId = tm.createTeam(lobsterIds);
        assertEq(newTeamId, 2);
    }

    function test_disbandSwapAndPop() public {
        // Create 3 teams, disband the middle one
        _createTeamForAlice(); // team 1
        uint256[] memory ids2 = _mintLobsters(alice, 3);
        vm.prank(alice);
        tm.createTeam([ids2[0], ids2[1], ids2[2]]); // team 2

        uint256[] memory ids3 = _mintLobsters(alice, 3);
        vm.prank(alice);
        tm.createTeam([ids3[0], ids3[1], ids3[2]]); // team 3

        uint256[] memory teamsBefore = tm.getTeamsByOwner(alice);
        assertEq(teamsBefore.length, 3);

        // Disband team 2 (middle)
        vm.prank(alice);
        tm.disbandTeam(2);

        uint256[] memory teamsAfter = tm.getTeamsByOwner(alice);
        assertEq(teamsAfter.length, 2);
        // Team 3 should have been swapped into index 1
        assertEq(teamsAfter[0], 1);
        assertEq(teamsAfter[1], 3);
    }

    // ──────────── setTeamActive ────────────

    function test_setTeamActive() public {
        (uint256 teamId,) = _createTeamForAlice();

        vm.prank(activityCaller);
        tm.setTeamActive(teamId, true);
        assertTrue(tm.isTeamActive(teamId));

        vm.prank(activityCaller);
        tm.setTeamActive(teamId, false);
        assertFalse(tm.isTeamActive(teamId));
    }

    function test_setTeamActiveUnauthorizedReverts() public {
        (uint256 teamId,) = _createTeamForAlice();

        vm.prank(alice);
        vm.expectRevert();
        tm.setTeamActive(teamId, true);
    }

    function test_setTeamActiveNonexistentReverts() public {
        vm.prank(activityCaller);
        vm.expectRevert(abi.encodeWithSelector(TeamManager.TeamDoesNotExist.selector, 999));
        tm.setTeamActive(999, true);
    }

    function test_setTeamActiveEmitsEvent() public {
        (uint256 teamId,) = _createTeamForAlice();

        vm.prank(activityCaller);
        vm.expectEmit(true, false, false, true);
        emit TeamManager.TeamActivityUpdated(teamId, true);
        tm.setTeamActive(teamId, true);
    }

    // ──────────── View Functions ────────────

    function test_getTeamNonexistentReverts() public {
        vm.expectRevert(abi.encodeWithSelector(TeamManager.TeamDoesNotExist.selector, 999));
        tm.getTeam(999);
    }

    function test_getTeamsByOwnerEmpty() public view {
        uint256[] memory teams = tm.getTeamsByOwner(bob);
        assertEq(teams.length, 0);
    }

    function test_getLobsterTeamUnassigned() public view {
        assertEq(tm.getLobsterTeam(999), 0);
    }

    function test_teamExistsFalseForNonexistent() public view {
        assertFalse(tm.teamExists(999));
    }

    // ──────────── Fuzz ────────────

    function testFuzz_createDisbandPreservesLobsterState(uint8 count) public {
        count = uint8(bound(count, 1, 5));

        for (uint256 t = 0; t < count; t++) {
            uint256[] memory ids = _mintLobsters(alice, 3);

            vm.prank(alice);
            uint256 teamId = tm.createTeam([ids[0], ids[1], ids[2]]);

            // All locked and assigned
            for (uint256 i = 0; i < 3; i++) {
                assertTrue(nft.isLocked(ids[i]));
                assertEq(tm.getLobsterTeam(ids[i]), teamId);
            }

            vm.prank(alice);
            tm.disbandTeam(teamId);

            // All unlocked and unassigned
            for (uint256 i = 0; i < 3; i++) {
                assertFalse(nft.isLocked(ids[i]));
                assertEq(tm.getLobsterTeam(ids[i]), 0);
            }
        }
    }
}

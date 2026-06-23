// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {BattleVRF} from "../contracts/BattleVRF.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

contract BattleVRFTest is Test {
    BattleVRF vrf;

    address admin = makeAddr("admin");
    address operator = makeAddr("operator");
    address nobody = makeAddr("nobody");

    function setUp() public {
        vm.startPrank(admin);
        vrf = new BattleVRF(admin);
        vrf.grantRole(vrf.OPERATOR_ROLE(), operator);
        vm.stopPrank();
    }

    // ──────────── Constructor ────────────

    function test_constructorSetsAdmin() public view {
        assertTrue(vrf.hasRole(vrf.DEFAULT_ADMIN_ROLE(), admin));
        assertEq(vrf.latestRound(), 0);
    }

    function test_constructorZeroAddressReverts() public {
        vm.expectRevert(BattleVRF.ZeroAddress.selector);
        new BattleVRF(address(0));
    }

    // ──────────── submitBeacon ────────────

    function test_submitBeaconHappyPath() public {
        vm.prank(operator);
        vrf.submitBeacon(1, 12345);

        assertEq(vrf.getBeacon(1), 12345);
        assertEq(vrf.latestRound(), 1);
        assertTrue(vrf.hasBeacon(1));
    }

    function test_submitBeaconEmitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit BattleVRF.BeaconSubmitted(42, 99999);

        vm.prank(operator);
        vrf.submitBeacon(42, 99999);
    }

    function test_submitBeaconDuplicateReverts() public {
        vm.prank(operator);
        vrf.submitBeacon(1, 12345);

        vm.expectRevert(abi.encodeWithSelector(BattleVRF.BeaconAlreadySubmitted.selector, 1));
        vm.prank(operator);
        vrf.submitBeacon(1, 67890);
    }

    function test_submitBeaconZeroRoundReverts() public {
        vm.expectRevert(BattleVRF.RoundCannotBeZero.selector);
        vm.prank(operator);
        vrf.submitBeacon(0, 12345);
    }

    function test_submitBeaconZeroValueReverts() public {
        vm.expectRevert(BattleVRF.ValueCannotBeZero.selector);
        vm.prank(operator);
        vrf.submitBeacon(1, 0);
    }

    function test_submitBeaconUnauthorizedReverts() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, nobody, vrf.OPERATOR_ROLE()
            )
        );
        vm.prank(nobody);
        vrf.submitBeacon(1, 12345);
    }

    function test_submitBeaconUpdatesLatestRound() public {
        vm.startPrank(operator);
        vrf.submitBeacon(5, 111);
        assertEq(vrf.latestRound(), 5);

        vrf.submitBeacon(10, 222);
        assertEq(vrf.latestRound(), 10);

        // Submit earlier round — latestRound should not decrease
        vrf.submitBeacon(3, 333);
        assertEq(vrf.latestRound(), 10);
        vm.stopPrank();
    }

    // ──────────── getBeacon / hasBeacon ────────────

    function test_getBeaconNotSubmittedReverts() public {
        vm.expectRevert(abi.encodeWithSelector(BattleVRF.BeaconNotAvailable.selector, 999));
        vrf.getBeacon(999);
    }

    function test_hasBeaconReturnsFalseWhenMissing() public view {
        assertFalse(vrf.hasBeacon(999));
    }

    // ──────────── deriveRandomness ────────────

    function test_deriveRandomnessIsDeterministic() public {
        vm.prank(operator);
        vrf.submitBeacon(1, 12345);

        // (beaconRound, battleId, turn, action)
        uint256 r1 = vrf.deriveRandomness(1, 7, 2, 0);
        uint256 r2 = vrf.deriveRandomness(1, 7, 2, 0);
        assertEq(r1, r2);
    }

    function test_deriveRandomnessDifferentCoordsDiffer() public {
        vm.prank(operator);
        vrf.submitBeacon(1, 12345);

        // Distinct coordinates must yield distinct draws.
        uint256 r1 = vrf.deriveRandomness(1, 7, 2, 0);
        uint256 r2 = vrf.deriveRandomness(1, 7, 2, 1);
        assertTrue(r1 != r2);
    }

    // F5-04: coordinates that the old additive salt would have collapsed to the same value
    // (battleId + turn + action all summing to 13) must now produce DISTINCT draws.
    function test_F5_04_deriveRandomness_noAdditiveCollision() public {
        vm.prank(operator);
        vrf.submitBeacon(1, 12345);

        uint256 a = vrf.deriveRandomness(1, 9, 4, 0); // sum 13
        uint256 b = vrf.deriveRandomness(1, 10, 3, 0); // sum 13
        uint256 c = vrf.deriveRandomness(1, 10, 2, 1); // sum 13
        assertTrue(a != b, "9/4/0 vs 10/3/0");
        assertTrue(a != c, "9/4/0 vs 10/2/1");
        assertTrue(b != c, "10/3/0 vs 10/2/1");
    }

    function test_deriveRandomnessNoBeaconReverts() public {
        vm.expectRevert(abi.encodeWithSelector(BattleVRF.BeaconNotAvailable.selector, 999));
        vrf.deriveRandomness(999, 1, 0, 0);
    }
}

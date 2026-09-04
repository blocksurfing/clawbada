// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {RepairShop} from "../contracts/RepairShop.sol";
import {LobsterNFT} from "../contracts/LobsterNFT.sol";
import {ClawToken} from "../contracts/ClawToken.sol";
import {Treasury} from "../contracts/Treasury.sol";
import {DNALib} from "../contracts/libraries/DNALib.sol";

/// @dev TOK-G1: settable stand-in for MiningPool's glide-pegged baseReward.
contract MockRewardPeg {
    uint256 public value = 1_250e18;

    function set(uint256 v) external {
        value = v;
    }

    function currentBaseReward() external view returns (uint256) {
        return value;
    }
}

contract RepairShopTest is Test {
    RepairShop shop;
    MockRewardPeg peg;
    LobsterNFT nft;
    ClawToken claw;
    Treasury treasury;

    address admin = makeAddr("admin");
    address devWallet = makeAddr("devWallet");
    address lpAddress = makeAddr("lpAddress");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 validDNA;

    function setUp() public {
        vm.startPrank(admin);

        nft = new LobsterNFT(admin, "https://api.clawbada.com/lobster/");
        treasury = new Treasury(admin, devWallet);
        claw = new ClawToken(admin, lpAddress, address(treasury));
        treasury.setClawToken(address(claw));

        peg = new MockRewardPeg();
        shop = new RepairShop(address(claw), address(nft), address(treasury), address(peg));

        // Grant roles
        nft.grantRole(nft.MINTER_ROLE(), admin);
        nft.grantRole(nft.EVOLVER_ROLE(), admin);
        nft.grantRole(nft.DAMAGE_ROLE(), admin); // for setting initial damage in tests
        nft.grantRole(nft.DAMAGE_ROLE(), address(shop));
        treasury.setAuthorized(address(shop), true);

        vm.stopPrank();

        // Build valid DNA
        uint8[18] memory alleles;
        for (uint256 i = 0; i < 18; i++) {
            alleles[i] = 0x37;
        }
        validDNA = DNALib.encode(3, 0, 5, alleles);
    }

    // ──────────── Helpers ────────────

    function _mintLobsterAtTier(address to, uint8 tier) internal returns (uint256) {
        vm.prank(admin);
        uint256 id = nft.mint(to, validDNA, false);
        if (tier > 0) {
            vm.prank(admin);
            nft.setEvolutionTier(id, tier);
        }
        return id;
    }

    function _setDamage(uint256 lobsterId, uint8 damage) internal {
        vm.prank(admin);
        nft.setDamage(lobsterId, damage);
    }

    function _giveClaw(address to, uint256 amount) internal {
        vm.prank(lpAddress);
        claw.transfer(to, amount);
    }

    function _approveClaw(address owner, uint256 amount) internal {
        vm.prank(owner);
        claw.approve(address(shop), amount);
    }

    // ──────────── Constructor ────────────

    function test_constructorSetsState() public view {
        assertEq(address(shop.clawToken()), address(claw));
        assertEq(address(shop.lobsterNFT()), address(nft));
        assertEq(address(shop.treasury()), address(treasury));
    }

    function test_constructorZeroClawReverts() public {
        vm.expectRevert(RepairShop.ZeroAddress.selector);
        new RepairShop(address(0), address(nft), address(treasury), address(peg));
    }

    function test_constructorZeroNFTReverts() public {
        vm.expectRevert(RepairShop.ZeroAddress.selector);
        new RepairShop(address(claw), address(0), address(treasury), address(peg));
    }

    function test_constructorZeroTreasuryReverts() public {
        vm.expectRevert(RepairShop.ZeroAddress.selector);
        new RepairShop(address(claw), address(nft), address(0), address(peg));
    }

    function test_constructorZeroMiningPoolReverts() public {
        vm.expectRevert(RepairShop.ZeroAddress.selector);
        new RepairShop(address(claw), address(nft), address(treasury), address(0));
    }

    // ──────────── repair() — Happy Paths ────────────

    function test_repairEvolvedTier() public {
        uint256 id = _mintLobsterAtTier(alice, 1); // Evolved
        _setDamage(id, 20);

        uint256 cost = 20 * 5e18; // 100 $CLAW
        _giveClaw(alice, cost);
        _approveClaw(alice, cost);

        vm.prank(alice);
        shop.repair(id, 20);

        assertEq(nft.getDamage(id), 0);
    }

    function test_repairEliteTier() public {
        uint256 id = _mintLobsterAtTier(alice, 2); // Elite
        _setDamage(id, 30);

        uint256 cost = 30 * 15e18; // 450 $CLAW
        _giveClaw(alice, cost);
        _approveClaw(alice, cost);

        vm.prank(alice);
        shop.repair(id, 30);

        assertEq(nft.getDamage(id), 0);
    }

    function test_repairApexTier() public {
        uint256 id = _mintLobsterAtTier(alice, 3); // Apex
        _setDamage(id, 10);

        uint256 cost = 10 * 40e18; // 400 $CLAW
        _giveClaw(alice, cost);
        _approveClaw(alice, cost);

        vm.prank(alice);
        shop.repair(id, 10);

        assertEq(nft.getDamage(id), 0);
    }

    function test_repairPartial() public {
        uint256 id = _mintLobsterAtTier(alice, 1); // Evolved
        _setDamage(id, 50);

        uint256 cost = 10 * 5e18; // repair only 10 points
        _giveClaw(alice, cost);
        _approveClaw(alice, cost);

        vm.prank(alice);
        shop.repair(id, 10);

        assertEq(nft.getDamage(id), 40);
    }

    function test_repairFull() public {
        uint256 id = _mintLobsterAtTier(alice, 1); // Evolved
        _setDamage(id, 80);

        uint256 cost = 80 * 5e18;
        _giveClaw(alice, cost);
        _approveClaw(alice, cost);

        vm.prank(alice);
        shop.repair(id, 80);

        assertEq(nft.getDamage(id), 0);
    }

    function test_repairEmitsEvent() public {
        uint256 id = _mintLobsterAtTier(alice, 1);
        _setDamage(id, 30);

        uint256 cost = 15 * 5e18; // 75 $CLAW for 15 points
        _giveClaw(alice, cost);
        _approveClaw(alice, cost);

        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit RepairShop.LobsterRepaired(id, 15, 15, cost);
        shop.repair(id, 15);
    }

    // ──────────── repair() — Reverts ────────────

    function test_repairBaseTierReverts() public {
        uint256 id = _mintLobsterAtTier(alice, 0); // Base
        _setDamage(id, 10);

        _giveClaw(alice, 1_000e18);
        _approveClaw(alice, 1_000e18);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(RepairShop.CannotRepairBaseTier.selector, id));
        shop.repair(id, 10);
    }

    function test_repairZeroDamageReverts() public {
        uint256 id = _mintLobsterAtTier(alice, 1);
        // damage is 0 by default

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(RepairShop.NothingToRepair.selector, id));
        shop.repair(id, 1);
    }

    function test_repairExceedsDamageReverts() public {
        uint256 id = _mintLobsterAtTier(alice, 1);
        _setDamage(id, 20);

        _giveClaw(alice, 1_000e18);
        _approveClaw(alice, 1_000e18);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(RepairShop.ExceedsCurrentDamage.selector, id, 21, 20));
        shop.repair(id, 21);
    }

    function test_repairNotOwnerReverts() public {
        uint256 id = _mintLobsterAtTier(alice, 1);
        _setDamage(id, 10);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(RepairShop.NotLobsterOwner.selector, id));
        shop.repair(id, 10);
    }

    function test_repairDeductsCorrectClaw() public {
        uint256 id = _mintLobsterAtTier(alice, 2); // Elite, 15 $CLAW per point
        _setDamage(id, 10);

        uint256 expectedCost = 10 * 15e18;
        _giveClaw(alice, 1_000e18);
        _approveClaw(alice, 1_000e18);

        uint256 balBefore = claw.balanceOf(alice);

        vm.prank(alice);
        shop.repair(id, 10);

        assertEq(balBefore - claw.balanceOf(alice), expectedCost);
    }

    function test_repairInsufficientClawReverts() public {
        uint256 id = _mintLobsterAtTier(alice, 1);
        _setDamage(id, 10);

        uint256 cost = 10 * 5e18; // 50 $CLAW needed
        _giveClaw(alice, cost - 1); // 1 wei short
        _approveClaw(alice, cost);

        vm.prank(alice);
        vm.expectRevert(); // ERC20 insufficient balance
        shop.repair(id, 10);
    }

    function test_repairZeroPointsReverts() public {
        uint256 id = _mintLobsterAtTier(alice, 1);
        _setDamage(id, 10);

        vm.prank(alice);
        vm.expectRevert(RepairShop.ZeroRepairPoints.selector);
        shop.repair(id, 0);
    }

    // ──────────── TOK-G1 peg ────────────

    function test_repairRateTracksPeg() public {
        uint256 id = _mintLobsterAtTier(alice, 1);
        _setDamage(id, 20);
        peg.set(625e18); // glide halves the base reward -> rate halves to 2.5/point
        uint256 cost = 20 * 25e17;
        _giveClaw(alice, cost);
        _approveClaw(alice, cost);
        uint256 balBefore = claw.balanceOf(alice);
        vm.prank(alice);
        shop.repair(id, 20);
        assertEq(balBefore - claw.balanceOf(alice), cost);
    }

    function test_repairRevertsWhenPegUnset() public {
        uint256 id = _mintLobsterAtTier(alice, 1);
        _setDamage(id, 10);
        peg.set(0);
        vm.prank(alice);
        vm.expectRevert(RepairShop.RewardPegUnset.selector);
        shop.repair(id, 10);
    }

    // ──────────── Fuzz ────────────

    function testFuzz_repairCostScalesWithTier(uint8 tier, uint8 points) public {
        tier = uint8(bound(tier, 1, 3)); // Evolved, Elite, Apex
        points = uint8(bound(points, 1, 100));

        uint256 id = _mintLobsterAtTier(alice, tier);
        _setDamage(id, points);

        uint256[4] memory rates = [uint256(0), 5e18, 15e18, 40e18];
        uint256 expectedCost = uint256(points) * rates[tier];

        _giveClaw(alice, expectedCost);
        _approveClaw(alice, expectedCost);

        uint256 balBefore = claw.balanceOf(alice);

        vm.prank(alice);
        shop.repair(id, points);

        assertEq(balBefore - claw.balanceOf(alice), expectedCost);
        assertEq(nft.getDamage(id), 0);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Faucet} from "../contracts/Faucet.sol";
import {LobsterNFT} from "../contracts/LobsterNFT.sol";
import {ClawToken} from "../contracts/ClawToken.sol";
import {DNALib} from "../contracts/libraries/DNALib.sol";

contract FaucetTest is Test {
    Faucet faucet;
    LobsterNFT nft;
    ClawToken claw;

    address admin = makeAddr("admin");
    address eligibilityAdmin = makeAddr("eligibilityAdmin");
    address lpAddress = makeAddr("lpAddress");
    address treasuryAddress = makeAddr("treasuryAddress");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 closeTime;

    function setUp() public {
        closeTime = block.timestamp + 7 days;

        vm.startPrank(admin);
        nft = new LobsterNFT(admin, "https://api.clawbada.com/lobster/");
        claw = new ClawToken(admin, lpAddress, treasuryAddress);
        faucet = new Faucet(admin, address(nft), address(claw), closeTime);

        // Grant roles to faucet
        nft.grantRole(nft.MINTER_ROLE(), address(faucet));
        claw.grantRole(claw.MINTER_ROLE(), address(faucet));
        faucet.grantRole(faucet.ELIGIBILITY_ROLE(), eligibilityAdmin);
        vm.stopPrank();

        // Give alice and bob some ETH
        vm.deal(alice, 1 ether);
        vm.deal(bob, 1 ether);
    }

    // ──────────── Helpers ────────────

    function _makeEligible(address account) internal {
        vm.prank(eligibilityAdmin);
        faucet.setEligible(account, true);
    }

    function _claimLobsters(address account) internal returns (uint256[5] memory) {
        _makeEligible(account);
        vm.prank(account);
        return faucet.claimLobsters();
    }

    // ──────────── Constructor ────────────

    function test_constructorSetsState() public view {
        assertEq(address(faucet.lobsterNFT()), address(nft));
        assertEq(address(faucet.clawToken()), address(claw));
        assertEq(faucet.closeTime(), closeTime);
        assertTrue(faucet.hasRole(faucet.DEFAULT_ADMIN_ROLE(), admin));
    }

    function test_constructorZeroAdminReverts() public {
        vm.expectRevert(Faucet.ZeroAddress.selector);
        new Faucet(address(0), address(nft), address(claw), closeTime);
    }

    function test_constructorZeroNFTReverts() public {
        vm.expectRevert(Faucet.ZeroAddress.selector);
        new Faucet(admin, address(0), address(claw), closeTime);
    }

    function test_constructorZeroClawReverts() public {
        vm.expectRevert(Faucet.ZeroAddress.selector);
        new Faucet(admin, address(nft), address(0), closeTime);
    }

    // ──────────── Eligibility ────────────

    function test_setEligible() public {
        vm.prank(eligibilityAdmin);
        faucet.setEligible(alice, true);
        assertTrue(faucet.isEligible(alice));

        vm.prank(eligibilityAdmin);
        faucet.setEligible(alice, false);
        assertFalse(faucet.isEligible(alice));
    }

    function test_setEligibleUnauthorizedReverts() public {
        vm.prank(alice);
        vm.expectRevert();
        faucet.setEligible(alice, true);
    }

    function test_setEligibleZeroAddressReverts() public {
        vm.prank(eligibilityAdmin);
        vm.expectRevert(Faucet.ZeroAddress.selector);
        faucet.setEligible(address(0), true);
    }

    function test_setEligibleBatch() public {
        address[] memory accounts = new address[](3);
        accounts[0] = alice;
        accounts[1] = bob;
        accounts[2] = makeAddr("charlie");

        vm.prank(eligibilityAdmin);
        faucet.setEligibleBatch(accounts, true);

        assertTrue(faucet.isEligible(alice));
        assertTrue(faucet.isEligible(bob));
        assertTrue(faucet.isEligible(accounts[2]));
    }

    function test_setEligibleBatchZeroAddressReverts() public {
        address[] memory accounts = new address[](2);
        accounts[0] = alice;
        accounts[1] = address(0);

        vm.prank(eligibilityAdmin);
        vm.expectRevert(Faucet.ZeroAddress.selector);
        faucet.setEligibleBatch(accounts, true);
    }

    function test_setEligibleEmitsEvent() public {
        vm.prank(eligibilityAdmin);
        vm.expectEmit(true, false, false, true);
        emit Faucet.EligibilitySet(alice, true);
        faucet.setEligible(alice, true);
    }

    // ──────────── claimLobsters ────────────

    function test_claimLobsters() public {
        uint256[5] memory tokenIds = _claimLobsters(alice);

        // 5 lobsters minted
        for (uint256 i = 0; i < 5; i++) {
            assertGt(tokenIds[i], 0);
            assertEq(nft.ownerOf(tokenIds[i]), alice);
            assertTrue(nft.isSoulbound(tokenIds[i]));
        }

        assertTrue(faucet.hasClaimedLobsters(alice));
        assertEq(faucet.totalLobstersClaimed(), 5);
    }

    function test_claimLobstersValidDNA() public {
        uint256[5] memory tokenIds = _claimLobsters(alice);

        for (uint256 i = 0; i < 5; i++) {
            uint256 dna = nft.getDNA(tokenIds[i]);
            assertTrue(DNALib.isValid(dna));

            // Legend must be 0 for faucet lobsters
            assertEq(DNALib.decodeLegend(dna), 0);

            // Class must be in range [0-9]
            uint8 class_ = DNALib.decodeClass(dna);
            assertLt(class_, 10);
        }
    }

    function test_claimLobstersNotEligibleReverts() public {
        vm.prank(alice);
        vm.expectRevert(Faucet.NotEligible.selector);
        faucet.claimLobsters();
    }

    function test_claimLobstersFaucetClosedReverts() public {
        _makeEligible(alice);
        vm.warp(closeTime);

        vm.prank(alice);
        vm.expectRevert(Faucet.FaucetIsClosed.selector);
        faucet.claimLobsters();
    }

    function test_claimLobstersDoubleClaimReverts() public {
        _claimLobsters(alice);

        vm.prank(alice);
        vm.expectRevert(Faucet.LobstersAlreadyClaimed.selector);
        faucet.claimLobsters();
    }

    function test_claimLobstersInsufficientETHReverts() public {
        address poor = makeAddr("poor");
        vm.deal(poor, 0.0009 ether);
        _makeEligible(poor);

        vm.prank(poor);
        vm.expectRevert(Faucet.InsufficientETHBalance.selector);
        faucet.claimLobsters();
    }

    function test_claimLobstersEmitsEvent() public {
        _makeEligible(alice);

        vm.prank(alice);
        // Can't check exact tokenIds easily, so just check that the event is emitted
        vm.expectEmit(true, false, false, false);
        emit Faucet.LobstersClaimed(alice, [uint256(0), 0, 0, 0, 0]); // data doesn't need to match exactly
        faucet.claimLobsters();
    }

    // ──────────── claimClaw ────────────

    function test_claimClaw() public {
        _claimLobsters(alice);

        vm.prank(alice);
        faucet.claimClaw();

        assertEq(claw.balanceOf(alice), 7_000e18);
        assertTrue(faucet.hasClaimedClaw(alice));
        assertEq(faucet.totalClawClaimed(), 7_000e18);
    }

    function test_claimClawFaucetClosedReverts() public {
        _claimLobsters(alice);
        vm.warp(closeTime);

        vm.prank(alice);
        vm.expectRevert(Faucet.FaucetIsClosed.selector);
        faucet.claimClaw();
    }

    function test_claimClawNotEligibleReverts() public {
        // Manually set lobsters claimed without being eligible
        // Can't do this naturally, so test the flow: eligible→claim lobsters→remove eligibility→try claim claw
        _claimLobsters(alice);
        vm.prank(eligibilityAdmin);
        faucet.setEligible(alice, false);

        vm.prank(alice);
        vm.expectRevert(Faucet.NotEligible.selector);
        faucet.claimClaw();
    }

    function test_claimClawWithoutLobstersReverts() public {
        _makeEligible(alice);

        vm.prank(alice);
        vm.expectRevert(Faucet.LobstersNotClaimed.selector);
        faucet.claimClaw();
    }

    function test_claimClawDoubleClaimReverts() public {
        _claimLobsters(alice);

        vm.prank(alice);
        faucet.claimClaw();

        vm.prank(alice);
        vm.expectRevert(Faucet.ClawAlreadyClaimed.selector);
        faucet.claimClaw();
    }

    function test_claimClawInsufficientETHReverts() public {
        address poor = makeAddr("poor");
        vm.deal(poor, 1 ether);
        _makeEligible(poor);
        vm.prank(poor);
        faucet.claimLobsters();

        // Drain ETH
        vm.deal(poor, 0.0009 ether);

        vm.prank(poor);
        vm.expectRevert(Faucet.InsufficientETHBalance.selector);
        faucet.claimClaw();
    }

    function test_claimClawEmitsEvent() public {
        _claimLobsters(alice);

        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit Faucet.ClawClaimed(alice, 7_000e18);
        faucet.claimClaw();
    }

    // ──────────── isFaucetOpen ────────────

    function test_isFaucetOpen() public {
        assertTrue(faucet.isFaucetOpen());

        vm.warp(closeTime - 1);
        assertTrue(faucet.isFaucetOpen());

        vm.warp(closeTime);
        assertFalse(faucet.isFaucetOpen());
    }

    // ──────────── Stats ────────────

    function test_statsAccumulate() public {
        _claimLobsters(alice);
        vm.prank(alice);
        faucet.claimClaw();

        _claimLobsters(bob);
        vm.prank(bob);
        faucet.claimClaw();

        assertEq(faucet.totalLobstersClaimed(), 10);
        assertEq(faucet.totalClawClaimed(), 14_000e18);
    }

    // ──────────── Fuzz ────────────

    function testFuzz_claimLobstersProducesValidDNA(uint256 seed) public {
        // Use seed to set prevrandao
        vm.prevrandao(bytes32(seed));

        address claimer = makeAddr("claimer");
        vm.deal(claimer, 1 ether);
        _makeEligible(claimer);

        vm.prank(claimer);
        uint256[5] memory tokenIds = faucet.claimLobsters();

        for (uint256 i = 0; i < 5; i++) {
            uint256 dna = nft.getDNA(tokenIds[i]);
            assertTrue(DNALib.isValid(dna));
            assertEq(DNALib.decodeLegend(dna), 0);
            assertLt(DNALib.decodeClass(dna), 10);
        }
    }
}

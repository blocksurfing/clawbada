// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, stdStorage, StdStorage} from "forge-std/Test.sol";
import {Faucet} from "../contracts/Faucet.sol";
import {LobsterNFT} from "../contracts/LobsterNFT.sol";
import {ClawToken} from "../contracts/ClawToken.sol";
import {DNALib} from "../contracts/libraries/DNALib.sol";

contract FaucetTest is Test {
    using stdStorage for StdStorage;

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

        // Grant roles
        nft.grantRole(nft.MINTER_ROLE(), address(faucet));
        faucet.grantRole(faucet.ELIGIBILITY_ROLE(), eligibilityAdmin);

        // Pre-fund faucet with $CLAW (replaces MINTER_ROLE grant — S-01 fix)
        claw.grantRole(claw.MINTER_ROLE(), admin);
        claw.mint(address(faucet), 70_000_000e18);
        claw.revokeRole(claw.MINTER_ROLE(), admin);
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

    /// @dev D-10: a lobster claim is two steps. Request, let the target block pass, finalize
    ///      (as a stranger — finalize is permissionless and mints to the claimer).
    function _claimLobsters(address account) internal returns (uint256[5] memory) {
        _makeEligible(account);
        vm.prank(account);
        uint256 claimId = faucet.claimLobsters();
        return _finalize(claimId);
    }

    function _finalize(uint256 claimId) internal returns (uint256[5] memory) {
        vm.roll(faucet.getClaim(claimId).targetBlock + 1);
        vm.prank(makeAddr("keeper"));
        return faucet.finalizeClaim(claimId);
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

    function test_setEligibleBatchTooLargeReverts() public {
        address[] memory accounts = new address[](501);
        for (uint256 i = 0; i < 501; i++) {
            accounts[i] = address(uint160(i + 1));
        }

        vm.prank(eligibilityAdmin);
        vm.expectRevert(abi.encodeWithSelector(Faucet.BatchTooLarge.selector, 501, 500));
        faucet.setEligibleBatch(accounts, true);
    }

    function test_setEligibleBatchAtMaxSizeSucceeds() public {
        address[] memory accounts = new address[](500);
        for (uint256 i = 0; i < 500; i++) {
            accounts[i] = address(uint160(i + 1));
        }

        vm.prank(eligibilityAdmin);
        faucet.setEligibleBatch(accounts, true);
        assertTrue(faucet.isEligible(address(uint160(1))));
        assertTrue(faucet.isEligible(address(uint160(500))));
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

    // ── D-02: lifetime lobster cap ──

    /// @dev The cap is the population the 70M CLAW pre-mint is sized for: 10,000 wallets x 5.
    function test_D02_capMatchesTheDripPopulation() public view {
        assertEq(faucet.MAX_FAUCET_LOBSTERS(), 50_000);
        assertEq(faucet.MAX_FAUCET_LOBSTERS() / faucet.LOBSTERS_PER_CLAIM(), 70_000_000e18 / faucet.CLAW_DRIP_AMOUNT());
    }

    function test_D02_lastClaimUnderTheCapSucceedsAndTheNextReverts() public {
        // Jump the counter to one claim below the cap instead of minting 49,995 lobsters.
        stdstore.target(address(faucet)).sig("totalLobstersClaimed()").checked_write(faucet.MAX_FAUCET_LOBSTERS() - 5);

        _makeEligible(alice);
        vm.prank(alice);
        faucet.claimLobsters();
        assertEq(faucet.totalLobstersClaimed(), faucet.MAX_FAUCET_LOBSTERS());

        // A stolen eligibility key can still whitelist — it just cannot mint past the cap.
        _makeEligible(bob);
        vm.prank(bob);
        vm.expectRevert(Faucet.FaucetLobsterCapReached.selector);
        faucet.claimLobsters();
        assertFalse(faucet.hasClaimedLobsters(bob));
    }

    function test_D02_aPartialClaimCannotStraddleTheCap() public {
        stdstore.target(address(faucet)).sig("totalLobstersClaimed()").checked_write(faucet.MAX_FAUCET_LOBSTERS() - 4);
        _makeEligible(alice);
        vm.prank(alice);
        vm.expectRevert(Faucet.FaucetLobsterCapReached.selector);
        faucet.claimLobsters();
    }

    function test_claimLobstersEmitsEvent() public {
        _makeEligible(alice);

        // D-10: the request announces the claim and its target block...
        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit Faucet.LobsterClaimRequested(1, alice, block.number + 2);
        uint256 claimId = faucet.claimLobsters();

        // ...and the lobsters are announced when they exist.
        vm.roll(block.number + 3);
        vm.expectEmit(true, false, false, false);
        emit Faucet.LobstersClaimed(alice, [uint256(0), 0, 0, 0, 0]); // ids need not match
        faucet.finalizeClaim(claimId);
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

    // ──────────── S-01: Pre-funded faucet (no mint) ────────────

    function test_claimClawTransfersFromFaucetBalance() public {
        uint256 faucetBalanceBefore = claw.balanceOf(address(faucet));
        uint256 totalSupplyBefore = claw.totalSupply();

        _claimLobsters(alice);
        vm.prank(alice);
        faucet.claimClaw();

        // Faucet balance decreased by drip amount
        assertEq(claw.balanceOf(address(faucet)), faucetBalanceBefore - 7_000e18);
        // Total supply unchanged — no new minting occurred
        assertEq(claw.totalSupply(), totalSupplyBefore);
        // Alice received the drip
        assertEq(claw.balanceOf(alice), 7_000e18);
    }

    function test_claimClawRevertsWhenFaucetBalanceInsufficient() public {
        // Deploy a faucet with no pre-funded balance
        vm.startPrank(admin);
        Faucet emptyFaucet = new Faucet(admin, address(nft), address(claw), closeTime);
        nft.grantRole(nft.MINTER_ROLE(), address(emptyFaucet));
        emptyFaucet.grantRole(emptyFaucet.ELIGIBILITY_ROLE(), eligibilityAdmin);
        vm.stopPrank();

        vm.prank(eligibilityAdmin);
        emptyFaucet.setEligible(alice, true);

        vm.prank(alice);
        uint256 claimId = emptyFaucet.claimLobsters();
        vm.roll(block.number + 3);
        emptyFaucet.finalizeClaim(claimId); // D-10: the drip waits for the lobsters

        vm.prank(alice);
        vm.expectRevert(Faucet.InsufficientFaucetBalance.selector);
        emptyFaucet.claimClaw();
    }

    function test_faucetClaimDoesNotAffectMiningSupply() public {
        // Record remaining mintable before faucet claim
        uint256 remainableBefore = claw.remainingMintable();

        _claimLobsters(alice);
        vm.prank(alice);
        faucet.claimClaw();

        // Remaining mintable unchanged — faucet claim is a transfer, not a mint
        assertEq(claw.remainingMintable(), remainableBefore);
    }

    // ──────────── Fuzz ────────────

    function testFuzz_claimLobstersProducesValidDNA(uint256 seed) public {
        // Use seed to set prevrandao
        vm.prevrandao(bytes32(seed));

        address claimer = makeAddr("claimer");
        vm.deal(claimer, 1 ether);
        _makeEligible(claimer);

        vm.prank(claimer);
        uint256[5] memory tokenIds = _finalize(faucet.claimLobsters());

        for (uint256 i = 0; i < 5; i++) {
            uint256 dna = nft.getDNA(tokenIds[i]);
            assertTrue(DNALib.isValid(dna));
            assertEq(DNALib.decodeLegend(dna), 0);
            assertLt(DNALib.decodeClass(dna), 10);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Phase 2 Faucet pass — L-05 regression + coverage
    // ─────────────────────────────────────────────────────────────

    // L-05: re-entrant claimers cannot re-enter into the faucet mid-flow.
    // The ERC-1155 mints inside claimLobsters invoke onERC1155Received on
    // contract claimers; a malicious contract could try to re-enter.
    // Pre-fix, the hasClaimedLobsters flag was set before mints so
    // claimLobsters re-entry was blocked by the flag — but claimClaw
    // could still be re-entered. Post-fix, nonReentrant on both
    // entrypoints blocks same-tx re-entry uniformly.
    function test_L05_nonReentrant_blocksReentryIntoClaimClaw() public {
        ReentrantClaimer attacker = new ReentrantClaimer(faucet);
        vm.deal(address(attacker), 1 ether);

        vm.prank(eligibilityAdmin);
        faucet.setEligible(address(attacker), true);

        // Attacker's onERC1155Received re-enters claimClaw during the
        // first mint. Pre-fix (no guard): re-entry into claimClaw would
        // succeed, granting CLAW before claimLobsters even finished.
        // Post-fix: ReentrancyGuard in claimLobsters reverts the re-enter.
        // D-10: the mints (and with them the callback) moved to finalizeClaim, which carries the
        // same guard. The request itself makes no external call.
        vm.prank(address(attacker));
        uint256 claimId = attacker.attack();
        vm.roll(block.number + 3);
        vm.expectRevert(); // ReentrancyGuardReentrantCall, from claimClaw inside the mint callback
        faucet.finalizeClaim(claimId);
        assertFalse(faucet.hasClaimedClaw(address(attacker)));
    }

    // ──────────── D-10: the roll cannot be known, chosen or retried ────────────

    function _request(address account) internal returns (uint256 claimId) {
        _makeEligible(account);
        vm.prank(account);
        claimId = faucet.claimLobsters();
    }

    function _classes(uint256[5] memory ids) internal view returns (uint8[5] memory c) {
        for (uint256 i = 0; i < 5; i++) c[i] = DNALib.decodeClass(nft.getDNA(ids[i]));
    }

    function test_D10_claimCommitsButMintsNothing() public {
        uint256 claimId = _request(alice);
        assertEq(claimId, 1);
        assertEq(faucet.claimIdOf(alice), 1);
        assertTrue(faucet.hasClaimedLobsters(alice), "committed: no second claim, no way back");
        assertEq(faucet.totalLobstersClaimed(), 5, "counted against the cap at once");
        assertEq(nft.nextTokenId(), 1, "nothing minted yet");

        Faucet.LobsterClaim memory c = faucet.getClaim(claimId);
        assertEq(c.claimer, alice);
        assertEq(c.targetBlock, block.number + 2);
        assertFalse(c.finalized);
    }

    function test_D10_anyoneFinalizes_lobstersGoToTheClaimer() public {
        uint256 claimId = _request(alice);
        uint256[5] memory ids = _finalize(claimId); // sent by "keeper"
        for (uint256 i = 0; i < 5; i++) {
            assertEq(nft.ownerOf(ids[i]), alice);
            assertTrue(nft.isSoulbound(ids[i]));
        }
        assertTrue(faucet.getClaim(claimId).finalized);
    }

    function test_D10_cannotFinalizeBeforeTheTargetBlockHasAHash() public {
        uint256 claimId = _request(alice);
        uint256 target = faucet.getClaim(claimId).targetBlock;

        vm.expectRevert(abi.encodeWithSelector(Faucet.TooEarlyToFinalize.selector, claimId, target));
        faucet.finalizeClaim(claimId); // same block as the request
        vm.roll(target);
        vm.expectRevert(abi.encodeWithSelector(Faucet.TooEarlyToFinalize.selector, claimId, target));
        faucet.finalizeClaim(claimId); // blockhash(target) does not exist while target is being built
        vm.roll(target + 1);
        faucet.finalizeClaim(claimId);
    }

    /// @dev THE DEFECT. The old seed was keccak(prevrandao, msg.sender, index, timestamp): every
    ///      input known before signing, so the claimer could compute all five lobsters for any
    ///      upcoming block and claim only in a good one. Here two claims are identical in every
    ///      respect the claimer can see or choose — same wallet, same block, same timestamp, same
    ///      prevrandao — and the lobsters still differ, because they come from a block hash that
    ///      did not exist when the claim was signed.
    function test_D10_theRollIsNotAFunctionOfAnythingKnownAtClaimTime() public {
        vm.prevrandao(bytes32(uint256(0xC1A8)));
        uint256 snap = vm.snapshotState();

        uint256 claimId = _request(alice);
        uint256 target = faucet.getClaim(claimId).targetBlock;
        vm.roll(target + 1);
        vm.setBlockhash(target, keccak256("one future"));
        uint8[5] memory first = _classes(faucet.finalizeClaim(claimId));
        uint256 dnaFirst = nft.getDNA(1);

        vm.revertToState(snap);
        claimId = _request(alice); // byte-for-byte the same claim transaction
        vm.roll(target + 1);
        vm.setBlockhash(target, keccak256("another future"));
        uint8[5] memory second = _classes(faucet.finalizeClaim(claimId));

        assertTrue(dnaFirst != nft.getDNA(1), "same claim, different future block => different lobsters");
        first; second;
    }

    /// @dev ...and whoever finalizes cannot steer it either: the block they finalize in, its
    ///      timestamp and its prevrandao are not inputs.
    function test_D10_theFinalizerCannotGrind() public {
        uint256 claimId = _request(alice);
        uint256 target = faucet.getClaim(claimId).targetBlock;
        uint256 snap = vm.snapshotState();

        vm.roll(target + 1);
        vm.setBlockhash(target, keccak256("fixed"));
        faucet.finalizeClaim(claimId);
        uint256 dnaEarly = nft.getDNA(1);

        vm.revertToState(snap);
        vm.roll(target + 200);
        vm.warp(block.timestamp + 3 hours);
        vm.prevrandao(bytes32(uint256(777)));
        vm.setBlockhash(target, keccak256("fixed")); // the same past block, seen from later
        vm.prank(bob);
        faucet.finalizeClaim(claimId);
        assertEq(nft.getDNA(1), dnaEarly, "when, and by whom, it is finalized changes nothing");
    }

    /// @dev The risk-free grinder: an account with code (a smart wallet, or an EOA delegated
    ///      under EIP-7702) that inspects the roll inside onERC1155Received and reverts unless it
    ///      likes it. Before D-10 the claim flag and the mints were one transaction, so a revert
    ///      bought a fresh roll in the next block for the price of gas. Now a revert buys
    ///      NOTHING: the claim stays committed to the same block hash.
    function test_D10_revertingOnABadRollDoesNotBuyANewOne() public {
        PickyClaimer picky = new PickyClaimer(faucet, nft);
        vm.deal(address(picky), 1 ether);
        _makeEligible(address(picky));
        uint256 claimId = picky.claim();
        uint256 target = faucet.getClaim(claimId).targetBlock;

        for (uint256 attempt = 1; attempt <= 5; attempt++) {
            vm.roll(target + attempt);
            vm.setBlockhash(target, keccak256("a roll the grinder dislikes"));
            vm.expectRevert(PickyClaimer.BadRoll.selector);
            faucet.finalizeClaim(claimId);
        }
        assertTrue(faucet.hasClaimedLobsters(address(picky)), "still committed");
        assertEq(faucet.getClaim(claimId).targetBlock, target, "still the same block: no re-roll");

        // It cannot swap the known roll for a fresh one while that block hash is still reachable.
        vm.expectRevert(abi.encodeWithSelector(Faucet.ClaimNotExpired.selector, claimId));
        faucet.rearmClaim(claimId);
        // And it cannot start over.
        vm.expectRevert(Faucet.LobstersAlreadyClaimed.selector);
        picky.claim();
    }

    function test_D10_anExpiredClaimIsRearmedNotLost() public {
        uint256 claimId = _request(alice);
        uint256 target = faucet.getClaim(claimId).targetBlock;

        vm.roll(target + 257); // the keeper was down for 9 minutes: blockhash(target) is gone
        vm.expectRevert(abi.encodeWithSelector(Faucet.ClaimExpired.selector, claimId));
        faucet.finalizeClaim(claimId);

        vm.expectEmit(true, false, false, true);
        emit Faucet.LobsterClaimRearmed(claimId, block.number + 2);
        vm.prank(bob); // permissionless
        faucet.rearmClaim(claimId);
        assertEq(faucet.getClaim(claimId).targetBlock, block.number + 2, "a NEW future block");

        uint256[5] memory ids = _finalize(claimId);
        assertEq(nft.ownerOf(ids[4]), alice, "nothing was lost");
        assertEq(faucet.totalLobstersClaimed(), 5, "and nothing was double-counted");
    }

    function test_D10_rearmIsOnlyForClaimsThatReallyExpired() public {
        uint256 claimId = _request(alice);
        vm.expectRevert(abi.encodeWithSelector(Faucet.ClaimNotExpired.selector, claimId));
        faucet.rearmClaim(claimId); // target not even reached
        vm.roll(block.number + 100);
        vm.expectRevert(abi.encodeWithSelector(Faucet.ClaimNotExpired.selector, claimId));
        faucet.rearmClaim(claimId); // hash still available
        _finalize(claimId);
        vm.roll(block.number + 400);
        vm.expectRevert(abi.encodeWithSelector(Faucet.ClaimAlreadyFinalized.selector, claimId));
        faucet.rearmClaim(claimId);
        vm.expectRevert(abi.encodeWithSelector(Faucet.ClaimDoesNotExist.selector, 99));
        faucet.rearmClaim(99);
    }

    /// @dev Where the chain has the EIP-2935 history contract, a claim survives ~4.5 h instead of
    ///      ~8.5 min before it needs re-arming.
    function test_D10_historyContractExtendsTheWindow() public {
        uint256 claimId = _request(alice);
        uint256 target = faucet.getClaim(claimId).targetBlock;
        vm.roll(target + 5_000);
        assertEq(blockhash(target), bytes32(0), "out of the native window");

        MockBlockHistory history = new MockBlockHistory();
        vm.etch(0x0000F90827F1C53a10cb7A02335B175320002935, address(history).code);
        MockBlockHistory(0x0000F90827F1C53a10cb7A02335B175320002935).set(target, keccak256("from history"));

        vm.expectRevert(abi.encodeWithSelector(Faucet.ClaimNotExpired.selector, claimId));
        faucet.rearmClaim(claimId); // not expired: the hash is retrievable
        faucet.finalizeClaim(claimId);
        assertEq(nft.ownerOf(1), alice);
    }

    function test_D10_clawDripWaitsForTheLobsters() public {
        uint256 claimId = _request(alice);
        vm.prank(alice);
        vm.expectRevert(Faucet.LobsterClaimPending.selector);
        faucet.claimClaw(); // requested, but she does not hold her lobsters yet
        _finalize(claimId);
        vm.prank(alice);
        faucet.claimClaw();
        assertEq(claw.balanceOf(alice), 7_000e18);
    }

    function test_D10_aClaimMadeInTheLastMinuteFinalizesAfterClose() public {
        vm.warp(closeTime - 1);
        uint256 claimId = _request(alice);
        vm.warp(closeTime + 1 hours);
        uint256[5] memory ids = _finalize(claimId);
        assertEq(nft.ownerOf(ids[0]), alice);
    }

    function test_D10_twoClaimsOnTheSameBlockRollDifferentLobsters() public {
        uint256 a = _request(alice);
        uint256 b = _request(bob);
        assertEq(faucet.getClaim(a).targetBlock, faucet.getClaim(b).targetBlock);
        uint256[5] memory idsA = _finalize(a);
        uint256[5] memory idsB = faucet.finalizeClaim(b);
        assertTrue(nft.getDNA(idsA[0]) != nft.getDNA(idsB[0]), "the claimer and claim id are in the seed");
    }

    function test_D10_finalizeGuards() public {
        vm.expectRevert(abi.encodeWithSelector(Faucet.ClaimDoesNotExist.selector, 1));
        faucet.finalizeClaim(1);
        uint256 claimId = _request(alice);
        _finalize(claimId);
        vm.expectRevert(abi.encodeWithSelector(Faucet.ClaimAlreadyFinalized.selector, claimId));
        faucet.finalizeClaim(claimId);
    }

    // ──────────── FAU-M1: burnUnclaimed (burn-only by governance decision 2026-09-02) ────────────

    function test_burnUnclaimed_beforeClose_reverts() public {
        // Faucet still open → burn must revert, so it can never fire mid-window.
        vm.prank(admin);
        vm.expectRevert(Faucet.FaucetStillOpen.selector);
        faucet.burnUnclaimed();
    }

    function test_burnUnclaimed_nonAdmin_reverts() public {
        vm.warp(closeTime);
        vm.prank(alice);
        vm.expectRevert(); // AccessControlUnauthorizedAccount
        faucet.burnUnclaimed();
    }

    function test_burnUnclaimed_afterClose_burnsResidual() public {
        // Alice claims her 7,000 $CLAW drip while the faucet is open.
        _claimLobsters(alice);
        vm.prank(alice);
        faucet.claimClaw();

        uint256 residual = claw.balanceOf(address(faucet));
        assertEq(residual, 70_000_000e18 - 7_000e18, "residual = premint minus one drip");

        // After close, the residual can only be BURNED — no recipient parameter exists.
        vm.warp(closeTime);
        uint256 supplyBefore = claw.totalSupply();

        vm.expectEmit(false, false, false, true, address(faucet));
        emit Faucet.UnclaimedBurned(residual);
        vm.prank(admin);
        faucet.burnUnclaimed();

        assertEq(claw.balanceOf(address(faucet)), 0, "faucet fully drained");
        assertEq(supplyBefore - claw.totalSupply(), residual, "residual destroyed from total supply");
    }
}

/// @dev Contract claimer that re-enters claimClaw during the ERC-1155
///      mint callback. Used to verify L-05 nonReentrant guard blocks
///      reentry in the faucet claim flow.
contract ReentrantClaimer {
    Faucet internal immutable faucet;

    constructor(Faucet faucet_) {
        faucet = faucet_;
    }

    function attack() external returns (uint256) {
        return faucet.claimLobsters();
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata)
        external
        returns (bytes4)
    {
        // Attempt to re-enter claimClaw during the mint callback. Under the
        // L-05 nonReentrant guard on claimLobsters, this MUST revert — and
        // the revert propagates up, reverting the acceptance check, the
        // mint, and the outer claimLobsters call.
        faucet.claimClaw();
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return this.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4) external pure returns (bool) {
        return true;
    }
}


/// @dev D-10: the grinder. Claims, then vetoes any roll whose first lobster is not the class it
///      wants by reverting inside the ERC-1155 acceptance callback.
contract PickyClaimer {
    error BadRoll();

    Faucet internal immutable faucet;
    LobsterNFT internal immutable nft;
    uint8 internal constant WANTED_CLASS = 9;

    constructor(Faucet faucet_, LobsterNFT nft_) {
        faucet = faucet_;
        nft = nft_;
    }

    function claim() external returns (uint256) {
        return faucet.claimLobsters();
    }

    function onERC1155Received(address, address, uint256 id, uint256, bytes calldata) external view returns (bytes4) {
        if (DNALib.decodeClass(nft.getDNA(id)) != WANTED_CLASS) revert BadRoll();
        return this.onERC1155Received.selector;
    }

    function supportsInterface(bytes4) external pure returns (bool) {
        return true;
    }
}

/// @dev Stand-in for the EIP-2935 history contract: 32-byte block number in, block hash out.
contract MockBlockHistory {
    mapping(uint256 => bytes32) internal hashes;

    function set(uint256 n, bytes32 h) external {
        hashes[n] = h;
    }

    fallback(bytes calldata data) external returns (bytes memory) {
        uint256 n = abi.decode(data, (uint256));
        if (hashes[n] == bytes32(0)) revert();
        return abi.encode(hashes[n]);
    }
}

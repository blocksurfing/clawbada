// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Treasury} from "../../Treasury.sol";
import {ClawToken} from "../../ClawToken.sol";

/// @dev Fuzz tests for Treasury fee-split math and access control.
contract FuzzTreasury is Test {
    Treasury   internal treasury;
    ClawToken  internal claw;
    address    internal admin     = makeAddr("admin");
    address    internal devWallet = makeAddr("dev");
    address    internal lpWallet  = makeAddr("lp");
    address    internal reserveWallet = makeAddr("reserve"); // TOK-H1: genesis reserve holder (not the splitter)
    address    internal authorized = makeAddr("authorized");

    function setUp() public {
        vm.startPrank(admin);
        treasury = new Treasury(admin, devWallet);
        // TOK-H1: mint the 100M reserve to a dedicated holder, never the fee-splitter.
        claw     = new ClawToken(admin, lpWallet, reserveWallet);
        treasury.setClawToken(address(claw));
        treasury.setAuthorized(authorized, true);
        claw.grantRole(claw.MINTER_ROLE(), authorized);
        vm.stopPrank();
    }

    // ── Fee split: no token loss ───────────────────────────────────

    function testFuzz_fee_split_no_loss(uint256 amount) public {
        // Cap to realistic amounts — min is BPS_DENOMINATOR per the T-03 guard.
        amount = bound(amount, treasury.BPS_DENOMINATOR(), claw.balanceOf(lpWallet));

        // Give authorized some CLAW
        vm.prank(lpWallet);
        claw.transfer(authorized, amount);

        uint256 devBefore    = claw.balanceOf(devWallet);
        uint256 supplyBefore = claw.totalSupply();

        // Approve treasury then process fee
        vm.startPrank(authorized);
        claw.approve(address(treasury), amount);
        treasury.processFee(amount);
        vm.stopPrank();

        uint256 burned  = supplyBefore - claw.totalSupply();
        uint256 devGot  = claw.balanceOf(devWallet) - devBefore;

        // No dust: burned + devGot == amount
        assertEq(burned + devGot, amount, "burn+dev must equal amount");
    }

    // ── Fee split proportions ─────────────────────────────────────

    function testFuzz_fee_split_proportions(uint256 amount) public {
        // Min = BPS_DENOMINATOR per the T-03 guard (also avoids rounding skew).
        amount = bound(amount, treasury.BPS_DENOMINATOR(), claw.balanceOf(lpWallet));

        vm.prank(lpWallet);
        claw.transfer(authorized, amount);

        uint256 supplyBefore = claw.totalSupply();
        uint256 devBefore    = claw.balanceOf(devWallet);

        vm.startPrank(authorized);
        claw.approve(address(treasury), amount);
        treasury.processFee(amount);
        vm.stopPrank();

        uint256 burned = supplyBefore - claw.totalSupply();
        uint256 devGot = claw.balanceOf(devWallet) - devBefore;

        uint256 expectedBurn = (amount * treasury.BURN_BPS()) / treasury.BPS_DENOMINATOR();
        uint256 expectedDev  = amount - expectedBurn; // remainder avoids rounding dust

        assertEq(burned, expectedBurn, "burn amount");
        assertEq(devGot,  expectedDev,  "dev amount");
    }

    // ── Access control ────────────────────────────────────────────

    function testFuzz_unauthorized_reverts(address caller) public {
        vm.assume(caller != authorized && caller != address(0));

        vm.prank(lpWallet);
        claw.transfer(caller, 1000e18);

        vm.startPrank(caller);
        claw.approve(address(treasury), 1000e18);
        vm.expectRevert(Treasury.NotAuthorized.selector);
        treasury.processFee(1000e18);
        vm.stopPrank();
    }

    function test_zero_amount_reverts() public {
        vm.startPrank(authorized);
        claw.approve(address(treasury), 0);
        vm.expectRevert(Treasury.ZeroAmount.selector);
        treasury.processFee(0);
        vm.stopPrank();
    }

    // ── Token not set ─────────────────────────────────────────────

    function test_claw_token_already_set_reverts() public {
        vm.prank(admin);
        vm.expectRevert(Treasury.TokenAlreadySet.selector);
        treasury.setClawToken(address(claw));
    }

    // ── Dev wallet update ─────────────────────────────────────────

    function test_set_dev_wallet_zero_reverts() public {
        vm.prank(admin);
        vm.expectRevert(Treasury.ZeroAddress.selector);
        treasury.setDevWallet(address(0));
    }

    function testFuzz_set_authorized_zero_reverts() public {
        vm.prank(admin);
        vm.expectRevert(Treasury.ZeroAddress.selector);
        treasury.setAuthorized(address(0), true);
    }

    // ── BPS constants ─────────────────────────────────────────────

    function test_bps_sum_to_10000() public view {
        assertEq(
            treasury.BURN_BPS() + treasury.DEV_BPS(),
            treasury.BPS_DENOMINATOR(),
            "BURN_BPS + DEV_BPS must equal 10000"
        );
    }

    // ─────────────────────────────────────────────────────────────
    // Phase 1 Treasury pass — additional adversarial coverage
    // ─────────────────────────────────────────────────────────────

    // TOK-H1: the Treasury fee-splitter must hold ZERO standing balance — the 100M
    // genesis reserve is minted to a separate holding account (reserveWallet here;
    // a governance Safe in production), never to this contract.
    function test_treasury_holds_zero_reserve() public view {
        assertEq(claw.balanceOf(address(treasury)), 0, "TOK-H1: fee-splitter must not custody the reserve");
        assertEq(claw.balanceOf(reserveWallet), 100_000_000e18, "reserve held by the dedicated account");
    }

    // Zero-delta invariant: processFee must not change Treasury's CLAW
    // balance. The flow pulls `amount`, burns 85%, forwards 15% — net
    // balance delta of zero. Treasury holds no standing balance (TOK-H1),
    // so this also confirms processFee never makes it accumulate.
    function testFuzz_treasury_never_accumulates(uint256 amount) public {
        amount = bound(amount, treasury.BPS_DENOMINATOR(), claw.balanceOf(lpWallet) / 10);

        uint256 balBefore = claw.balanceOf(address(treasury));

        vm.prank(lpWallet);
        claw.transfer(authorized, amount);

        vm.startPrank(authorized);
        claw.approve(address(treasury), amount);
        treasury.processFee(amount);
        vm.stopPrank();

        assertEq(claw.balanceOf(address(treasury)), balBefore, "Treasury balance unchanged by processFee");
    }

    // Same zero-delta property across multiple sequential calls, fuzzing
    // each amount. Catches any cumulative drift.
    function testFuzz_treasury_zero_across_multiple_calls(uint256 amt1, uint256 amt2, uint256 amt3) public {
        uint256 minAmt = treasury.BPS_DENOMINATOR();
        amt1 = bound(amt1, minAmt, claw.balanceOf(lpWallet) / 10);
        amt2 = bound(amt2, minAmt, claw.balanceOf(lpWallet) / 10);
        amt3 = bound(amt3, minAmt, claw.balanceOf(lpWallet) / 10);

        uint256 balBefore = claw.balanceOf(address(treasury));
        _doFee(amt1);
        assertEq(claw.balanceOf(address(treasury)), balBefore, "after call 1");
        _doFee(amt2);
        assertEq(claw.balanceOf(address(treasury)), balBefore, "after call 2");
        _doFee(amt3);
        assertEq(claw.balanceOf(address(treasury)), balBefore, "after call 3");
    }

    function _doFee(uint256 amount) internal {
        vm.prank(lpWallet);
        claw.transfer(authorized, amount);
        vm.startPrank(authorized);
        claw.approve(address(treasury), amount);
        treasury.processFee(amount);
        vm.stopPrank();
    }

    // setDevWallet routes future fees to the new wallet. Prior fees
    // already burned/sent — this only affects subsequent calls.
    function test_setDevWallet_routesNewFees() public {
        address newDev = makeAddr("newDev");

        // First fee goes to old wallet
        _doFee(1_000e18);
        uint256 oldDevBefore = claw.balanceOf(devWallet);
        _doFee(1_000e18);
        uint256 oldDevAfter = claw.balanceOf(devWallet);
        assertGt(oldDevAfter, oldDevBefore, "old dev received from 2nd fee");

        // Update dev wallet
        vm.prank(admin);
        treasury.setDevWallet(newDev);

        // Future fees go to new wallet
        uint256 newDevBefore = claw.balanceOf(newDev);
        uint256 oldDevBefore2 = claw.balanceOf(devWallet);
        _doFee(1_000e18);
        assertGt(claw.balanceOf(newDev), newDevBefore, "new dev received");
        assertEq(claw.balanceOf(devWallet), oldDevBefore2, "old dev balance unchanged");
    }

    // Revoking authorization blocks future processFee calls from that
    // account — temporary DoS path, not fund loss.
    function test_setAuthorized_revoke_blocksFutureFees() public {
        // Authorized can process
        _doFee(1_000e18);

        // Revoke
        vm.prank(admin);
        treasury.setAuthorized(authorized, false);

        // Next call reverts
        vm.prank(lpWallet);
        claw.transfer(authorized, 1_000e18);

        vm.startPrank(authorized);
        claw.approve(address(treasury), 1_000e18);
        vm.expectRevert(Treasury.NotAuthorized.selector);
        treasury.processFee(1_000e18);
        vm.stopPrank();
    }

    // Ownable2Step: ownership transfer requires acceptance. A
    // compromised owner cannot silently hand off to a puppet; the new
    // owner must explicitly accept, and the old owner retains
    // privileges until then.
    function test_ownable2Step_transferRequires2Steps() public {
        address newOwner = makeAddr("newOwner");

        // Step 1: current owner proposes
        vm.prank(admin);
        treasury.transferOwnership(newOwner);

        // Ownership not yet transferred — admin still owns
        assertEq(treasury.owner(), admin, "admin still owner pre-accept");
        assertEq(treasury.pendingOwner(), newOwner, "newOwner pending");

        // admin's privileges intact
        vm.prank(admin);
        treasury.setDevWallet(makeAddr("interimDev"));

        // Step 2: newOwner accepts
        vm.prank(newOwner);
        treasury.acceptOwnership();

        assertEq(treasury.owner(), newOwner, "ownership transferred after acceptance");
        assertEq(treasury.pendingOwner(), address(0), "pending cleared");

        // admin no longer has owner privileges
        vm.prank(admin);
        vm.expectRevert();
        treasury.setDevWallet(makeAddr("ghost"));
    }

    // Fee-split math holds at MAX_SUPPLY (upper bound on any realistic
    // single fee amount). Pure arithmetic check — no state exercise.
    function test_processFee_math_holds_at_max_supply() public view {
        uint256 maxSupply = claw.MAX_SUPPLY();
        uint256 burnAtMax = (maxSupply * treasury.BURN_BPS()) / treasury.BPS_DENOMINATOR();
        uint256 devAtMax = maxSupply - burnAtMax;
        assertEq(burnAtMax + devAtMax, maxSupply, "full-supply split preserves sum");
        // MAX_SUPPLY × 8500 = 8.5e30, well under uint256.max (~1.16e77).
        // No realistic overflow path through processFee.
    }

    // T-03: processFee rejects amounts below BPS_DENOMINATOR. Prevents an
    // authorized caller from chunking a fee into tiny pieces that all
    // round the burn leg to zero and send 100% to dev.
    function testFuzz_T03_processFee_belowMin_reverts(uint256 amount) public {
        amount = bound(amount, 1, treasury.BPS_DENOMINATOR() - 1);

        vm.prank(lpWallet);
        claw.transfer(authorized, amount);

        vm.startPrank(authorized);
        claw.approve(address(treasury), amount);
        vm.expectRevert(
            abi.encodeWithSelector(Treasury.AmountBelowMinimum.selector, amount, treasury.BPS_DENOMINATOR())
        );
        treasury.processFee(amount);
        vm.stopPrank();
    }

    // T-03: at exactly the minimum, processFee succeeds and the split math
    // holds (burn leg is positive, dev leg is positive, sum = amount).
    function test_T03_processFee_atMin_succeeds() public {
        uint256 amount = treasury.BPS_DENOMINATOR(); // 10_000 wei

        vm.prank(lpWallet);
        claw.transfer(authorized, amount);

        uint256 supplyBefore = claw.totalSupply();
        uint256 devBefore = claw.balanceOf(devWallet);

        vm.startPrank(authorized);
        claw.approve(address(treasury), amount);
        treasury.processFee(amount);
        vm.stopPrank();

        uint256 burned = supplyBefore - claw.totalSupply();
        uint256 devGot = claw.balanceOf(devWallet) - devBefore;

        assertEq(burned + devGot, amount, "sum preserved at minimum");
        assertEq(burned, (amount * treasury.BURN_BPS()) / treasury.BPS_DENOMINATOR(), "burn at min matches spec");
    }

    // T-04: setDevWallet must reject this contract's own address. Without
    // the guard, the 15% leg would transfer to Treasury itself (a no-op
    // under OZ ERC20 self-transfer) and silently accumulate with no sweep.
    function test_T04_setDevWallet_self_reverts() public {
        vm.prank(admin);
        vm.expectRevert(Treasury.InvalidDevWallet.selector);
        treasury.setDevWallet(address(treasury));
    }

    // T-04: constructor also rejects Treasury-as-devWallet, though in
    // practice this requires CREATE2 with a precomputed address.
    function test_T04_constructor_selfDev_reverts() public {
        // Precompute Treasury's address via nonce math is not practical here,
        // but we can verify the guard triggers when an attacker (or typo) passes
        // an arbitrary contract address that equals the future Treasury. The
        // simplest proxy: use vm.computeCreateAddress and pass that.
        address deployer = makeAddr("guarded-deployer");
        uint64 nonce = vm.getNonce(deployer);
        address futureTreasury = vm.computeCreateAddress(deployer, nonce);

        vm.prank(deployer);
        vm.expectRevert(Treasury.InvalidDevWallet.selector);
        new Treasury(admin, futureTreasury);
    }
}

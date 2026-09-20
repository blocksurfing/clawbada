// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {DeployHelpers} from "../script/DeployHelpers.s.sol";
import {DeploymentChecks} from "../script/DeploymentChecks.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {Configure} from "../script/Configure.s.sol";
import {Handoff} from "../script/Handoff.s.sol";
import {ClawToken} from "../ClawToken.sol";
import {Treasury} from "../Treasury.sol";
import {MiningPool} from "../MiningPool.sol";
import {BattleArena} from "../BattleArena.sol";
import {MockSafe} from "./helpers/MockSafe.sol";

/// @dev Everything the scripts normally read from env, handed over directly. Tests inside
///      one contract run in parallel and vm.setEnv is process-wide, so only ONE test below
///      (the _loadEnv one) touches env at all.
struct Params {
    address deployer;
    address devWallet;
    address reserve;
    address lp;
    address safe;
    address eligOp;
    address matchmaker;
    address resolver;
    address vrfOp;
    address boostAdmin;
    uint256 minSafeThreshold;
}

abstract contract ParamHarness is DeployHelpers {
    function setParams(Params memory p) external {
        deployer = p.deployer;
        devWallet = p.devWallet;
        treasuryReserveAddress = p.reserve;
        lpRecipient = p.lp;
        governanceSafe = p.safe;
        eligibilityOperator = p.eligOp;
        matchmakerAddress = p.matchmaker;
        resolverAddress = p.resolver;
        vrfOperatorAddress = p.vrfOp;
        boostAdminAddress = p.boostAdmin;
        minSafeThreshold = p.minSafeThreshold;
    }
}

/// @dev The REAL script bodies (_deployAll / _configureAll / _propose / _finalize / _retract),
///      sent as the deployer. vm.startPrank stands in for vm.startBroadcast.
contract DeployHarness is ParamHarness, Deploy {
    function deployAll() external returns (Deployment memory d) {
        vm.startPrank(deployer);
        d = _deployAll();
        vm.stopPrank();
    }

    function loadEnv() external {
        _loadEnv();
    }
}

contract ConfigureHarness is ParamHarness, Configure {
    function configureAll(Deployment memory d) external {
        vm.startPrank(deployer);
        _configureAll(d);
        vm.stopPrank();
    }
}

contract HandoffHarness is ParamHarness, Handoff {
    function propose(Deployment memory d) external {
        vm.startPrank(deployer);
        _propose(d);
        vm.stopPrank();
    }

    function finalizeHandoff(Deployment memory d) external {
        vm.startPrank(deployer);
        _finalize(d);
        vm.stopPrank();
    }

    function retractFrom(Deployment memory d, address wrong) external {
        vm.startPrank(deployer);
        _retract(d, wrong);
        vm.stopPrank();
    }

    function requireHandoffEnv() external view {
        _requireHandoffEnv();
    }

    function checkConfigured(Deployment memory d) external view {
        DeploymentChecks.requireConfigured(d, deployer, _hotKeys());
    }

    function checkProposed(Deployment memory d) external view {
        DeploymentChecks.requireProposed(d, _adminContracts(d), deployer, governanceSafe, eligibilityOperator);
    }

    function checkFinalized(Deployment memory d) external view {
        DeploymentChecks.requireFinalized(d, _adminContracts(d), deployer, governanceSafe, eligibilityOperator);
    }
}

contract NotASafe {
    function hello() external pure returns (uint256) {
        return 1;
    }
}

/// @title DeployScriptsTest
/// @notice Audit 2026-09 D-11 / D-23 / D-24 / D-26: the launch sequence, run from the real
///         scripts — Deploy -> Configure -> Handoff phase 1 -> Safe accepts -> phase 2 —
///         with the stage checks VerifyDeployment.s.sol uses asserted at every step.
contract DeployScriptsTest is Test {
    bytes32 internal constant DEFAULT_ADMIN_ROLE = 0x00;
    bytes internal constant NO_PROOF =
        bytes("handoff: the safe has not called Treasury.acceptOwnership() - no proof it can sign on this chain");

    DeployHarness internal deployH;
    ConfigureHarness internal configureH;
    HandoffHarness internal handoffH;
    MockSafe internal safe;
    Params internal p;

    function setUp() public {
        deployH = new DeployHarness();
        configureH = new ConfigureHarness();
        handoffH = new HandoffHarness();
        safe = _safe(3, 5);

        p = Params({
            deployer: makeAddr("deployer"),
            devWallet: makeAddr("devWallet"),
            reserve: makeAddr("reserveSafe"),
            lp: makeAddr("lpRecipient"),
            safe: address(safe),
            eligOp: makeAddr("eligibilityOperator"),
            matchmaker: makeAddr("matchmaker"),
            resolver: makeAddr("resolver"),
            vrfOp: makeAddr("vrfOperator"),
            boostAdmin: makeAddr("boostAdmin"),
            minSafeThreshold: 3
        });
        _push();
    }

    function _safe(uint256 threshold, uint256 owners) internal returns (MockSafe) {
        address[] memory o = new address[](owners);
        for (uint256 i = 0; i < owners; i++) {
            o[i] = address(uint160(0x5afe0000 + i));
        }
        return new MockSafe(o, threshold);
    }

    function _push() internal {
        deployH.setParams(p);
        configureH.setParams(p);
        handoffH.setParams(p);
    }

    function _deployAndConfigure() internal returns (DeployHelpers.Deployment memory d) {
        d = deployH.deployAll();
        configureH.configureAll(d);
    }

    function _safeAccepts(DeployHelpers.Deployment memory d) internal {
        safe.exec(d.treasury, abi.encodeWithSignature("acceptOwnership()"));
    }

    // ───────────────────────── the whole sequence ─────────────────────────

    function test_full_launch_sequence_from_the_real_scripts() public {
        DeployHelpers.Deployment memory d = deployH.deployAll();

        // D-24: the 125M LP allocation never touches the deploy key.
        ClawToken claw = ClawToken(d.clawToken);
        assertEq(claw.balanceOf(p.lp), 125_000_000e18, "LP allocation -> LP_RECIPIENT");
        assertEq(claw.balanceOf(p.deployer), 0, "deployer holds no CLAW at genesis");
        assertEq(claw.balanceOf(p.reserve), 100_000_000e18, "reserve -> TREASURY_RESERVE_ADDRESS");

        configureH.configureAll(d);
        handoffH.checkConfigured(d);

        handoffH.propose(d);
        handoffH.checkProposed(d);
        // Not complete: the deployer still governs, and the end-state check says so.
        assertTrue(IAccessControl(d.battleArena).hasRole(DEFAULT_ADMIN_ROLE, p.deployer), "deployer still admin");
        vm.expectRevert(NO_PROOF);
        handoffH.checkFinalized(d);

        _safeAccepts(d);
        handoffH.finalizeHandoff(d);
        handoffH.checkFinalized(d);

        assertEq(Treasury(d.treasury).owner(), address(safe), "safe owns Treasury");
        assertFalse(IAccessControl(d.battleArena).hasRole(DEFAULT_ADMIN_ROLE, p.deployer), "deployer lost admin");
        assertTrue(IAccessControl(d.battleArena).hasRole(DEFAULT_ADMIN_ROLE, address(safe)), "safe is admin");
        // Hot roles are untouched by the handoff.
        assertTrue(
            IAccessControl(d.battleArena).hasRole(BattleArena(d.battleArena).RESOLVER_ROLE(), p.resolver),
            "resolver keeps RESOLVER_ROLE"
        );
    }

    // ───────────────────────── D-11 ─────────────────────────

    function test_D11_script_finalize_refuses_without_the_safes_acceptance() public {
        DeployHelpers.Deployment memory d = _deployAndConfigure();
        handoffH.propose(d);

        vm.expectRevert(NO_PROOF);
        handoffH.finalizeHandoff(d);
    }

    function test_D11_wrong_safe_recovered_through_the_scripts() public {
        DeployHelpers.Deployment memory d = _deployAndConfigure();

        address right = p.safe;
        p.safe = makeAddr("safe address copied from another chain");
        _push();
        handoffH.propose(d);

        p.safe = right;
        _push();
        handoffH.retractFrom(d, makeAddr("safe address copied from another chain"));
        handoffH.propose(d);
        _safeAccepts(d);
        handoffH.finalizeHandoff(d);
        handoffH.checkFinalized(d);

        assertFalse(
            IAccessControl(d.miningPool).hasRole(DEFAULT_ADMIN_ROLE, makeAddr("safe address copied from another chain")),
            "the wrong address holds nothing"
        );
    }

    function test_D11_mainnet_rejects_safe_with_no_code() public {
        vm.chainId(8453);
        p.safe = makeAddr("eoa pasted from the wrong row");
        _push();
        vm.expectRevert(bytes("GOVERNANCE_SAFE has no code on this chain"));
        handoffH.requireHandoffEnv();
    }

    function test_D11_mainnet_rejects_contract_that_is_not_a_safe() public {
        vm.chainId(8453);
        p.safe = address(new NotASafe());
        _push();
        vm.expectRevert(bytes("GOVERNANCE_SAFE is not a Safe (getThreshold failed)"));
        handoffH.requireHandoffEnv();
    }

    function test_D11_mainnet_enforces_signer_threshold() public {
        vm.chainId(8453);

        p.safe = address(_safe(2, 3)); // below the 3-of-n policy default
        _push();
        vm.expectRevert(bytes("GOVERNANCE_SAFE signer threshold is below policy (MIN_SAFE_THRESHOLD)"));
        handoffH.requireHandoffEnv();

        p.minSafeThreshold = 2; // an explicit, visible choice to accept 2-of-3
        _push();
        handoffH.requireHandoffEnv();

        p.safe = address(_safe(1, 1)); // never, whatever MIN_SAFE_THRESHOLD says
        p.minSafeThreshold = 1;
        _push();
        vm.expectRevert(bytes("GOVERNANCE_SAFE signer threshold is below policy (MIN_SAFE_THRESHOLD)"));
        handoffH.requireHandoffEnv();
    }

    function test_D11_offMainnet_tolerates_an_eoa_safe() public {
        p.safe = makeAddr("testnet eoa");
        _push();
        handoffH.requireHandoffEnv(); // chain 31337: warns, does not revert
    }

    // ───────────────────────── D-23 ─────────────────────────

    function test_D23_handoff_refuses_to_start_before_configure() public {
        DeployHelpers.Deployment memory d = deployH.deployAll();
        vm.expectRevert(bytes("verify: MiningPool lacks ClawToken MINTER_ROLE"));
        handoffH.propose(d);
    }

    /// @dev Configure's LAST transaction revokes ClawToken MINTER_ROLE from the deploy key.
    ///      forge broadcasts are not atomic; this is that transaction never landing.
    function test_D23_dropped_minter_revoke_is_caught() public {
        DeployHelpers.Deployment memory d = _deployAndConfigure();
        ClawToken claw = ClawToken(d.clawToken);
        bytes32 minter = claw.MINTER_ROLE();
        vm.prank(p.deployer);
        claw.grantRole(minter, p.deployer);

        bytes memory err =
            bytes("verify: deployer still holds ClawToken MINTER_ROLE (Configure's final revoke did not land)");
        vm.expectRevert(err);
        handoffH.checkConfigured(d);
        vm.expectRevert(err);
        handoffH.propose(d);
    }

    function test_D23_missing_treasury_authorization_is_caught() public {
        DeployHelpers.Deployment memory d = _deployAndConfigure();
        vm.prank(p.deployer);
        Treasury(d.treasury).setAuthorized(d.battleArena, false);

        vm.expectRevert(bytes("verify: Treasury has not authorized BattleArena"));
        handoffH.checkConfigured(d);
    }

    function test_D23_hot_role_on_the_wrong_address_is_caught() public {
        DeployHelpers.Deployment memory d = _deployAndConfigure();
        p.resolver = makeAddr("the address ops believes is the resolver");
        _push();
        vm.expectRevert(bytes("verify: expected holder lacks BattleArena RESOLVER_ROLE"));
        handoffH.checkConfigured(d);
    }

    function test_D23_deployer_holding_a_hot_role_is_caught() public {
        DeployHelpers.Deployment memory d = _deployAndConfigure();
        MiningPool pool = MiningPool(d.miningPool);
        bytes32 boost = pool.BOOST_ADMIN_ROLE();
        vm.prank(p.deployer);
        pool.grantRole(boost, p.deployer);

        vm.expectRevert(bytes("verify: deployer holds MiningPool BOOST_ADMIN_ROLE"));
        handoffH.checkConfigured(d);
    }

    /// @dev The testnet/local fallback: every hot role on the deployer is a valid configuration.
    function test_D23_single_key_testnet_configuration_verifies() public {
        p.matchmaker = p.deployer;
        p.resolver = p.deployer;
        p.vrfOp = p.deployer;
        p.boostAdmin = p.deployer;
        p.reserve = p.deployer;
        p.lp = p.deployer;
        _push();
        DeployHelpers.Deployment memory d = _deployAndConfigure();
        handoffH.checkConfigured(d);
    }

    // ───────────────────────── D-24 / D-26: _loadEnv on mainnet ─────────────────────────

    /// @dev The ONLY test that touches process env (see Params).
    function test_D24_D26_loadEnv_mainnet_separation() public {
        vm.chainId(8453);
        uint256 key = 0xA11CE;
        address deployer_ = vm.addr(key);

        vm.setEnv("DEPLOYER_PRIVATE_KEY", vm.toString(bytes32(key)));
        vm.setEnv("DEV_WALLET", vm.toString(p.devWallet));
        vm.setEnv("TREASURY_RESERVE_ADDRESS", vm.toString(p.reserve));
        vm.setEnv("LP_RECIPIENT", vm.toString(p.lp));
        vm.setEnv("GOVERNANCE_SAFE", vm.toString(p.safe));
        vm.setEnv("ELIGIBILITY_OPERATOR", vm.toString(p.eligOp));
        vm.setEnv("MATCHMAKER_ADDRESS", vm.toString(p.matchmaker));
        vm.setEnv("RESOLVER_ADDRESS", vm.toString(p.resolver));
        vm.setEnv("VRF_OPERATOR_ADDRESS", vm.toString(p.vrfOp));
        vm.setEnv("BOOST_ADMIN_ADDRESS", vm.toString(p.boostAdmin));

        deployH.loadEnv(); // a fully separated configuration loads

        // D-26: the pairs the old checks skipped.
        _expectLoadEnvRevert(
            "BOOST_ADMIN_ADDRESS", p.resolver, p.boostAdmin, "RESOLVER_ADDRESS and BOOST_ADMIN_ADDRESS must be different addresses"
        );
        _expectLoadEnvRevert(
            "BOOST_ADMIN_ADDRESS", p.matchmaker, p.boostAdmin, "MATCHMAKER_ADDRESS and BOOST_ADMIN_ADDRESS must be different addresses"
        );
        _expectLoadEnvRevert(
            "ELIGIBILITY_OPERATOR", p.vrfOp, p.eligOp, "VRF_OPERATOR_ADDRESS and ELIGIBILITY_OPERATOR must be different addresses"
        );
        _expectLoadEnvRevert(
            "ELIGIBILITY_OPERATOR", deployer_, p.eligOp, "ELIGIBILITY_OPERATOR must differ from deployer on mainnet"
        );
        _expectLoadEnvRevert("GOVERNANCE_SAFE", p.resolver, p.safe, "GOVERNANCE_SAFE must not be the hot key RESOLVER_ADDRESS");
        _expectLoadEnvRevert(
            "TREASURY_RESERVE_ADDRESS", p.boostAdmin, p.reserve, "TREASURY_RESERVE_ADDRESS must not be the hot key BOOST_ADMIN_ADDRESS"
        );
        // The pair the old checks did cover still holds.
        _expectLoadEnvRevert(
            "RESOLVER_ADDRESS", p.matchmaker, p.resolver, "MATCHMAKER_ADDRESS and RESOLVER_ADDRESS must be different addresses"
        );

        // D-24: the LP allocation.
        _expectLoadEnvRevert("LP_RECIPIENT", deployer_, p.lp, "LP_RECIPIENT must differ from deployer on mainnet");
        _expectLoadEnvRevert("LP_RECIPIENT", p.matchmaker, p.lp, "LP_RECIPIENT must not be the hot key MATCHMAKER_ADDRESS");
        _expectLoadEnvRevert("LP_RECIPIENT", address(0), p.lp, "LP_RECIPIENT required for mainnet");

        deployH.loadEnv(); // and the good configuration still loads after all the restores
    }

    function _expectLoadEnvRevert(string memory name, address bad, address good, string memory err) internal {
        vm.setEnv(name, vm.toString(bad));
        vm.expectRevert(bytes(err));
        deployH.loadEnv();
        vm.setEnv(name, vm.toString(good));
    }
}

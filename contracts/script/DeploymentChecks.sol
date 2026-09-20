// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {DeployHelpers} from "./DeployHelpers.s.sol";
import {ClawToken} from "../ClawToken.sol";
import {LobsterNFT} from "../LobsterNFT.sol";
import {TeamManager} from "../TeamManager.sol";
import {MiningPool} from "../MiningPool.sol";
import {BattleArena} from "../BattleArena.sol";
import {BattleVRF} from "../BattleVRF.sol";
import {Faucet} from "../Faucet.sol";
import {Treasury} from "../Treasury.sol";

/// @dev The two reads Handoff needs from a Safe. Any Safe version answers both.
interface ISafeView {
    function getThreshold() external view returns (uint256);
    function getOwners() external view returns (address[] memory);
}

/// @title DeploymentChecks
/// @notice Read-only assertions about a Clawbada deployment, one per stage of the launch
///         sequence: configured -> handoff proposed -> handoff finalized.
/// @dev Audit 2026-09 findings D-11 / D-23 / D-24. The previous handoff asserted only that
///      the deployer had LOST three roles. It never asserted that a live, controlled
///      account had GAINED them, that Configure had finished (its last transaction is the
///      one that takes ClawToken MINTER_ROLE back off the deploy key), or that Treasury
///      ownership had actually moved. Every check here reverts with a message naming the
///      one thing that is wrong.
///
///      Shared by Handoff.s.sol (preconditions, before it broadcasts), VerifyDeployment.s.sol
///      (run with no --broadcast, so it reads the real chain rather than forge's local
///      simulation of a broadcast) and contracts/test/DeployScripts.t.sol.
library DeploymentChecks {
    bytes32 internal constant DEFAULT_ADMIN_ROLE = 0x00;

    /// @dev The addresses Deploy/Configure were told to use (env), to compare the chain against.
    struct HotKeys {
        address matchmaker;
        address resolver;
        address vrfOperator;
        address boostAdmin;
        address devWallet; // not a role: the 15% fee leg, checked against Treasury.devWallet()
    }

    // ───────────────────────── Stage 1: configured ─────────────────────────

    /// @notice Configure.s.sol ran to completion and left the deploy key holding no mint
    ///         power and no role it was not explicitly given.
    function requireConfigured(DeployHelpers.Deployment memory d, address deployer, HotKeys memory k) internal view {
        // ── ClawToken: the most dangerous temporary power the deployer ever holds ──
        ClawToken claw = ClawToken(d.clawToken);
        bytes32 clawMinter = claw.MINTER_ROLE();
        require(
            !claw.hasRole(clawMinter, deployer),
            "verify: deployer still holds ClawToken MINTER_ROLE (Configure's final revoke did not land)"
        );
        require(claw.hasRole(clawMinter, d.miningPool), "verify: MiningPool lacks ClawToken MINTER_ROLE");

        // ── Treasury wiring ──
        Treasury treasury = Treasury(d.treasury);
        require(address(treasury.clawToken()) == d.clawToken, "verify: Treasury.clawToken not set");
        require(treasury.devWallet() == k.devWallet, "verify: Treasury.devWallet is not DEV_WALLET");
        require(treasury.authorized(d.breedingLab), "verify: Treasury has not authorized BreedingLab");
        require(treasury.authorized(d.marketplace), "verify: Treasury has not authorized Marketplace");
        require(treasury.authorized(d.evolutionLab), "verify: Treasury has not authorized EvolutionLab");
        require(treasury.authorized(d.repairShop), "verify: Treasury has not authorized RepairShop");
        require(treasury.authorized(d.battleArena), "verify: Treasury has not authorized BattleArena");

        // ── LobsterNFT: contract-held roles, never the deployer ──
        LobsterNFT nft = LobsterNFT(d.lobsterNFT);
        _requireHeldNotBy(d.lobsterNFT, nft.MINTER_ROLE(), d.faucet, deployer, "LobsterNFT MINTER_ROLE (Faucet)");
        _requireHeldNotBy(d.lobsterNFT, nft.MINTER_ROLE(), d.breedingLab, deployer, "LobsterNFT MINTER_ROLE (BreedingLab)");
        _requireHeldNotBy(d.lobsterNFT, nft.LOCKER_ROLE(), d.teamManager, deployer, "LobsterNFT LOCKER_ROLE");
        _requireHeldNotBy(d.lobsterNFT, nft.EVOLVER_ROLE(), d.evolutionLab, deployer, "LobsterNFT EVOLVER_ROLE");
        _requireHeldNotBy(d.lobsterNFT, nft.DAMAGE_ROLE(), d.battleArena, deployer, "LobsterNFT DAMAGE_ROLE (BattleArena)");
        _requireHeldNotBy(d.lobsterNFT, nft.DAMAGE_ROLE(), d.repairShop, deployer, "LobsterNFT DAMAGE_ROLE (RepairShop)");
        _requireHeldNotBy(d.lobsterNFT, nft.BURNER_ROLE(), d.evolutionLab, deployer, "LobsterNFT BURNER_ROLE");
        _requireHeldNotBy(d.lobsterNFT, nft.BREED_ROLE(), d.breedingLab, deployer, "LobsterNFT BREED_ROLE");

        // ── TeamManager ──
        bytes32 activity = TeamManager(d.teamManager).ACTIVITY_ROLE();
        _requireHeldNotBy(d.teamManager, activity, d.miningPool, deployer, "TeamManager ACTIVITY_ROLE (MiningPool)");
        _requireHeldNotBy(d.teamManager, activity, d.battleArena, deployer, "TeamManager ACTIVITY_ROLE (BattleArena)");

        // ── Hot service roles: on the named address, and on the deployer only where the
        //    deployer IS the named address (the testnet/local fallback). ──
        _requireHeldNotBy(
            d.battleArena, BattleArena(d.battleArena).MATCHMAKER_ROLE(), k.matchmaker, deployer, "BattleArena MATCHMAKER_ROLE"
        );
        _requireHeldNotBy(
            d.battleArena, BattleArena(d.battleArena).RESOLVER_ROLE(), k.resolver, deployer, "BattleArena RESOLVER_ROLE"
        );
        _requireHeldNotBy(
            d.battleVRF, BattleVRF(d.battleVRF).OPERATOR_ROLE(), k.vrfOperator, deployer, "BattleVRF OPERATOR_ROLE"
        );
        _requireHeldNotBy(
            d.miningPool, MiningPool(d.miningPool).BOOST_ADMIN_ROLE(), k.boostAdmin, deployer, "MiningPool BOOST_ADMIN_ROLE"
        );

        // ── Season 1 started ──
        require(MiningPool(d.miningPool).currentSeason() >= 1, "verify: MiningPool season 1 not started");

        // ── Faucet pre-mint: while the window is open, what it holds plus what it has
        //    paid out covers the 70M allocation. (>=, not ==: anyone can send it tokens.
        //    After close the residual is burned, so the identity no longer applies.) ──
        Faucet faucet = Faucet(d.faucet);
        if (block.timestamp < faucet.closeTime()) {
            require(
                IERC20(d.clawToken).balanceOf(d.faucet) + faucet.totalClawClaimed() >= 70_000_000e18,
                "verify: Faucet does not hold its 70M pre-mint"
            );
        }
    }

    // ───────────────────────── Stage 2: handoff proposed ─────────────────────────

    /// @notice Phase 1 of the handoff landed: the Safe and the eligibility operator hold
    ///         their roles and the Treasury transfer is proposed (or already accepted).
    /// @dev The deployer still holds its governance roles here by design — see Handoff.s.sol.
    function requireProposed(
        DeployHelpers.Deployment memory d,
        address[] memory adminContracts,
        address deployer,
        address safe,
        address eligibilityOperator
    ) internal view {
        requireSafeHoldsGovernance(adminContracts, d.miningPool, safe);

        bytes32 eligibility = Faucet(d.faucet).ELIGIBILITY_ROLE();
        require(
            IAccessControl(d.faucet).hasRole(eligibility, eligibilityOperator),
            "verify: eligibility operator lacks Faucet ELIGIBILITY_ROLE"
        );
        if (eligibilityOperator != deployer) {
            require(
                !IAccessControl(d.faucet).hasRole(eligibility, deployer),
                "verify: deployer still holds Faucet ELIGIBILITY_ROLE"
            );
        }

        Ownable2Step treasury = Ownable2Step(d.treasury);
        require(
            treasury.owner() == safe || treasury.pendingOwner() == safe,
            "verify: Treasury ownership transfer not proposed to the safe"
        );
    }

    /// @notice The Safe holds DEFAULT_ADMIN on every AccessControl contract and SEASON_ADMIN.
    function requireSafeHoldsGovernance(address[] memory adminContracts, address miningPool, address safe)
        internal
        view
    {
        for (uint256 i = 0; i < adminContracts.length; i++) {
            require(
                IAccessControl(adminContracts[i]).hasRole(DEFAULT_ADMIN_ROLE, safe),
                "verify: safe lacks DEFAULT_ADMIN_ROLE on an AccessControl contract"
            );
        }
        require(
            IAccessControl(miningPool).hasRole(MiningPool(miningPool).SEASON_ADMIN_ROLE(), safe),
            "verify: safe lacks MiningPool SEASON_ADMIN_ROLE"
        );
    }

    /// @notice The on-chain proof that whoever controls `safe` can sign on THIS chain: the
    ///         Safe itself called Treasury.acceptOwnership(). Nothing but the Safe can do that.
    function requireSafeProvedControl(address treasury, address safe) internal view {
        require(
            Ownable2Step(treasury).owner() == safe,
            "handoff: the safe has not called Treasury.acceptOwnership() - no proof it can sign on this chain"
        );
    }

    // ───────────────────────── Stage 3: handoff finalized ─────────────────────────

    /// @notice The end state: the Safe governs everything, the deploy key governs nothing.
    function requireFinalized(
        DeployHelpers.Deployment memory d,
        address[] memory adminContracts,
        address deployer,
        address safe,
        address eligibilityOperator
    ) internal view {
        requireProposed(d, adminContracts, deployer, safe, eligibilityOperator);
        requireSafeProvedControl(d.treasury, safe);
        require(Ownable2Step(d.treasury).pendingOwner() == address(0), "verify: Treasury has a pending owner");
        require(
            deployerHoldsNoGovernance(adminContracts, d.miningPool, d.faucet, d.clawToken, deployer),
            "verify: deployer still holds a governance or mint role"
        );
    }

    /// @notice True iff `deployer` holds none of: DEFAULT_ADMIN on any AccessControl contract,
    ///         MiningPool SEASON_ADMIN, Faucet ELIGIBILITY, ClawToken MINTER.
    /// @dev Treasury is Ownable2Step, not AccessControl — requireFinalized checks its owner.
    function deployerHoldsNoGovernance(
        address[] memory adminContracts,
        address miningPool,
        address faucet,
        address clawToken,
        address deployer
    ) internal view returns (bool) {
        for (uint256 i = 0; i < adminContracts.length; i++) {
            if (IAccessControl(adminContracts[i]).hasRole(DEFAULT_ADMIN_ROLE, deployer)) return false;
        }
        if (IAccessControl(miningPool).hasRole(MiningPool(miningPool).SEASON_ADMIN_ROLE(), deployer)) return false;
        if (IAccessControl(faucet).hasRole(Faucet(faucet).ELIGIBILITY_ROLE(), deployer)) return false;
        if (IAccessControl(clawToken).hasRole(ClawToken(clawToken).MINTER_ROLE(), deployer)) return false;
        return true;
    }

    // ───────────────────────── The Safe itself ─────────────────────────

    /// @notice `safe` is a deployed Safe on this chain whose signer threshold meets policy.
    /// @dev Catches the Wintermute/Optimism class (a Safe address copied from another chain
    ///      has no code here), an EOA pasted from the wrong row, and a 1-of-n Safe. It does
    ///      NOT prove the right people control it — requireSafeProvedControl does that.
    function requireLiveSafe(address safe, uint256 minThreshold) internal view {
        require(safe.code.length > 0, "GOVERNANCE_SAFE has no code on this chain");

        (bool okT, bytes memory retT) = safe.staticcall(abi.encodeCall(ISafeView.getThreshold, ()));
        require(okT && retT.length == 32, "GOVERNANCE_SAFE is not a Safe (getThreshold failed)");
        uint256 threshold = abi.decode(retT, (uint256));

        (bool okO, bytes memory retO) = safe.staticcall(abi.encodeCall(ISafeView.getOwners, ()));
        require(okO && retO.length >= 64, "GOVERNANCE_SAFE is not a Safe (getOwners failed)");
        address[] memory owners = abi.decode(retO, (address[]));

        uint256 floor = minThreshold < 2 ? 2 : minThreshold;
        require(threshold >= floor, "GOVERNANCE_SAFE signer threshold is below policy (MIN_SAFE_THRESHOLD)");
        require(owners.length >= threshold, "GOVERNANCE_SAFE has fewer owners than its threshold");
    }

    // ───────────────────────── internal ─────────────────────────

    /// @dev `holder` has `role` on `target`; `deployer` does not, unless it IS the holder.
    function _requireHeldNotBy(address target, bytes32 role, address holder, address deployer, string memory what)
        private
        view
    {
        require(IAccessControl(target).hasRole(role, holder), string.concat("verify: expected holder lacks ", what));
        if (holder != deployer) {
            require(!IAccessControl(target).hasRole(role, deployer), string.concat("verify: deployer holds ", what));
        }
    }
}

/// @title CheckedDeployHelpers
/// @notice DeployHelpers plus the bridge from its env-loaded addresses to DeploymentChecks.
abstract contract CheckedDeployHelpers is DeployHelpers {
    function _hotKeys() internal view returns (DeploymentChecks.HotKeys memory) {
        return DeploymentChecks.HotKeys({
            matchmaker: matchmakerAddress,
            resolver: resolverAddress,
            vrfOperator: vrfOperatorAddress,
            boostAdmin: boostAdminAddress,
            devWallet: devWallet
        });
    }
}

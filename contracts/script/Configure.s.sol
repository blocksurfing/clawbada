// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console2} from "forge-std/Script.sol";
import {DeployHelpers, REFUND_RESERVE_TARGET} from "./DeployHelpers.s.sol";

import {Treasury} from "../Treasury.sol";
import {GoldToken} from "../GoldToken.sol";
import {LobsterNFT} from "../LobsterNFT.sol";
import {TeamManager} from "../TeamManager.sol";
import {MiningPool} from "../MiningPool.sol";
import {Faucet} from "../Faucet.sol";
import {BattleArena} from "../BattleArena.sol";
import {BattleVRF} from "../BattleVRF.sol";
import {PauseSwitch} from "../PauseSwitch.sol";

/// @title Configure
/// @notice Post-deployment configuration: role grants, Treasury setup, Season 1 init.
/// @dev Reads addresses from deployments/<network>.json written by Deploy.s.sol.
///      Usage: forge script contracts/script/Configure.s.sol --rpc-url base_sepolia --broadcast
contract Configure is DeployHelpers {
    function run() external {
        _loadEnv();

        string memory network = _networkName();
        console2.log("Configuring deployment on:", network);
        console2.log("");

        Deployment memory d = _readDeployment(network);

        vm.startBroadcast(deployerKey);
        _configureAll(d);
        vm.stopBroadcast();

        console2.log("=== Configuration sent ===");
        console2.log("Total: 6 Treasury authorizations, 17 role grants, 1 season start, 1 faucet pre-mint");
        if (block.chainid == 8453) {
            console2.log("Mainnet: the 2M GOLD refund reserve is funded by the Safe after the handoff;");
            console2.log("  confirm with VerifyDeployment --sig 'reserveFunded()' (docs/runbooks/admin-roles.md).");
        }
        // D-23: a forge broadcast is not atomic, and the LAST transaction of this script
        // is the one that takes GoldToken MINTER_ROLE back off the deploy key. Nothing
        // above proves it landed — only a read of the chain does.
        console2.log("NEXT: confirm it landed, against the chain (no --broadcast):");
        console2.log("  forge script contracts/script/VerifyDeployment.s.sol --rpc-url <net> --sig 'configured()'");
    }

    /// @dev Every configuration call, with no file or env access, so the deploy-script
    ///      test runs exactly what mainnet runs.
    function _configureAll(Deployment memory d) internal {
        _configureTreasury(d);
        _configureGoldToken(d);
        _configureLobsterNFT(d);
        _configureTeamManager(d);
        _configureMiningPool(d);
        _configureBattleArena(d);
        _configureBattleVRF(d);
        _configureFaucet(d);
        _configurePauseSwitch(d);
        _fundRefundReserveOffMainnet(d);
    }

    /// @dev PAUSE-I1: the guardian (the watchdog's hot key) may pause the inflows; only
    ///      DEFAULT_ADMIN — the Safe after the handoff — may unpause. Like GUARDIAN_ROLE, a
    ///      hot role Handoff.s.sol leaves in place.
    function _configurePauseSwitch(Deployment memory d) internal {
        console2.log("--- PauseSwitch Role ---");
        PauseSwitch ps = PauseSwitch(d.pauseSwitch);
        ps.grantRole(ps.PAUSER_ROLE(), guardianAddress);
        console2.log("  PAUSER_ROLE ->", guardianAddress);
        console2.log("");
    }

    function _configureTreasury(Deployment memory d) internal {
        console2.log("--- Treasury Setup ---");
        Treasury treasury = Treasury(d.treasury);

        treasury.setGoldToken(d.goldToken);
        console2.log("  setGoldToken");

        treasury.setAuthorized(d.breedingLab, true);
        console2.log("  authorized: BreedingLab");

        treasury.setAuthorized(d.marketplace, true);
        console2.log("  authorized: Marketplace");

        treasury.setAuthorized(d.evolutionLab, true);
        console2.log("  authorized: EvolutionLab");

        treasury.setAuthorized(d.repairShop, true);
        console2.log("  authorized: RepairShop");

        treasury.setAuthorized(d.battleArena, true);
        console2.log("  authorized: BattleArena");
        console2.log("");
    }

    function _configureGoldToken(Deployment memory d) internal {
        console2.log("--- GoldToken Roles ---");
        GoldToken goldToken = GoldToken(d.goldToken);
        bytes32 minter = goldToken.MINTER_ROLE();

        goldToken.grantRole(minter, d.miningPool);
        console2.log("  MINTER_ROLE -> MiningPool");
        console2.log("");
    }

    function _configureLobsterNFT(Deployment memory d) internal {
        console2.log("--- LobsterNFT Roles ---");
        LobsterNFT nft = LobsterNFT(d.lobsterNFT);

        nft.grantRole(nft.MINTER_ROLE(), d.faucet);
        console2.log("  MINTER_ROLE -> Faucet");

        nft.grantRole(nft.MINTER_ROLE(), d.breedingLab);
        console2.log("  MINTER_ROLE -> BreedingLab");

        nft.grantRole(nft.LOCKER_ROLE(), d.teamManager);
        console2.log("  LOCKER_ROLE -> TeamManager");

        nft.grantRole(nft.EVOLVER_ROLE(), d.evolutionLab);
        console2.log("  EVOLVER_ROLE -> EvolutionLab");

        nft.grantRole(nft.DAMAGE_ROLE(), d.battleArena);
        console2.log("  DAMAGE_ROLE -> BattleArena");

        nft.grantRole(nft.DAMAGE_ROLE(), d.repairShop);
        console2.log("  DAMAGE_ROLE -> RepairShop");

        nft.grantRole(nft.BURNER_ROLE(), d.evolutionLab);
        console2.log("  BURNER_ROLE -> EvolutionLab");

        nft.grantRole(nft.BREED_ROLE(), d.breedingLab);
        console2.log("  BREED_ROLE -> BreedingLab");
        console2.log("");
    }

    function _configureTeamManager(Deployment memory d) internal {
        console2.log("--- TeamManager Roles ---");
        TeamManager tm = TeamManager(d.teamManager);
        bytes32 activity = tm.ACTIVITY_ROLE();

        tm.grantRole(activity, d.miningPool);
        console2.log("  ACTIVITY_ROLE -> MiningPool");

        tm.grantRole(activity, d.battleArena);
        console2.log("  ACTIVITY_ROLE -> BattleArena");
        console2.log("");
    }

    function _configureMiningPool(Deployment memory d) internal {
        console2.log("--- MiningPool Season Init ---");
        MiningPool pool = MiningPool(d.miningPool);

        pool.grantRole(pool.SEASON_ADMIN_ROLE(), deployer);
        console2.log("  SEASON_ADMIN_ROLE -> deployer");
        // Battle-rank boost poster: a hot service wallet (like MATCHMAKER/RESOLVER), never a
        // governance role — Handoff.s.sol leaves it in place.
        pool.grantRole(pool.BOOST_ADMIN_ROLE(), boostAdminAddress);
        console2.log("  BOOST_ADMIN_ROLE -> boost admin", boostAdminAddress);

        pool.startSeason(S1_EMISSION, S1_BASE_REWARD);
        console2.log("  startSeason(352.5M, 1250)");
        console2.log("");
    }

    function _configureBattleArena(Deployment memory d) internal {
        console2.log("--- BattleArena Roles ---");
        BattleArena arena = BattleArena(d.battleArena);

        arena.grantRole(arena.MATCHMAKER_ROLE(), matchmakerAddress);
        console2.log("  MATCHMAKER_ROLE ->", matchmakerAddress);

        arena.grantRole(arena.RESOLVER_ROLE(), resolverAddress);
        console2.log("  RESOLVER_ROLE ->", resolverAddress);

        // The watchdog: may only freeze a settled result for review. A hot role like
        // MATCHMAKER/RESOLVER, never governance — Handoff.s.sol leaves it in place.
        arena.grantRole(arena.GUARDIAN_ROLE(), guardianAddress);
        console2.log("  GUARDIAN_ROLE ->", guardianAddress);
        console2.log("");
    }

    function _configureBattleVRF(Deployment memory d) internal {
        console2.log("--- BattleVRF Role ---");
        BattleVRF vrf = BattleVRF(d.battleVRF);

        vrf.grantRole(vrf.OPERATOR_ROLE(), vrfOperatorAddress);
        console2.log("  OPERATOR_ROLE ->", vrfOperatorAddress);
        console2.log("");
    }

    function _configureFaucet(Deployment memory d) internal {
        console2.log("--- Faucet Setup ---");
        Faucet faucet = Faucet(d.faucet);

        faucet.grantRole(faucet.ELIGIBILITY_ROLE(), deployer);
        console2.log("  ELIGIBILITY_ROLE -> deployer");

        // Pre-mint faucet $GOLD allocation (Faucet distributes via transfer, not mint)
        GoldToken goldToken = GoldToken(d.goldToken);
        bytes32 minter = goldToken.MINTER_ROLE();
        goldToken.grantRole(minter, deployer);
        goldToken.mint(d.faucet, FAUCET_GOLD_ALLOCATION);
        goldToken.revokeRole(minter, deployer);
        console2.log("  Pre-minted 70M $GOLD to Faucet");
        console2.log("");
    }

    /// @dev Testnet / local only: the deployer funds the BattleArena refund reserve so an
    ///      e2e run has the same reserve a mainnet launch will. Off mainnet the 100M genesis
    ///      reserve falls back to the deployer, so it can pay; when TREASURY_RESERVE_ADDRESS
    ///      names another account, that account has to fund it (as the Safe does on mainnet).
    ///      Mainnet never runs this: the deploy key holds no GOLD there, and the reserve comes
    ///      from the Safe right after the handoff (VerifyDeployment --sig "reserveFunded()").
    function _fundRefundReserveOffMainnet(Deployment memory d) internal {
        if (block.chainid == 8453) return;
        console2.log("--- BattleArena refund reserve (off mainnet) ---");
        BattleArena arena = BattleArena(d.battleArena);
        uint256 have = arena.refundReserve();
        if (have >= REFUND_RESERVE_TARGET) {
            console2.log("  already funded:", have);
            console2.log("");
            return;
        }
        if (treasuryReserveAddress != deployer) {
            console2.log("  SKIPPED: the treasury allocation is not on the deployer; fund it from", treasuryReserveAddress);
            console2.log("");
            return;
        }
        uint256 amount = REFUND_RESERVE_TARGET - have;
        GoldToken(d.goldToken).approve(d.battleArena, amount);
        arena.fundReserve(amount);
        console2.log("  fundReserve:", amount);
        console2.log("");
    }
}

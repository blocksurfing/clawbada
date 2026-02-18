// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console2} from "forge-std/Script.sol";
import {DeployHelpers} from "./DeployHelpers.s.sol";

import {Treasury} from "../Treasury.sol";
import {ClawToken} from "../ClawToken.sol";
import {LobsterNFT} from "../LobsterNFT.sol";
import {TeamManager} from "../TeamManager.sol";
import {MiningPool} from "../MiningPool.sol";
import {Faucet} from "../Faucet.sol";
import {BattleArena} from "../BattleArena.sol";
import {BattleVRF} from "../BattleVRF.sol";

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

        _configureTreasury(d);
        _configureClawToken(d);
        _configureLobsterNFT(d);
        _configureTeamManager(d);
        _configureMiningPool(d);
        _configureBattleArena(d);
        _configureBattleVRF(d);
        _configureFaucet(d);

        vm.stopBroadcast();

        console2.log("=== Configuration complete ===");
        console2.log("Total: 6 Treasury authorizations, 16 role grants, 1 season start");
    }

    function _configureTreasury(Deployment memory d) internal {
        console2.log("--- Treasury Setup ---");
        Treasury treasury = Treasury(d.treasury);

        treasury.setClawToken(d.clawToken);
        console2.log("  setClawToken");

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

    function _configureClawToken(Deployment memory d) internal {
        console2.log("--- ClawToken Roles ---");
        ClawToken clawToken = ClawToken(d.clawToken);
        bytes32 minter = clawToken.MINTER_ROLE();

        clawToken.grantRole(minter, d.miningPool);
        console2.log("  MINTER_ROLE -> MiningPool");

        clawToken.grantRole(minter, d.faucet);
        console2.log("  MINTER_ROLE -> Faucet");
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

        pool.startSeason(S1_EMISSION, S1_BASE_REWARD);
        console2.log("  startSeason(387.5M, 1250)");
        console2.log("");
    }

    function _configureBattleArena(Deployment memory d) internal {
        console2.log("--- BattleArena Roles ---");
        BattleArena arena = BattleArena(d.battleArena);

        arena.grantRole(arena.MATCHMAKER_ROLE(), deployer);
        console2.log("  MATCHMAKER_ROLE -> deployer");

        arena.grantRole(arena.RESOLVER_ROLE(), deployer);
        console2.log("  RESOLVER_ROLE -> deployer");
        console2.log("");
    }

    function _configureBattleVRF(Deployment memory d) internal {
        console2.log("--- BattleVRF Role ---");
        BattleVRF vrf = BattleVRF(d.battleVRF);

        vrf.grantRole(vrf.OPERATOR_ROLE(), deployer);
        console2.log("  OPERATOR_ROLE -> deployer");
        console2.log("");
    }

    function _configureFaucet(Deployment memory d) internal {
        console2.log("--- Faucet Role ---");
        Faucet faucet = Faucet(d.faucet);

        faucet.grantRole(faucet.ELIGIBILITY_ROLE(), deployer);
        console2.log("  ELIGIBILITY_ROLE -> deployer");
        console2.log("");
    }
}

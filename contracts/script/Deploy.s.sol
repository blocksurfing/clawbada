// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console2} from "forge-std/Script.sol";
import {DeployHelpers} from "./DeployHelpers.s.sol";

import {Treasury} from "../Treasury.sol";
import {LobsterNFT} from "../LobsterNFT.sol";
import {BattleVRF} from "../BattleVRF.sol";
import {ClawToken} from "../ClawToken.sol";
import {TeamManager} from "../TeamManager.sol";
import {Faucet} from "../Faucet.sol";
import {MiningPool} from "../MiningPool.sol";
import {BreedingLab} from "../BreedingLab.sol";
import {EvolutionLab} from "../EvolutionLab.sol";
import {RepairShop} from "../RepairShop.sol";
import {Marketplace} from "../Marketplace.sol";
import {BattleArena} from "../BattleArena.sol";

/// @title Deploy
/// @notice Deploys all 12 Clawbada contracts in dependency order to Base Sepolia.
/// @dev Usage: forge script contracts/script/Deploy.s.sol --rpc-url base_sepolia --broadcast --verify
contract Deploy is DeployHelpers {
    function run() external {
        _loadEnv();

        string memory network = _networkName();
        console2.log("Deploying to:", network);
        console2.log("");

        vm.startBroadcast(deployerKey);

        Deployment memory d;

        // ── Tier 0 — No dependencies ──

        d.treasury = address(new Treasury(deployer, devWallet));
        console2.log("Treasury:", d.treasury);

        d.lobsterNFT = address(new LobsterNFT(deployer, BASE_URI));
        console2.log("LobsterNFT:", d.lobsterNFT);

        d.battleVRF = address(new BattleVRF(deployer));
        console2.log("BattleVRF:", d.battleVRF);

        // TOK-H1: deployer receives the 125M LP allocation; the 100M reserve goes to
        // treasuryReserveAddress (a governance Safe on mainnet), NOT the Treasury
        // fee-splitter contract — which has no withdrawal path. The asserts below
        // permanently lock in that invariant: the splitter must hold zero reserve.
        require(treasuryReserveAddress != d.treasury, "TOK-H1: reserve recipient must not be the fee-splitter");
        d.clawToken = address(new ClawToken(deployer, deployer, treasuryReserveAddress));
        console2.log("ClawToken:", d.clawToken);
        require(
            ClawToken(d.clawToken).balanceOf(d.treasury) == 0,
            "TOK-H1: Treasury fee-splitter must hold no genesis reserve"
        );

        // ── Tier 1 — Depend on Tier 0 ──

        d.teamManager = address(new TeamManager(deployer, d.lobsterNFT));
        console2.log("TeamManager:", d.teamManager);

        uint256 closeTime = block.timestamp + FAUCET_DURATION;
        d.faucet = address(new Faucet(deployer, d.lobsterNFT, d.clawToken, closeTime));
        console2.log("Faucet:", d.faucet);
        console2.log("  closeTime:", closeTime);

        d.miningPool = address(new MiningPool(deployer, d.clawToken, d.lobsterNFT, d.teamManager));
        console2.log("MiningPool:", d.miningPool);

        d.breedingLab = address(new BreedingLab(d.clawToken, d.lobsterNFT, d.treasury));
        console2.log("BreedingLab:", d.breedingLab);

        d.evolutionLab = address(new EvolutionLab(d.clawToken, d.lobsterNFT, d.treasury));
        console2.log("EvolutionLab:", d.evolutionLab);

        d.repairShop = address(new RepairShop(d.clawToken, d.lobsterNFT, d.treasury));
        console2.log("RepairShop:", d.repairShop);

        d.marketplace = address(new Marketplace(d.clawToken, d.lobsterNFT, d.treasury));
        console2.log("Marketplace:", d.marketplace);

        // ── Tier 2 — Depends on Tiers 0 + 1 ──

        d.battleArena = address(
            new BattleArena(deployer, d.clawToken, d.lobsterNFT, d.teamManager, d.treasury, d.battleVRF)
        );
        console2.log("BattleArena:", d.battleArena);

        vm.stopBroadcast();

        console2.log("");
        console2.log("=== All 12 contracts deployed ===");

        _writeDeployment(network, d);
    }
}

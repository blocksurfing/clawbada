// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console2} from "forge-std/Script.sol";
import {DeployHelpers} from "./DeployHelpers.s.sol";

import {Treasury} from "../Treasury.sol";
import {LobsterNFT} from "../LobsterNFT.sol";
import {BattleVRF} from "../BattleVRF.sol";
import {GoldToken} from "../GoldToken.sol";
import {TeamManager} from "../TeamManager.sol";
import {Faucet} from "../Faucet.sol";
import {MiningPool} from "../MiningPool.sol";
import {BreedingLab} from "../BreedingLab.sol";
import {EvolutionLab} from "../EvolutionLab.sol";
import {RepairShop} from "../RepairShop.sol";
import {Marketplace} from "../Marketplace.sol";
import {BattleArena} from "../BattleArena.sol";
import {PauseSwitch} from "../PauseSwitch.sol";

/// @title Deploy
/// @notice Deploys all 13 Clawbada contracts in dependency order to Base Sepolia.
/// @dev Usage: forge script contracts/script/Deploy.s.sol --rpc-url base_sepolia --broadcast --verify
contract Deploy is DeployHelpers {
    function run() external {
        _loadEnv();

        string memory network = _networkName();
        console2.log("Deploying to:", network);
        console2.log("");

        vm.startBroadcast(deployerKey);
        Deployment memory d = _deployAll();
        vm.stopBroadcast();

        console2.log("");
        console2.log("=== All 13 contracts deployed ===");

        _writeDeployment(network, d);
    }

    /// @dev The whole deployment, with no file or env access, so the deploy-script test
    ///      (contracts/test/DeployScripts.t.sol) runs exactly what mainnet runs.
    function _deployAll() internal returns (Deployment memory d) {
        // ── Tier 0 — No dependencies ──

        // PAUSE-I1: one emergency stop for every money-in entry point. PAUSER_ROLE goes to the
        // guardian in Configure; DEFAULT_ADMIN (the only unpauser) to the Safe in Handoff.
        d.pauseSwitch = address(new PauseSwitch(deployer));
        console2.log("PauseSwitch:", d.pauseSwitch);

        d.treasury = address(new Treasury(deployer, devWallet));
        console2.log("Treasury:", d.treasury);

        d.lobsterNFT = address(new LobsterNFT(deployer, BASE_URI));
        console2.log("LobsterNFT:", d.lobsterNFT);

        d.battleVRF = address(new BattleVRF(deployer));
        console2.log("BattleVRF:", d.battleVRF);

        // TOK-H1: the 100M reserve goes to treasuryReserveAddress (a governance Safe on
        // mainnet), NOT the Treasury fee-splitter contract — which has no withdrawal
        // path. The asserts below permanently lock in that invariant: the splitter must
        // hold zero reserve.
        // D-24: the 125M LP allocation goes to lpRecipient. On mainnet _loadEnv requires
        // it to be set and to differ from the deployer, so the deploy key (a raw key in an
        // env var) never holds 12.5% of supply at rest; elsewhere it falls back to the
        // deployer. Like the reserve, it must not be the fee-splitter.
        require(treasuryReserveAddress != d.treasury, "TOK-H1: reserve recipient must not be the fee-splitter");
        require(lpRecipient != d.treasury, "D-24: LP recipient must not be the fee-splitter");
        d.goldToken = address(new GoldToken(deployer, lpRecipient, treasuryReserveAddress));
        console2.log("GoldToken:", d.goldToken);
        require(
            GoldToken(d.goldToken).balanceOf(d.treasury) == 0,
            "TOK-H1: Treasury fee-splitter must hold no genesis reserve"
        );

        // ── Tier 1 — Depend on Tier 0 ──

        d.teamManager = address(new TeamManager(deployer, d.lobsterNFT));
        console2.log("TeamManager:", d.teamManager);

        // D-G: deployed CLOSED (closeTime 0). The Open step sets closeTime = now + 7 days when the
        // game goes live, so the deploy date never constrains the launch date.
        d.faucet = address(new Faucet(deployer, d.lobsterNFT, d.goldToken, 0, d.pauseSwitch));
        console2.log("Faucet:", d.faucet, "(closed until Open.s.sol)");

        d.miningPool = address(new MiningPool(deployer, d.goldToken, d.lobsterNFT, d.teamManager, d.pauseSwitch));
        console2.log("MiningPool:", d.miningPool);

        d.breedingLab = address(new BreedingLab(d.goldToken, d.lobsterNFT, d.treasury, d.pauseSwitch));
        console2.log("BreedingLab:", d.breedingLab);

        d.evolutionLab = address(new EvolutionLab(d.goldToken, d.lobsterNFT, d.treasury, d.pauseSwitch));
        console2.log("EvolutionLab:", d.evolutionLab);

        d.repairShop = address(new RepairShop(d.goldToken, d.lobsterNFT, d.treasury, d.miningPool, d.pauseSwitch));
        console2.log("RepairShop:", d.repairShop);

        d.marketplace = address(new Marketplace(d.goldToken, d.lobsterNFT, d.treasury, d.pauseSwitch));
        console2.log("Marketplace:", d.marketplace);

        // ── Tier 2 — Depends on Tiers 0 + 1 ──

        d.battleArena = address(
            new BattleArena(
                deployer, d.goldToken, d.lobsterNFT, d.teamManager, d.treasury, d.battleVRF, d.miningPool, d.pauseSwitch
            )
        );
        console2.log("BattleArena:", d.battleArena);
    }
}

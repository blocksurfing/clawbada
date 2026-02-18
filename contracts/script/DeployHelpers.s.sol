// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

/// @title DeployHelpers
/// @notice Shared base for Clawbada deployment scripts — env loading, address serialization, constants.
abstract contract DeployHelpers is Script {
    // ── Deployed address bundle ──
    struct Deployment {
        address clawToken;
        address lobsterNFT;
        address treasury;
        address battleVRF;
        address teamManager;
        address faucet;
        address miningPool;
        address breedingLab;
        address evolutionLab;
        address repairShop;
        address marketplace;
        address battleArena;
    }

    // ── Deployment parameters ──
    address internal deployer;
    address internal devWallet;
    uint256 internal deployerKey;

    // ── Constants ──
    string internal constant BASE_URI = "https://api.clawbada.com/metadata/lobster/";
    uint256 internal constant FAUCET_DURATION = 7 days;

    // Season 1 parameters
    uint256 internal constant S1_EMISSION = 387_500_000e18;
    uint256 internal constant S1_BASE_REWARD = 1_250e18;

    // ── JSON serialization key ──
    string internal constant JSON_KEY = "deployment";

    /// @notice Load environment variables and set deployer/devWallet.
    function _loadEnv() internal {
        deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        deployer = vm.addr(deployerKey);
        devWallet = vm.envAddress("DEV_WALLET");

        console2.log("=== Clawbada Deployment ===");
        console2.log("Deployer:", deployer);
        console2.log("Dev Wallet:", devWallet);
        console2.log("Chain ID:", block.chainid);
        console2.log("");
    }

    /// @notice Write deployed addresses to `deployments/<network>.json`.
    function _writeDeployment(string memory network, Deployment memory d) internal {
        string memory json = JSON_KEY;

        vm.serializeString(json, "network", network);
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeAddress(json, "deployer", deployer);
        vm.serializeUint(json, "timestamp", block.timestamp);

        // Serialize contract addresses
        string memory contracts = "contracts";
        vm.serializeAddress(contracts, "ClawToken", d.clawToken);
        vm.serializeAddress(contracts, "LobsterNFT", d.lobsterNFT);
        vm.serializeAddress(contracts, "Treasury", d.treasury);
        vm.serializeAddress(contracts, "BattleVRF", d.battleVRF);
        vm.serializeAddress(contracts, "TeamManager", d.teamManager);
        vm.serializeAddress(contracts, "Faucet", d.faucet);
        vm.serializeAddress(contracts, "MiningPool", d.miningPool);
        vm.serializeAddress(contracts, "BreedingLab", d.breedingLab);
        vm.serializeAddress(contracts, "EvolutionLab", d.evolutionLab);
        vm.serializeAddress(contracts, "RepairShop", d.repairShop);
        vm.serializeAddress(contracts, "Marketplace", d.marketplace);
        string memory contractsJson = vm.serializeAddress(contracts, "BattleArena", d.battleArena);

        string memory finalJson = vm.serializeString(json, "contracts", contractsJson);

        string memory path = string.concat("deployments/", network, ".json");
        vm.writeJson(finalJson, path);
        console2.log("Deployment written to:", path);
    }

    /// @notice Read deployed addresses from `deployments/<network>.json`.
    function _readDeployment(string memory network) internal view returns (Deployment memory d) {
        string memory path = string.concat("deployments/", network, ".json");
        string memory json = vm.readFile(path);

        d.clawToken = vm.parseJsonAddress(json, ".contracts.ClawToken");
        d.lobsterNFT = vm.parseJsonAddress(json, ".contracts.LobsterNFT");
        d.treasury = vm.parseJsonAddress(json, ".contracts.Treasury");
        d.battleVRF = vm.parseJsonAddress(json, ".contracts.BattleVRF");
        d.teamManager = vm.parseJsonAddress(json, ".contracts.TeamManager");
        d.faucet = vm.parseJsonAddress(json, ".contracts.Faucet");
        d.miningPool = vm.parseJsonAddress(json, ".contracts.MiningPool");
        d.breedingLab = vm.parseJsonAddress(json, ".contracts.BreedingLab");
        d.evolutionLab = vm.parseJsonAddress(json, ".contracts.EvolutionLab");
        d.repairShop = vm.parseJsonAddress(json, ".contracts.RepairShop");
        d.marketplace = vm.parseJsonAddress(json, ".contracts.Marketplace");
        d.battleArena = vm.parseJsonAddress(json, ".contracts.BattleArena");
    }

    /// @notice Determine network name from chain ID.
    function _networkName() internal view returns (string memory) {
        if (block.chainid == 84532) return "base-sepolia";
        if (block.chainid == 8453) return "base";
        if (block.chainid == 31337) return "localhost";
        revert("Unsupported chain ID");
    }
}

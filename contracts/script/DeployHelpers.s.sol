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
    address internal treasuryReserveAddress; // TOK-H1: holds the 100M genesis reserve (a Safe on mainnet), NOT the fee-splitter
    address internal matchmakerAddress;
    address internal resolverAddress;
    address internal vrfOperatorAddress;
    uint256 internal deployerKey;

    // ── Constants ──
    string internal constant BASE_URI = "https://api.clawbada.com/metadata/lobster/";
    uint256 internal constant FAUCET_DURATION = 7 days;

    // Season 1 parameters
    uint256 internal constant S1_EMISSION = 352_500_000e18;
    uint256 internal constant S1_BASE_REWARD = 1_250e18;

    // Faucet: pre-minted allocation (covers ~10K wallets × 7,000 $CLAW)
    uint256 internal constant FAUCET_CLAW_ALLOCATION = 70_000_000e18;

    // ── JSON serialization key ──
    string internal constant JSON_KEY = "deployment";

    /// @notice Load environment variables and set deployer/devWallet/role addresses.
    /// @dev On mainnet (chain ID 8453), MATCHMAKER_ADDRESS, RESOLVER_ADDRESS, and VRF_OPERATOR_ADDRESS
    ///      are required — deployer must not hold operational roles. On testnet/local they fall back to deployer.
    function _loadEnv() internal {
        deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        deployer = vm.addr(deployerKey);
        devWallet = vm.envAddress("DEV_WALLET");

        // TOK-H1: recipient of the 100M genesis Treasury reserve. Must be a holding
        // account (governance Safe on mainnet), NOT the Treasury fee-splitter contract
        // — which has no withdrawal path and would lock the reserve permanently.
        treasuryReserveAddress = vm.envOr("TREASURY_RESERVE_ADDRESS", address(0));

        // Role addresses: required on mainnet, optional (fallback to deployer) on testnet/local
        bool isMainnet = block.chainid == 8453;

        matchmakerAddress = vm.envOr("MATCHMAKER_ADDRESS", address(0));
        resolverAddress = vm.envOr("RESOLVER_ADDRESS", address(0));
        vrfOperatorAddress = vm.envOr("VRF_OPERATOR_ADDRESS", address(0));

        if (isMainnet) {
            require(matchmakerAddress != address(0), "MATCHMAKER_ADDRESS required for mainnet");
            require(resolverAddress != address(0), "RESOLVER_ADDRESS required for mainnet");
            require(vrfOperatorAddress != address(0), "VRF_OPERATOR_ADDRESS required for mainnet");
            // TOK-H1: reserve must be an explicit holding account, never the deploy hot key.
            require(treasuryReserveAddress != address(0), "TREASURY_RESERVE_ADDRESS required for mainnet");
            require(treasuryReserveAddress != deployer, "TREASURY_RESERVE_ADDRESS must differ from deployer on mainnet");

            // Enforce separation of duties: no operational role may equal deployer or each other
            require(matchmakerAddress != deployer, "MATCHMAKER_ADDRESS must differ from deployer on mainnet");
            require(resolverAddress != deployer, "RESOLVER_ADDRESS must differ from deployer on mainnet");
            require(vrfOperatorAddress != deployer, "VRF_OPERATOR_ADDRESS must differ from deployer on mainnet");
            require(matchmakerAddress != resolverAddress, "MATCHMAKER and RESOLVER must be different addresses");
            require(matchmakerAddress != vrfOperatorAddress, "MATCHMAKER and VRF_OPERATOR must be different addresses");
            require(resolverAddress != vrfOperatorAddress, "RESOLVER and VRF_OPERATOR must be different addresses");
        } else {
            if (matchmakerAddress == address(0)) matchmakerAddress = deployer;
            if (resolverAddress == address(0)) resolverAddress = deployer;
            if (vrfOperatorAddress == address(0)) vrfOperatorAddress = deployer;
            if (treasuryReserveAddress == address(0)) treasuryReserveAddress = deployer;
        }

        console2.log("=== Clawbada Deployment ===");
        console2.log("Deployer:", deployer);
        console2.log("Dev Wallet:", devWallet);
        console2.log("Treasury Reserve:", treasuryReserveAddress);
        console2.log("Matchmaker:", matchmakerAddress);
        console2.log("Resolver:", resolverAddress);
        console2.log("VRF Operator:", vrfOperatorAddress);
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

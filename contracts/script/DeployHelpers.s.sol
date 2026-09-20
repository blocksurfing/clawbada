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
    address internal lpRecipient;            // D-24: receives the 125M LP allocation at genesis (never the deploy key on mainnet)
    address internal governanceSafe;         // role-handoff: receives DEFAULT_ADMIN on all contracts, MiningPool SEASON_ADMIN, and Treasury ownership
    address internal eligibilityOperator;    // role-handoff: receives Faucet ELIGIBILITY_ROLE (operational service wallet)
    address internal matchmakerAddress;
    address internal resolverAddress;
    address internal boostAdminAddress;      // hot service wallet that posts the weekly battle-rank boost table (MiningPool BOOST_ADMIN_ROLE)
    address internal vrfOperatorAddress;
    uint256 internal deployerKey;
    uint256 internal minSafeThreshold;       // D-11: lowest signer threshold Handoff accepts on the governance Safe (mainnet)

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
    /// @dev On mainnet (chain ID 8453), MATCHMAKER_ADDRESS, RESOLVER_ADDRESS, VRF_OPERATOR_ADDRESS,
    ///      BOOST_ADMIN_ADDRESS, TREASURY_RESERVE_ADDRESS and LP_RECIPIENT are required — the deployer
    ///      must hold neither operational roles nor genesis allocations. On testnet/local they fall
    ///      back to the deployer.
    function _loadEnv() internal {
        deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        deployer = vm.addr(deployerKey);
        _loadAddresses();
    }

    /// @notice Read-only variant for VerifyDeployment.s.sol: no private key is needed (or
    ///         wanted) to check a deployment. The deployer address comes from
    ///         DEPLOYER_ADDRESS, else from the `deployer` field Deploy wrote to
    ///         deployments/<network>.json.
    function _loadEnvReadOnly(string memory network) internal {
        deployer = vm.envOr("DEPLOYER_ADDRESS", address(0));
        if (deployer == address(0)) {
            string memory json = vm.readFile(string.concat("deployments/", network, ".json"));
            deployer = vm.parseJsonAddress(json, ".deployer");
        }
        require(deployer != address(0), "deployer address unknown: set DEPLOYER_ADDRESS");
        _loadAddresses();
    }

    /// @dev Everything except the deployer itself. `deployer` must be set before this runs.
    function _loadAddresses() internal {
        devWallet = vm.envAddress("DEV_WALLET");

        // TOK-H1: recipient of the 100M genesis Treasury reserve. Must be a holding
        // account (governance Safe on mainnet), NOT the Treasury fee-splitter contract
        // — which has no withdrawal path and would lock the reserve permanently.
        treasuryReserveAddress = vm.envOr("TREASURY_RESERVE_ADDRESS", address(0));

        // D-24: recipient of the 125M LP allocation. The deploy key is a raw key in an
        // env var; it must never hold 12.5% of supply at rest on mainnet.
        lpRecipient = vm.envOr("LP_RECIPIENT", address(0));

        // D-11: signer threshold the governance Safe must meet on mainnet. The role policy
        // (docs/runbooks/admin-roles.md) says 3-of-5 minimum; lowering it is an explicit,
        // visible choice, and 1 is never accepted (a 1-of-n Safe is a hot key in disguise).
        minSafeThreshold = vm.envOr("MIN_SAFE_THRESHOLD", uint256(3));

        // Role-handoff targets (consumed by Handoff.s.sol, not Deploy/Configure). Loaded
        // here so all scripts share env parsing; Handoff.run() validates they are set.
        governanceSafe = vm.envOr("GOVERNANCE_SAFE", address(0));
        eligibilityOperator = vm.envOr("ELIGIBILITY_OPERATOR", address(0));

        // Role addresses: required on mainnet, optional (fallback to deployer) on testnet/local
        bool isMainnet = block.chainid == 8453;

        matchmakerAddress = vm.envOr("MATCHMAKER_ADDRESS", address(0));
        resolverAddress = vm.envOr("RESOLVER_ADDRESS", address(0));
        vrfOperatorAddress = vm.envOr("VRF_OPERATOR_ADDRESS", address(0));
        boostAdminAddress = vm.envOr("BOOST_ADMIN_ADDRESS", address(0));

        if (isMainnet) {
            require(matchmakerAddress != address(0), "MATCHMAKER_ADDRESS required for mainnet");
            require(resolverAddress != address(0), "RESOLVER_ADDRESS required for mainnet");
            require(vrfOperatorAddress != address(0), "VRF_OPERATOR_ADDRESS required for mainnet");
            require(boostAdminAddress != address(0), "BOOST_ADMIN_ADDRESS required for mainnet");
            // TOK-H1: reserve must be an explicit holding account, never the deploy hot key.
            require(treasuryReserveAddress != address(0), "TREASURY_RESERVE_ADDRESS required for mainnet");
            require(treasuryReserveAddress != deployer, "TREASURY_RESERVE_ADDRESS must differ from deployer on mainnet");
            // DEPLOY-L1: the 15% dev-fee leg must not silently route to the deploy hot key.
            require(devWallet != deployer, "DEV_WALLET must differ from deployer on mainnet");
            // D-24: the LP allocation must not sit on the deploy hot key.
            require(lpRecipient != address(0), "LP_RECIPIENT required for mainnet");
            require(lpRecipient != deployer, "LP_RECIPIENT must differ from deployer on mainnet");

            _requireKeySeparation();
        } else {
            if (matchmakerAddress == address(0)) matchmakerAddress = deployer;
            if (resolverAddress == address(0)) resolverAddress = deployer;
            if (vrfOperatorAddress == address(0)) vrfOperatorAddress = deployer;
            if (boostAdminAddress == address(0)) boostAdminAddress = deployer;
            if (treasuryReserveAddress == address(0)) treasuryReserveAddress = deployer;
            if (lpRecipient == address(0)) lpRecipient = deployer;
        }

        console2.log("=== Clawbada Deployment ===");
        console2.log("Deployer:", deployer);
        console2.log("Dev Wallet:", devWallet);
        console2.log("Treasury Reserve:", treasuryReserveAddress);
        console2.log("LP Recipient:", lpRecipient);
        console2.log("Matchmaker:", matchmakerAddress);
        console2.log("Resolver:", resolverAddress);
        console2.log("VRF Operator:", vrfOperatorAddress);
        console2.log("Boost Admin:", boostAdminAddress);
        console2.log("Chain ID:", block.chainid);
        console2.log("");
    }

    /// @notice D-26 — separation of duties, enforced on mainnet.
    /// @dev Every hot service key (matchmaker, resolver, VRF operator, boost admin, and the
    ///      eligibility operator once it is named) must be a different address from the
    ///      deployer and from every other hot key: the role policy analyses each key's blast
    ///      radius on its own, which only holds while one compromise yields one role. The
    ///      cold accounts (governance Safe, reserve holder, LP recipient) must not be any hot
    ///      key either. GOVERNANCE_SAFE and ELIGIBILITY_OPERATOR are optional until Handoff,
    ///      so they are checked whenever they are set.
    function _requireKeySeparation() internal view {
        string[5] memory names =
            ["MATCHMAKER_ADDRESS", "RESOLVER_ADDRESS", "VRF_OPERATOR_ADDRESS", "BOOST_ADMIN_ADDRESS", "ELIGIBILITY_OPERATOR"];
        address[5] memory hot =
            [matchmakerAddress, resolverAddress, vrfOperatorAddress, boostAdminAddress, eligibilityOperator];

        for (uint256 i = 0; i < hot.length; i++) {
            if (hot[i] == address(0)) continue; // only ELIGIBILITY_OPERATOR may be unset here
            require(hot[i] != deployer, string.concat(names[i], " must differ from deployer on mainnet"));
            for (uint256 j = i + 1; j < hot.length; j++) {
                require(hot[i] != hot[j], string.concat(names[i], " and ", names[j], " must be different addresses"));
            }
            require(hot[i] != governanceSafe, string.concat("GOVERNANCE_SAFE must not be the hot key ", names[i]));
            require(
                hot[i] != treasuryReserveAddress,
                string.concat("TREASURY_RESERVE_ADDRESS must not be the hot key ", names[i])
            );
            require(hot[i] != lpRecipient, string.concat("LP_RECIPIENT must not be the hot key ", names[i]));
        }
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

    /// @dev The 7 AccessControl contracts where the deployer holds DEFAULT_ADMIN_ROLE.
    ///      (BreedingLab/EvolutionLab/RepairShop/Marketplace have no admin; Treasury is
    ///      Ownable2Step, handled separately.)
    function _adminContracts(Deployment memory d) internal pure returns (address[] memory a) {
        a = new address[](7);
        a[0] = d.clawToken;
        a[1] = d.lobsterNFT;
        a[2] = d.teamManager;
        a[3] = d.miningPool;
        a[4] = d.battleArena;
        a[5] = d.battleVRF;
        a[6] = d.faucet;
    }

    /// @notice Determine network name from chain ID.
    function _networkName() internal view returns (string memory) {
        if (block.chainid == 84532) return "base-sepolia";
        if (block.chainid == 8453) return "base";
        if (block.chainid == 31337) return "localhost";
        revert("Unsupported chain ID");
    }
}

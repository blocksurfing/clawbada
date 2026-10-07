// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console2} from "forge-std/Script.sol";
import {DeployHelpers} from "./DeployHelpers.s.sol";
import {MiningPool} from "../MiningPool.sol";
import {Faucet} from "../Faucet.sol";

/// @title Open
/// @notice The step that makes the game LIVE (D-G, owner decision 2026-10-06): set the faucet's
///         close time (now + 7 days) and start Season 1. Deploy and Configure no longer touch
///         either clock — Deploy leaves the faucet closed (`closeTime = 0`) and Configure starts
///         no season — so a configured deployment can sit verified, handed off and reserve-funded
///         for as long as it takes, and both clocks start the moment the operator says so.
/// @dev Two entry points:
///
///        run()        broadcasts both calls as the deployer. Only BEFORE the handoff, while the
///                     deployer still holds MiningPool SEASON_ADMIN + Faucet DEFAULT_ADMIN —
///                     testnet and local chains. Then: VerifyDeployment --sig "opened()".
///
///        safeCalls()  prints the two transactions for the Safe UI (mainnet: after the handoff
///                     the Safe holds both roles). Read-only — no --broadcast, no key. Re-run it
///                     right before signing so the 7-day window counts from execution.
///
///      Why two calls and not one contract function: the clocks live on two contracts whose only
///      admin is the Safe; a helper contract would need to be a third admin. Two Safe
///      transactions in one batch is the standard Safe UI flow.
contract Open is DeployHelpers {
    function run() external {
        _loadEnv();
        string memory network = _networkName();
        Deployment memory d = _readDeployment(network);
        console2.log("Opening the game on:", network);
        console2.log("");

        vm.startBroadcast(deployerKey);
        _openAll(d);
        vm.stopBroadcast();

        console2.log("=== Open sent: faucet close time set, season 1 started ===");
        console2.log("NEXT: confirm it landed, against the chain (no --broadcast):");
        console2.log("  forge script contracts/script/VerifyDeployment.s.sol --rpc-url <net> --sig 'opened()'");
    }

    /// @notice The Safe's two transactions (mainnet, after the handoff).
    function safeCalls() external view {
        string memory network = _networkName();
        Deployment memory d = _readDeployment(network);
        uint256 closeTime = block.timestamp + FAUCET_DURATION;
        console2.log("Open the game on", network, "- two Safe transactions, in this order:");
        console2.log("");
        console2.log("1. Faucet.setCloseTime(closeTime)   to:", d.faucet);
        console2.log("   closeTime =", closeTime, "(this block + 7 days; re-run right before signing)");
        console2.logBytes(abi.encodeCall(Faucet.setCloseTime, (closeTime)));
        console2.log("");
        console2.log("2. MiningPool.startSeason(352.5M, 1250)   to:", d.miningPool);
        console2.logBytes(abi.encodeCall(MiningPool.startSeason, (S1_EMISSION, S1_BASE_REWARD)));
        console2.log("");
        console2.log("Then: VerifyDeployment --sig 'opened()'. Set BOOST_EPOCH_ANCHOR_TS to SeasonStarted.startTime.");
    }

    /// @dev Both calls, with no file or env access, so the deploy-script test runs exactly what
    ///      the chain runs.
    function _openAll(Deployment memory d) internal {
        uint256 closeTime = block.timestamp + FAUCET_DURATION;
        Faucet(d.faucet).setCloseTime(closeTime);
        console2.log("  Faucet.setCloseTime:", closeTime);
        MiningPool(d.miningPool).startSeason(S1_EMISSION, S1_BASE_REWARD);
        console2.log("  MiningPool.startSeason(352.5M, 1250)");
    }
}

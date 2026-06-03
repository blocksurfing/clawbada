// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ClawToken} from "../../ClawToken.sol";
import {Treasury} from "../../Treasury.sol";
import {LobsterNFT} from "../../LobsterNFT.sol";
import {TeamManager} from "../../TeamManager.sol";
import {MiningPool} from "../../MiningPool.sol";
import {Marketplace} from "../../Marketplace.sol";
import {BreedingLab} from "../../BreedingLab.sol";
import {EvolutionLab} from "../../EvolutionLab.sol";
import {RepairShop} from "../../RepairShop.sol";
import {BattleVRF} from "../../BattleVRF.sol";
import {BattleArena} from "../../BattleArena.sol";
import {Faucet} from "../../Faucet.sol";
import {DNALib} from "../../libraries/DNALib.sol";

/// @dev Shared deployment + role-wiring base for all Clawbada tests.
///      Inheriting contract becomes the admin/operator for every role.
abstract contract BaseSetup is Test {
    // ── Addresses ──────────────────────────────────────────────────
    address internal admin;
    address internal devWallet;
    address internal lpWallet;
    address internal reserveWallet; // TOK-H1: holds the 100M genesis reserve (mirrors production: NOT the splitter)

    // ── Contracts ──────────────────────────────────────────────────
    ClawToken      internal claw;
    Treasury       internal treasury;
    LobsterNFT     internal nft;
    TeamManager    internal teamMgr;
    MiningPool     internal miningPool;
    Marketplace    internal marketplace;
    BreedingLab    internal breedingLab;
    EvolutionLab   internal evolutionLab;
    RepairShop     internal repairShop;
    BattleVRF      internal battleVRF;
    BattleArena    internal battleArena;
    Faucet         internal faucet;

    // ── DNA helpers ────────────────────────────────────────────────

    /// @dev Build a minimal valid DNA with all alleles having `affinity` class and variant 0.
    function _dna(uint8 class_, uint8 affinity) internal pure returns (uint256) {
        uint8[18] memory alleles;
        for (uint256 i = 0; i < 18; i++) {
            alleles[i] = (affinity << 4) | 0; // variant=0
        }
        return DNALib.encode(class_, 0, 0, alleles);
    }

    /// @dev DNA where all dominant alleles match the lobster class (purity=6).
    function _pureDNA(uint8 class_) internal pure returns (uint256) {
        return _dna(class_, class_);
    }

    /// @dev DNA with a fixed class, random-ish alleles seeded by `seed`.
    function _seededDNA(uint8 class_, uint256 seed) internal pure returns (uint256) {
        class_ = uint8(class_ % 10);
        uint8[18] memory alleles;
        for (uint256 i = 0; i < 18; i++) {
            uint8 affinity = uint8((seed >> (i * 4)) % 10);
            uint8 variant  = uint8((seed >> (i * 4 + 4)) % 16);
            alleles[i] = (affinity << 4) | variant;
        }
        return DNALib.encode(class_, 0, uint8(seed % 64), alleles);
    }

    // ── Mint helpers ───────────────────────────────────────────────

    /// @dev Mint a lobster to `to` with given class. Returns tokenId.
    function _mintLobster(address to, uint8 class_) internal returns (uint256 tokenId) {
        vm.prank(admin);
        tokenId = nft.mint(to, _pureDNA(class_), false);
    }

    /// @dev Mint a soulbound lobster.
    function _mintSoulbound(address to, uint8 class_) internal returns (uint256 tokenId) {
        vm.prank(admin);
        tokenId = nft.mint(to, _pureDNA(class_), true);
    }

    /// @dev Mint `n` lobsters with incrementing classes to `to`, return array.
    function _mintN(address to, uint256 n) internal returns (uint256[] memory ids) {
        ids = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            ids[i] = _mintLobster(to, uint8(i % 10));
        }
    }

    /// @dev Mint exactly 3 lobsters to `to` and return them as a fixed array.
    function _mint3(address to) internal returns (uint256[3] memory ids) {
        for (uint256 i = 0; i < 3; i++) {
            ids[i] = _mintLobster(to, uint8(i % 10));
        }
    }

    /// @dev Create a team from `owner`'s first 3 minted lobsters. Returns teamId.
    function _createTeam(address owner) internal returns (uint256 teamId) {
        uint256[3] memory ids = _mint3(owner);
        vm.prank(owner);
        teamId = teamMgr.createTeam(ids);
    }

    // ── Token helpers ──────────────────────────────────────────────

    /// @dev Give `to` an amount of CLAW from LP wallet.
    function _giveClaw(address to, uint256 amount) internal {
        vm.prank(lpWallet);
        claw.transfer(to, amount);
    }

    // ── setUp ──────────────────────────────────────────────────────

    function setUp() public virtual {
        admin     = makeAddr("admin");
        devWallet = makeAddr("devWallet");
        lpWallet  = makeAddr("lpWallet");
        reserveWallet = makeAddr("reserveWallet");

        vm.startPrank(admin);

        // 1. Treasury (no token yet)
        treasury = new Treasury(admin, devWallet);

        // 2. ClawToken — mints 125M to lpWallet, 100M reserve to reserveWallet.
        //    TOK-H1: the reserve must NOT go to the Treasury fee-splitter (no withdrawal path).
        claw = new ClawToken(admin, lpWallet, reserveWallet);

        // 3. Set claw token on treasury
        treasury.setClawToken(address(claw));

        // 4. NFT + game contracts
        nft       = new LobsterNFT(admin, "https://api.clawbada.xyz/lobster/");
        teamMgr   = new TeamManager(admin, address(nft));
        miningPool = new MiningPool(admin, address(claw), address(nft), address(teamMgr));
        marketplace = new Marketplace(address(claw), address(nft), address(treasury));
        breedingLab = new BreedingLab(address(claw), address(nft), address(treasury));
        evolutionLab = new EvolutionLab(address(claw), address(nft), address(treasury));
        repairShop  = new RepairShop(address(claw), address(nft), address(treasury));
        battleVRF   = new BattleVRF(admin);
        battleArena = new BattleArena(
            admin, address(claw), address(nft), address(teamMgr), address(treasury), address(battleVRF)
        );
        faucet = new Faucet(admin, address(nft), address(claw), block.timestamp + 7 days);

        // 5. Grant roles — LobsterNFT
        nft.grantRole(nft.MINTER_ROLE(),  address(faucet));
        nft.grantRole(nft.MINTER_ROLE(),  address(breedingLab));
        nft.grantRole(nft.MINTER_ROLE(),  admin); // for test convenience
        nft.grantRole(nft.LOCKER_ROLE(),  address(teamMgr));
        nft.grantRole(nft.LOCKER_ROLE(),  admin); // for test convenience
        nft.grantRole(nft.EVOLVER_ROLE(), address(evolutionLab));
        nft.grantRole(nft.EVOLVER_ROLE(), admin); // for test convenience
        nft.grantRole(nft.DAMAGE_ROLE(),  address(battleArena));
        nft.grantRole(nft.DAMAGE_ROLE(),  address(repairShop));
        nft.grantRole(nft.DAMAGE_ROLE(),  admin); // for test convenience
        nft.grantRole(nft.BURNER_ROLE(),  address(evolutionLab));
        nft.grantRole(nft.BURNER_ROLE(),  admin); // for test convenience
        nft.grantRole(nft.BREED_ROLE(),   address(breedingLab));

        // 6. Grant roles — ClawToken
        claw.grantRole(claw.MINTER_ROLE(), address(miningPool));
        claw.grantRole(claw.MINTER_ROLE(), address(faucet));

        // 7. Grant roles — TeamManager
        teamMgr.grantRole(teamMgr.ACTIVITY_ROLE(), address(miningPool));
        teamMgr.grantRole(teamMgr.ACTIVITY_ROLE(), address(battleArena));

        // 8. Authorize game contracts in Treasury
        treasury.setAuthorized(address(marketplace),  true);
        treasury.setAuthorized(address(breedingLab),  true);
        treasury.setAuthorized(address(evolutionLab), true);
        treasury.setAuthorized(address(repairShop),   true);
        treasury.setAuthorized(address(battleArena),  true);

        // 9. Grant roles — BattleVRF / BattleArena / MiningPool / Faucet
        battleVRF.grantRole(battleVRF.OPERATOR_ROLE(), admin);
        battleArena.grantRole(battleArena.MATCHMAKER_ROLE(), admin);
        battleArena.grantRole(battleArena.RESOLVER_ROLE(),   admin);
        miningPool.grantRole(miningPool.SEASON_ADMIN_ROLE(), admin);
        faucet.grantRole(faucet.ELIGIBILITY_ROLE(), admin);

        vm.stopPrank();
    }
}

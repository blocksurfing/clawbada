// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC1155Supply} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {DNALib} from "./libraries/DNALib.sol";

/// @title LobsterNFT — ERC-1155 lobster NFTs for Clawbada
/// @notice Each lobster is a unique token (supply=1) with on-chain DNA, evolution tier, damage, and breeding state.
/// @dev Uses AccessControl with 6 granular roles for game contract integration.
///      Soulbound and locked restrictions enforced via _update override.
contract LobsterNFT is ERC1155, ERC1155Supply, AccessControl {
    using Strings for uint256;

    // ──────────── Roles ────────────
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant LOCKER_ROLE = keccak256("LOCKER_ROLE");
    bytes32 public constant EVOLVER_ROLE = keccak256("EVOLVER_ROLE");
    bytes32 public constant DAMAGE_ROLE = keccak256("DAMAGE_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    bytes32 public constant BREED_ROLE = keccak256("BREED_ROLE");

    // ──────────── Types ────────────
    struct Lobster {
        uint256 dna;
        uint8 evolutionTier; // 0=Base, 1=Evolved, 2=Elite, 3=Apex
        uint8 damage; // 0-100
        uint8 breedCount; // 0-5
        uint8 generation; // 0+
        bool soulbound;
        bool locked;
    }

    // ──────────── Constants ────────────
    uint8 public constant MAX_BREED_COUNT = 5;
    uint8 public constant MAX_DAMAGE = 100;
    uint8 public constant MAX_EVOLUTION_TIER = 3; // Apex

    // ──────────── State ────────────
    uint256 public nextTokenId = 1;
    string public baseURI;
    mapping(uint256 => Lobster) private _lobsters;
    mapping(uint256 => address) private _owners;

    // ──────────── Events ────────────
    event LobsterMinted(uint256 indexed tokenId, address indexed to, uint256 dna, uint8 generation, bool soulbound);
    event LobsterBurned(uint256 indexed tokenId);
    event LobsterLocked(uint256 indexed tokenId, bool locked);
    event LobsterDamageUpdated(uint256 indexed tokenId, uint8 oldDamage, uint8 newDamage);
    event LobsterEvolved(uint256 indexed tokenId, uint8 oldTier, uint8 newTier);
    event LobsterBred(uint256 indexed tokenId, uint8 newBreedCount);
    event BaseURIUpdated(string newBaseURI);

    // ──────────── Errors ────────────
    error TokenDoesNotExist(uint256 tokenId);
    error LobsterIsSoulbound(uint256 tokenId);
    error LobsterIsLocked(uint256 tokenId);
    error InvalidDNA();
    error DamageExceedsMax(uint8 damage);
    error InvalidEvolutionTier(uint8 tier);
    error BreedCountExceeded(uint256 tokenId);
    error ZeroAddress();

    // ──────────── Constructor ────────────

    /// @param admin The DEFAULT_ADMIN_ROLE holder
    /// @param baseURI_ The base URI for token metadata (e.g., "https://api.clawbada.com/lobster/")
    constructor(address admin, string memory baseURI_) ERC1155(baseURI_) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        baseURI = baseURI_;
    }

    // ──────────── Admin ────────────

    /// @notice Update the base URI for metadata.
    function setBaseURI(string calldata newBaseURI) external onlyRole(DEFAULT_ADMIN_ROLE) {
        baseURI = newBaseURI;
        emit BaseURIUpdated(newBaseURI);
    }

    // ──────────── Minting ────────────

    /// @notice Mint a new lobster (generation 0, used by Faucet).
    /// @param to Recipient address
    /// @param dna The packed uint256 DNA (must pass DNALib.isValid)
    /// @param soulbound_ Whether this lobster is soulbound (faucet lobsters)
    /// @return tokenId The newly minted token ID
    function mint(address to, uint256 dna, bool soulbound_) external onlyRole(MINTER_ROLE) returns (uint256 tokenId) {
        if (to == address(0)) revert ZeroAddress();
        if (!DNALib.isValid(dna)) revert InvalidDNA();

        tokenId = nextTokenId++;
        _lobsters[tokenId] = Lobster({
            dna: dna,
            evolutionTier: 0,
            damage: 0,
            breedCount: 0,
            generation: 0,
            soulbound: soulbound_,
            locked: false
        });

        _mint(to, tokenId, 1, "");
        emit LobsterMinted(tokenId, to, dna, 0, soulbound_);
    }

    /// @notice Mint a new lobster with explicit generation (used by BreedingLab for bred offspring).
    /// @param to Recipient address
    /// @param dna The packed uint256 DNA
    /// @param generation The offspring generation number
    /// @return tokenId The newly minted token ID
    function mintWithGeneration(address to, uint256 dna, uint8 generation)
        external
        onlyRole(MINTER_ROLE)
        returns (uint256 tokenId)
    {
        if (to == address(0)) revert ZeroAddress();
        if (!DNALib.isValid(dna)) revert InvalidDNA();

        tokenId = nextTokenId++;
        _lobsters[tokenId] = Lobster({
            dna: dna,
            evolutionTier: 0,
            damage: 0,
            breedCount: 0,
            generation: generation,
            soulbound: false, // bred offspring are never soulbound
            locked: false
        });

        _mint(to, tokenId, 1, "");
        emit LobsterMinted(tokenId, to, dna, generation, false);
    }

    // ──────────── Burning ────────────

    /// @notice Burn a lobster (for evolution fuel). Must not be locked.
    function burn(uint256 tokenId) external onlyRole(BURNER_ROLE) {
        _requireExists(tokenId);
        if (_lobsters[tokenId].locked) revert LobsterIsLocked(tokenId);

        address owner = _owners[tokenId];
        _burn(owner, tokenId, 1);
        delete _lobsters[tokenId];
        emit LobsterBurned(tokenId);
    }

    // ──────────── State Modifiers ────────────

    /// @notice Set the lock status of a lobster (team/mine/battle).
    function setLocked(uint256 tokenId, bool locked_) external onlyRole(LOCKER_ROLE) {
        _requireExists(tokenId);
        _lobsters[tokenId].locked = locked_;
        emit LobsterLocked(tokenId, locked_);
    }

    /// @notice Set the damage value on a lobster.
    /// @param tokenId The lobster token ID
    /// @param damage New damage value (0-100)
    function setDamage(uint256 tokenId, uint8 damage) external onlyRole(DAMAGE_ROLE) {
        _requireExists(tokenId);
        if (damage > MAX_DAMAGE) revert DamageExceedsMax(damage);
        uint8 oldDamage = _lobsters[tokenId].damage;
        _lobsters[tokenId].damage = damage;
        emit LobsterDamageUpdated(tokenId, oldDamage, damage);
    }

    /// @notice Set the evolution tier of a lobster.
    /// @param tokenId The lobster token ID
    /// @param tier New evolution tier (0=Base, 1=Evolved, 2=Elite, 3=Apex)
    function setEvolutionTier(uint256 tokenId, uint8 tier) external onlyRole(EVOLVER_ROLE) {
        _requireExists(tokenId);
        if (tier > MAX_EVOLUTION_TIER) revert InvalidEvolutionTier(tier);
        uint8 oldTier = _lobsters[tokenId].evolutionTier;
        _lobsters[tokenId].evolutionTier = tier;
        emit LobsterEvolved(tokenId, oldTier, tier);
    }

    /// @notice Increment the breed count of a lobster. Reverts if already at max (5).
    function incrementBreedCount(uint256 tokenId) external onlyRole(BREED_ROLE) {
        _requireExists(tokenId);
        if (_lobsters[tokenId].breedCount >= MAX_BREED_COUNT) revert BreedCountExceeded(tokenId);
        _lobsters[tokenId].breedCount++;
        emit LobsterBred(tokenId, _lobsters[tokenId].breedCount);
    }

    // ──────────── View Functions ────────────

    /// @notice Get full lobster data.
    function getLobster(uint256 tokenId) external view returns (Lobster memory) {
        _requireExists(tokenId);
        return _lobsters[tokenId];
    }

    /// @notice Get just the DNA.
    function getDNA(uint256 tokenId) external view returns (uint256) {
        _requireExists(tokenId);
        return _lobsters[tokenId].dna;
    }

    /// @notice Get the evolution tier.
    function getEvolutionTier(uint256 tokenId) external view returns (uint8) {
        _requireExists(tokenId);
        return _lobsters[tokenId].evolutionTier;
    }

    /// @notice Get the damage value.
    function getDamage(uint256 tokenId) external view returns (uint8) {
        _requireExists(tokenId);
        return _lobsters[tokenId].damage;
    }

    /// @notice Get whether a lobster is locked.
    function isLocked(uint256 tokenId) external view returns (bool) {
        _requireExists(tokenId);
        return _lobsters[tokenId].locked;
    }

    /// @notice Get whether a lobster is soulbound.
    function isSoulbound(uint256 tokenId) external view returns (bool) {
        _requireExists(tokenId);
        return _lobsters[tokenId].soulbound;
    }

    /// @notice Get breed count.
    function getBreedCount(uint256 tokenId) external view returns (uint8) {
        _requireExists(tokenId);
        return _lobsters[tokenId].breedCount;
    }

    /// @notice Get generation.
    function getGeneration(uint256 tokenId) external view returns (uint8) {
        _requireExists(tokenId);
        return _lobsters[tokenId].generation;
    }

    /// @notice Calculate purity score from the lobster's DNA.
    function getPurity(uint256 tokenId) external view returns (uint8) {
        _requireExists(tokenId);
        return DNALib.calculatePurity(_lobsters[tokenId].dna);
    }

    /// @notice Get the owner of a lobster (each has supply=1).
    function ownerOf(uint256 tokenId) external view returns (address) {
        _requireExists(tokenId);
        return _owners[tokenId];
    }

    /// @notice Total number of lobsters minted (including burned).
    function totalMinted() external view returns (uint256) {
        return nextTokenId - 1;
    }

    /// @notice Per-token metadata URI.
    function uri(uint256 tokenId) public view override returns (string memory) {
        return string.concat(baseURI, tokenId.toString());
    }

    // ──────────── Internal ────────────

    /// @dev Override _update to enforce soulbound/locked restrictions and track ownership.
    function _update(address from, address to, uint256[] memory ids, uint256[] memory values)
        internal
        override(ERC1155, ERC1155Supply)
    {
        // Enforce transfer restrictions (skip for mints and burns)
        if (from != address(0) && to != address(0)) {
            for (uint256 i = 0; i < ids.length; i++) {
                Lobster storage lob = _lobsters[ids[i]];
                if (lob.soulbound) revert LobsterIsSoulbound(ids[i]);
                if (lob.locked) revert LobsterIsLocked(ids[i]);
            }
        }

        super._update(from, to, ids, values);

        // Update ownership tracking
        for (uint256 i = 0; i < ids.length; i++) {
            if (to == address(0)) {
                delete _owners[ids[i]];
            } else {
                _owners[ids[i]] = to;
            }
        }
    }

    /// @dev Revert if token does not exist.
    function _requireExists(uint256 tokenId) internal view {
        if (!exists(tokenId)) revert TokenDoesNotExist(tokenId);
    }

    /// @dev Required override for AccessControl + ERC1155.
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC1155, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}

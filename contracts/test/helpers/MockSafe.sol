// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev The slice of a Safe the handoff relies on: the two views Handoff probes, and a way
///      for the "signers" to execute a call AS the Safe (Treasury.acceptOwnership()).
contract MockSafe {
    address[] internal _owners;
    uint256 internal _threshold;

    constructor(address[] memory owners_, uint256 threshold_) {
        _owners = owners_;
        _threshold = threshold_;
    }

    function getThreshold() external view returns (uint256) {
        return _threshold;
    }

    function getOwners() external view returns (address[] memory) {
        return _owners;
    }

    function exec(address to, bytes calldata data) external {
        (bool ok, bytes memory ret) = to.call(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IRateProvider {
    /// @notice Current WIF per ETH rate (both 18 decimals) and the last timestamp it may be used at.
    /// @dev Called during ERC-4337 validation, so it must not read block.timestamp or other banned
    ///      opcodes (ERC-7562). Expiry is enforced by the EntryPoint through validUntil instead.
    ///      Reverts if the provider is paused.
    function quote() external view returns (uint256 wifPerEth, uint48 validUntil);

    /// @notice Returns the amount of WIF (18 decimals) required to pay for `ethAmount` wei of gas.
    /// @dev For off-chain callers and UIs. Reverts when paused or stale.
    function getWifForEth(uint256 ethAmount) external view returns (uint256 wifAmount);

    /// @notice Whether the rate provider is currently healthy (not paused and not stale).
    function isHealthy() external view returns (bool);
}

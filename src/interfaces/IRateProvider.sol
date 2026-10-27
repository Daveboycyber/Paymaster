// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IRateProvider {
    /// @notice Returns the amount of WIF (18 decimals) required to pay for `ethAmount` wei of gas.
    /// @dev Must be safe against manipulation. Implementations should apply bounds and circuit breakers.
    function getWifForEth(uint256 ethAmount) external view returns (uint256 wifAmount);

    /// @notice Whether the rate provider is currently healthy (not circuit-broken).
    function isHealthy() external view returns (bool);
}

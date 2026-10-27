// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IRateProvider} from "./interfaces/IRateProvider.sol";

/**
 * @title BoundedRateProvider
 * @notice Simple, safe rate provider for the hackathon.
 *         Uses a manually set rate with hard bounds + circuit breaker.
 *         For thin liquidity this is safer than a raw pool TWAP.
 */
contract BoundedRateProvider is IRateProvider {
    address public owner;

    // Rate: how many WIF (1e18) equal 1 ETH (1e18)
    uint256 public wifPerEth;

    uint256 public minWifPerEth;
    uint256 public maxWifPerEth;

    bool public paused;
    uint256 public lastUpdateTimestamp;
    uint256 public constant MAX_UPDATE_AGE = 6 hours;

    event RateUpdated(uint256 oldRate, uint256 newRate);
    event BoundsUpdated(uint256 minRate, uint256 maxRate);
    event Paused(bool isPaused);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error RateOutOfBounds();
    error ProviderPaused();
    error RateStale();
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(uint256 initialWifPerEth, uint256 _minWifPerEth, uint256 _maxWifPerEth) {
        owner = msg.sender;
        require(_minWifPerEth <= initialWifPerEth && initialWifPerEth <= _maxWifPerEth, "invalid bounds");
        wifPerEth = initialWifPerEth;
        minWifPerEth = _minWifPerEth;
        maxWifPerEth = _maxWifPerEth;
        lastUpdateTimestamp = block.timestamp;
    }

    function getWifForEth(uint256 ethAmount) external view override returns (uint256) {
        if (paused) revert ProviderPaused();
        if (block.timestamp > lastUpdateTimestamp + MAX_UPDATE_AGE) revert RateStale();
        return (ethAmount * wifPerEth) / 1e18;
    }

    function isHealthy() external view override returns (bool) {
        return !paused && block.timestamp <= lastUpdateTimestamp + MAX_UPDATE_AGE;
    }

    function setRate(uint256 newWifPerEth) external onlyOwner {
        if (newWifPerEth < minWifPerEth || newWifPerEth > maxWifPerEth) {
            revert RateOutOfBounds();
        }
        uint256 old = wifPerEth;
        wifPerEth = newWifPerEth;
        lastUpdateTimestamp = block.timestamp;
        emit RateUpdated(old, newWifPerEth);
    }

    function setBounds(uint256 _min, uint256 _max) external onlyOwner {
        require(_min <= _max, "min > max");
        minWifPerEth = _min;
        maxWifPerEth = _max;
        if (wifPerEth < _min) wifPerEth = _min;
        if (wifPerEth > _max) wifPerEth = _max;
        emit BoundsUpdated(_min, _max);
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit Paused(_paused);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        address old = owner;
        owner = newOwner;
        emit OwnershipTransferred(old, newOwner);
    }
}

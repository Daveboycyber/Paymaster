// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IRateProvider} from "./interfaces/IRateProvider.sol";

/**
 * @title BoundedRateProvider
 * @notice Simple, safe rate provider for the hackathon.
 *         Uses a manually set rate with hard bounds + circuit breaker.
 *         For thin liquidity this is safer than a raw pool TWAP.
 *         A keeper (e.g. a bot) can refresh the rate without holding the owner key. Keeper updates
 *         are rate-limited (max change per update, min interval), so a leaked keeper key can only
 *         walk the price slowly while the owner pauses or replaces it. The owner is not limited.
 */
contract BoundedRateProvider is IRateProvider {
    address public owner;
    address public pendingOwner;
    address public keeper;

    // Rate: how many WIF (1e18) equal 1 ETH (1e18)
    uint256 public wifPerEth;

    uint256 public minWifPerEth;
    uint256 public maxWifPerEth;

    bool public paused;
    uint256 public lastUpdateTimestamp;
    uint256 public constant MAX_UPDATE_AGE = 6 hours;
    uint256 public constant KEEPER_MIN_INTERVAL = 10 minutes;
    uint256 public maxKeeperChangeBps = 2000; // keeper may move the rate at most 20% per update

    event RateUpdated(uint256 oldRate, uint256 newRate);
    event BoundsUpdated(uint256 minRate, uint256 maxRate);
    event Paused(bool isPaused);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event KeeperUpdated(address indexed keeper);
    event MaxKeeperChangeUpdated(uint256 bps);

    error NotOwner();
    error NotOwnerOrKeeper();
    error RateOutOfBounds();
    error ProviderPaused();
    error RateStale();
    error ZeroAddress();
    error KeeperTooSoon();
    error KeeperChangeTooLarge();
    error InvalidBps();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyOwnerOrKeeper() {
        if (msg.sender != owner && msg.sender != keeper) revert NotOwnerOrKeeper();
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

    /// @inheritdoc IRateProvider
    function quote() external view override returns (uint256, uint48) {
        if (paused) revert ProviderPaused();
        return (wifPerEth, uint48(lastUpdateTimestamp + MAX_UPDATE_AGE));
    }

    function getWifForEth(uint256 ethAmount) external view override returns (uint256) {
        if (paused) revert ProviderPaused();
        if (block.timestamp > lastUpdateTimestamp + MAX_UPDATE_AGE) revert RateStale();
        return (ethAmount * wifPerEth) / 1e18;
    }

    function isHealthy() external view override returns (bool) {
        return !paused && block.timestamp <= lastUpdateTimestamp + MAX_UPDATE_AGE;
    }

    function setRate(uint256 newWifPerEth) external onlyOwnerOrKeeper {
        if (newWifPerEth < minWifPerEth || newWifPerEth > maxWifPerEth) {
            revert RateOutOfBounds();
        }
        uint256 old = wifPerEth;
        if (msg.sender != owner) {
            if (block.timestamp < lastUpdateTimestamp + KEEPER_MIN_INTERVAL) revert KeeperTooSoon();
            uint256 diff = newWifPerEth > old ? newWifPerEth - old : old - newWifPerEth;
            if (diff * 10_000 > old * maxKeeperChangeBps) revert KeeperChangeTooLarge();
        }
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

    function setKeeper(address _keeper) external onlyOwner {
        keeper = _keeper;
        emit KeeperUpdated(_keeper);
    }

    function setMaxKeeperChangeBps(uint256 bps) external onlyOwner {
        if (bps > 10_000) revert InvalidBps();
        maxKeeperChangeBps = bps;
        emit MaxKeeperChangeUpdated(bps);
    }

    /// @notice Starts a two-step transfer (e.g. to a Safe); the new owner must call acceptOwnership.
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }
}

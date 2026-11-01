// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {WIFPaymaster} from "../src/WIFPaymaster.sol";
import {BoundedRateProvider} from "../src/BoundedRateProvider.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * Deploy script for Robinhood Chain.
 *
 * Usage:
 *   forge script script/Deploy.s.sol:Deploy --rpc-url $RPC --broadcast --private-key $PK
 *
 * Required env:
 *   WIF_TOKEN          = 0x5173b8eA6923c2d40267890D45C46a3480954773
 *   ENTRY_POINT        = 0x0000000071727De22E5E9d8BAf0edAc6f37da032  (v0.7 recommended)
 *   TREASURY           = your treasury address
 *   INITIAL_WIF_PER_ETH = e.g. 800000000000000000000000  (800k WIF per ETH)
 *
 * Optional env:
 *   KEEPER             = address allowed to refresh the rate (e.g. a bot)
 *   DEPOSIT_WEI        = ETH to deposit into the EntryPoint for sponsoring gas
 *   STAKE_WEI          = ETH to stake; bundlers require a staked paymaster because
 *                        validation touches the rate provider and token storage (ERC-7562)
 *   UNSTAKE_DELAY_SEC  = stake unlock delay (default 86400)
 */
contract Deploy is Script {
    // Official addresses on Robinhood Chain (4663)
    address constant WIF_TOKEN = 0x5173b8eA6923c2d40267890D45C46a3480954773;
    address constant ENTRY_POINT_V07 = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address treasury = vm.envAddress("TREASURY");
        uint256 initialWifPerEth = vm.envUint("INITIAL_WIF_PER_ETH");
        address keeper = vm.envOr("KEEPER", address(0));
        uint256 depositWei = vm.envOr("DEPOSIT_WEI", uint256(0));
        uint256 stakeWei = vm.envOr("STAKE_WEI", uint256(0));
        uint32 unstakeDelay = uint32(vm.envOr("UNSTAKE_DELAY_SEC", uint256(1 days)));

        // Reasonable bounds for hackathon (adjust after checking live price)
        uint256 minRate = initialWifPerEth / 5;   // 0.2x
        uint256 maxRate = initialWifPerEth * 5;   // 5x

        vm.startBroadcast(deployerPrivateKey);

        BoundedRateProvider rateProvider = new BoundedRateProvider(
            initialWifPerEth,
            minRate,
            maxRate
        );

        WIFPaymaster paymaster = new WIFPaymaster(
            IEntryPoint(ENTRY_POINT_V07),
            IERC20(WIF_TOKEN),
            rateProvider,
            treasury
        );

        if (keeper != address(0)) rateProvider.setKeeper(keeper);
        if (depositWei > 0) paymaster.depositToEntryPoint{value: depositWei}();
        if (stakeWei > 0) paymaster.addStake{value: stakeWei}(unstakeDelay);

        console2.log("BoundedRateProvider:", address(rateProvider));
        console2.log("WIFPaymaster:", address(paymaster));
        console2.log("EntryPoint:", ENTRY_POINT_V07);
        console2.log("WIF Token:", WIF_TOKEN);

        vm.stopBroadcast();
    }
}

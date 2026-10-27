// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {WIFPaymaster} from "../src/WIFPaymaster.sol";
import {BoundedRateProvider} from "../src/BoundedRateProvider.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";

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
 */
contract Deploy is Script {
    // Official addresses on Robinhood Chain (4663)
    address constant WIF_TOKEN = 0x5173b8eA6923c2d40267890D45C46a3480954773;
    address constant ENTRY_POINT_V07 = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address treasury = vm.envAddress("TREASURY");
        uint256 initialWifPerEth = vm.envUint("INITIAL_WIF_PER_ETH");

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

        console2.log("BoundedRateProvider:", address(rateProvider));
        console2.log("WIFPaymaster:", address(paymaster));
        console2.log("EntryPoint:", ENTRY_POINT_V07);
        console2.log("WIF Token:", WIF_TOKEN);

        // Optional: deposit some ETH so the paymaster can sponsor immediately
        // paymaster.depositToEntryPoint{value: 0.5 ether}();

        vm.stopBroadcast();
    }
}

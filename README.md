# WIF Paymaster

**Pay gas in $WIF on Robinhood Chain.**

ERC-4337 Paymaster that lets users execute transactions (including World is Flat votes) with **zero ETH**. Gas is paid in $WIF. A portion of every payment is burned.

Built for the [World is Flat Hackathon](https://worldisflat.fun/build).

---

## Live Deployed Contracts (Robinhood Chain - 4663)

| Contract | Address |
|----------|---------|
| **WIFPaymaster** | [`0x7e0bCEFa1568Bf8ad9a20F1AbfDE5FaE47ac84dE`](https://robinhoodchain.blockscout.com/address/0x7e0bCEFa1568Bf8ad9a20F1AbfDE5FaE47ac84dE) |
| **BoundedRateProvider** | [`0x3A040be5ee7829A38943294DFC6116Bf095eF497`](https://robinhoodchain.blockscout.com/address/0x3A040be5ee7829A38943294DFC6116Bf095eF497) |
| **$WIF Token** | [`0x5173b8eA6923c2d40267890D45C46a3480954773`](https://robinhoodchain.blockscout.com/address/0x5173b8eA6923c2d40267890D45C46a3480954773) |
| **EntryPoint v0.7** | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |

---

## Why this exists

Voting with $WIF currently still requires ETH for gas. This is friction that contradicts the project’s own ideology.  
WIF Paymaster removes that friction and turns $WIF into real chain utility.

**Demo line:**  
> “I voted with only $WIF. My wallet has 0 ETH.”

---

## Architecture

```
User (Smart Account)
    │
    │ UserOperation (paymaster = WIFPaymaster)
    ▼
Bundler (Alchemy)
    │
    ▼
EntryPoint (v0.7)
    │
    ├── validatePaymasterUserOp()  →  checks caps, prices maxCost in $WIF, pulls that prefund
    │                                   returns validUntil = rate expiry (EntryPoint enforces it)
    │
    ├── execute UserOp (e.g. send 1 $WIF to vote address)
    │
    └── postOp()  →  charges actual cost, refunds the rest, burns %, sends rest to treasury
```

The fee is taken up front, so nothing the UserOp does (reverting, revoking the allowance, spending
its $WIF) can leave the paymaster paying gas for free. Reverted UserOps still pay for the gas they used.

### Key Contracts

| Contract | Purpose |
|----------|---------|
| `WIFPaymaster` | Main paymaster. Sponsors gas, charges $WIF, burns portion |
| `BoundedRateProvider` | Safe $WIF/ETH rate with hard bounds + circuit breaker |
| `MockWIF` | Test token |

### Safety Features

- Hard per-transaction gas cost cap (default 0.02 ETH)
- Global daily sponsorship limit, counted on actual cost
- Bounded rate (cannot be manipulated via thin pool) that expires 6h after the last update
- Prefund + refund: reverted or allowance-revoking UserOps cannot drain the deposit
- Optional user-signed `maxWif` cap, so the owner cannot raise the price on a pending UserOp
- ERC-7562 compliant validation (no `block.timestamp`); paymaster must be staked
- Keeper role so a bot can refresh the rate without the owner key
- Configurable premium + burn percentage
- Circuit breaker on rate provider

---

## Quick Start

### 1. Install

```bash
git clone https://github.com/Daveboycyber/Paymaster.git
cd Paymaster
git submodule update --init --recursive
```

### 2. Test

```bash
forge test -vv
```

### 3. Deploy to Robinhood Chain

```bash
export PRIVATE_KEY=0x...
export TREASURY=0xYourTreasury
export INITIAL_WIF_PER_ETH=2000000000000000000000000
# optional
export KEEPER=0xYourRateBot
export DEPOSIT_WEI=100000000000000000   # 0.1 ETH to sponsor gas
export STAKE_WEI=100000000000000000     # stake required by bundlers

forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://rpc.mainnet.chain.robinhood.com \
  --broadcast
```

After deploy (skip what the optional env vars already did):
1. Call `depositToEntryPoint{value: X ether}()` so the paymaster has ETH to sponsor with.
2. Call `addStake{value: X ether}(86400)`. Bundlers reject unstaked paymasters whose validation reads other storage.
3. Keep the rate fresh: `setRate()` from the owner or keeper at least every 6 hours, or UserOps fail with `AA32`.

---

## Frontend demo

`frontend/` is a real, zero-ETH demo: no fake hashes, every action is a UserOperation on Robinhood Chain.

1. **Connect** an extension wallet (it only signs) or create a browser account. Either way you get a SimpleAccount (v0.7) smart account.
2. **Add $WIF** to that account. It never needs ETH.
3. **Turn on $WIF gas**: one sponsored setup op deploys the account and approves the paymaster, paid in $WIF.
4. **Send $WIF**: every op shows the real tx, the $WIF paid as gas, the amount burned and 0 ETH used.

Live totals (transactions sponsored, $WIF paid, $WIF burned) come from the paymaster's `UserOpSponsored` events.

```bash
cd frontend
cp .env.example .env.local   # set VITE_PAYMASTER and VITE_PAYMASTER_DEPLOY_BLOCK after a redeploy
npm install
npm run dev
```

It uses the Pimlico public bundler for chain 4663 by default (no API key). Any ERC-4337 v0.7 bundler works via `VITE_BUNDLER_URL`.

---

## Configuration (Owner)

```solidity
setPremiumBps(1500);      // 15% premium
setBurnBps(3000);         // 30% burned
setMaxGasCostWei(0.02e18);
setDailyLimitWei(1e18);
setPostOpGasOverhead(120_000);
setRateProvider(newProvider);
// on BoundedRateProvider
setKeeper(bot);
setRate(newWifPerEth);
```

---

## Integration (for other builders)

Minimal snippet for a dApp:

```ts
// Using permissionless.js / Alchemy Account Kit / ZeroDev etc.
const userOp = await smartAccount.encodeUserOp({
  // ... your call (vote, transfer, etc.)
  paymaster: {
    address: "0x7e0bCEFa1568Bf8ad9a20F1AbfDE5FaE47ac84dE",
  }
});

// First op of a new account (it can't pay gas to approve): send exactly
// execute(WIF, 0, approve(paymaster, MaxUint256)). The paymaster sponsors that one
// setup op per account, deploys the account via initCode, and charges the fee in $WIF.
```

`paymasterAndData` layout (EntryPoint v0.7):

| Bytes | Field |
|-------|-------|
| 0-20 | paymaster address |
| 20-36 | paymaster verification gas limit (~100k) |
| 36-52 | paymaster postOp gas limit (use 150k, postOp needs ~90k) |
| 52-84 | optional `maxWif` (uint256): reject if the fee could exceed this |

Use `quoteWif(maxCost)` on the paymaster to show the user the price before signing.

---

## Roadmap / Next Steps

- [x] Deploy contracts to Robinhood Chain
- [x] Frontend demo with real zero-ETH transactions
- [x] One-click “Turn on $WIF gas” button
- [x] Live totals of $WIF paid and burned
- [ ] Vote with $WIF through the paymaster once the hackathon vote contract is published
- [ ] Optional EIP-7702 support path
- [x] Prefund/refund, ERC-7562 compliant validation, keeper role
- [x] One sponsored setup op per account, so a brand-new account needs zero ETH
- [ ] Redeploy contracts with the fixes and stake the paymaster
- [ ] Production TWAP + Chainlink rate provider (post-hackathon)

---

Built for the World is Flat Hackathon — October 2026.

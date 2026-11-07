# WIF Paymaster

**Pay gas in $WIF on Robinhood Chain.**

ERC-4337 Paymaster that lets users execute transactions (including World is Flat votes) with **zero ETH**. Gas is paid in $WIF. A portion of every payment is burned.

Built for the [World is Flat Hackathon](https://worldisflat.fun/build).

**Live demo:** [https://paymaster-y3tc-zeta.vercel.app](https://paymaster-y3tc-zeta.vercel.app)

**Proof (real sponsored UserOp, 0 ETH):** [0xcd9525ff…72c4](https://robinhoodchain.blockscout.com/tx/0xcd9525ff63b8cd226c4b3682ee35054aef2c92424b16dd514cd594b6556872c4)

---

## Live Deployed Contracts (Robinhood Chain · 4663)

| Contract | Address |
|----------|---------|
| **WIFPaymaster** | [`0x2f35763c885684a0c864945f027edf5be5d7002b`](https://robinhoodchain.blockscout.com/address/0x2f35763c885684a0c864945f027edf5be5d7002b) |
| **BoundedRateProvider** | [`0x61ebf750cadb1ddf2b0ee7f168110cd18b8bda38`](https://robinhoodchain.blockscout.com/address/0x61ebf750cadb1ddf2b0ee7f168110cd18b8bda38) |
| **$WIF Token** | [`0x5173b8eA6923c2d40267890D45C46a3480954773`](https://robinhoodchain.blockscout.com/address/0x5173b8eA6923c2d40267890D45C46a3480954773) |
| **EntryPoint v0.7** | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |
| **Deploy block** | `108578734` |

Deposit and stake are live. The paymaster sponsors UserOperations on mainnet.

---

## Why this exists

Voting with $WIF currently still requires ETH for gas. That friction contradicts the project’s ideology.  
WIF Paymaster removes it and turns $WIF into real chain utility.

**Demo line:**  
> “I sent $WIF with only $WIF. My wallet has 0 ETH.”

---

## Architecture

```
User (Smart Account)
    │
    │ UserOperation (paymaster = WIFPaymaster)
    ▼
Bundler (Pimlico public / any ERC-4337 v0.7)
    │
    ▼
EntryPoint (v0.7)
    │
    ├── validatePaymasterUserOp()  →  checks caps, prices maxCost in $WIF, pulls that prefund
    │                                   returns validUntil = rate expiry, validAfter = end of a full
    │                                   daily window (the EntryPoint enforces both)
    │
    ├── execute UserOp (e.g. send 1 $WIF)
    │
    └── postOp()  →  charges actual cost, refunds the rest, books the burn + treasury shares

flush() (anyone, e.g. the keeper)  →  WIF.burn() the burn share (real supply reduction), pay the treasury
```

The fee is taken up front, so nothing the UserOp does (reverting, revoking the allowance, spending its $WIF) can leave the paymaster paying gas for free. Reverted UserOps still pay for the gas they used.

### Key Contracts

| Contract | Purpose |
|----------|---------|
| `WIFPaymaster` | Main paymaster. Sponsors gas, charges $WIF, burns portion |
| `BoundedRateProvider` | Safe $WIF/ETH rate with hard bounds, expiry, pause and a rate-limited keeper |
| `keeper/` | Bot that follows the market WIF/ETH price and calls `flush()` (GitHub Actions cron) |
| `MockWIF` | Test token |

### Safety Features

- Hard per-transaction gas cost cap (default 0.02 ETH)
- Global (1 ETH) and per-account (0.05 ETH) daily limits, counted on actual cost
- Bounded rate (cannot be manipulated via thin pool) that expires 6h after the last update
- Keeper can move the rate at most 20% per 10 minutes; the owner can pause
- Prefund + refund: reverted or allowance-revoking UserOps cannot drain the deposit
- User-signed `maxWif` cap (the demo always sends it), so nobody can raise the price on a pending UserOp
- ERC-7562 compliant validation (no `block.timestamp`); paymaster must be staked
- Real burns with `WIF.burn()`, batched by `flush()` so each op makes one transfer instead of three
- Two-step ownership (use a Safe); `rescueWif` can't touch the burn or treasury shares
- Totals on-chain (`totals()`: ops, $WIF charged, $WIF burned) for dashboards

See [SECURITY.md](SECURITY.md) for the threat model, the tests behind each mitigation, and the Slither review.

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

Live: [https://paymaster-y3tc-zeta.vercel.app](https://paymaster-y3tc-zeta.vercel.app)

`frontend/` is a real, zero-ETH demo: no fake hashes, every action is a UserOperation on Robinhood Chain.

1. **Connect** an extension wallet (it only signs) or create a browser account. Either way you get a SimpleAccount (v0.7) smart account.
2. **Add $WIF** to that account. It never needs ETH.
3. **Turn on $WIF gas**: one sponsored setup op deploys the account and approves the paymaster, paid in $WIF.
4. **Send $WIF**: every op shows the real tx, the $WIF paid as gas, the amount burned and 0 ETH used.

Every op carries a signed `maxWif` cap (the quote plus 10%), so the price can't be raised after the user signs.
Live totals come from the paymaster's on-chain `totals()`, and the activity list from its `UserOpSponsored` events.

```bash
cd frontend
cp .env.example .env.local
# VITE_PAYMASTER=0x2f35763c885684a0c864945f027edf5be5d7002b
# VITE_PAYMASTER_DEPLOY_BLOCK=108578734
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
setAccountDailyLimitWei(0.05e18);
setPostOpGasOverhead(120_000);
setRateProvider(newProvider);
transferOwnership(safe);  // then acceptOwnership() from the Safe
// on BoundedRateProvider
setKeeper(bot);
setMaxKeeperChangeBps(2000);
setRate(newWifPerEth);
```

### Keeper

`keeper/keeper.mjs` does one pass and exits:
1. Reads WIF/ETH from the deepest WIF/ETH pool on Robinhood Chain.
2. Moves the rate toward it, within the bounds and the keeper's 20% limit. It refreshes at least every 3h, so the rate never hits its 6h expiry.
3. Calls `flush()` once 1,000+ $WIF is pending.

`.github/workflows/keeper.yml` runs it every 30 minutes. Set the repo variables `RATE_PROVIDER` and `PAYMASTER`, and the secret `KEEPER_PRIVATE_KEY`.

```bash
cd keeper && npm ci
RATE_PROVIDER=0x61ebf750cadb1ddf2b0ee7f168110cd18b8bda38 \
PAYMASTER=0x2f35763c885684a0c864945f027edf5be5d7002b \
KEEPER_PRIVATE_KEY=0x... DRY_RUN=1 npm start
```

---

## Integration (for other builders)

```ts
// Using permissionless.js / Alchemy Account Kit / ZeroDev etc.
const userOp = await smartAccount.encodeUserOp({
  // ... your call (vote, transfer, etc.)
  paymaster: {
    address: "0x2f35763c885684a0c864945f027edf5be5d7002b",
  }
});

// First op of a new account (it can't pay gas to approve): make the only call
// approve(paymaster, MaxUint256) on $WIF. The paymaster sponsors that one setup op per
// account, deploys the account via initCode, and charges the fee in $WIF.
```

`paymasterAndData` layout (EntryPoint v0.7):

| Bytes | Field |
|-------|-------|
| 0-20 | paymaster address |
| 20-36 | paymaster verification gas limit (100k) |
| 36-52 | paymaster postOp gas limit (150k) |
| 52-84 | optional `maxWif` (uint256) |

Use `quoteWif(maxCost)` on the paymaster to show the user the price before signing.

---

## Roadmap

- [x] Deploy contracts to Robinhood Chain
- [x] Frontend demo with real zero-ETH transactions
- [x] One-click “Turn on $WIF gas” button
- [x] Live totals of $WIF paid and burned
- [x] Prefund/refund, ERC-7562 compliant validation, keeper role
- [x] One sponsored setup op per account (brand-new account needs zero ETH)
- [x] Real burns, batched flush, per-account limits
- [x] Redeploy fixed contracts, deposit, and stake
- [x] Verified mainnet sponsored UserOp ([proof](https://robinhoodchain.blockscout.com/tx/0xcd9525ff63b8cd226c4b3682ee35054aef2c92424b16dd514cd594b6556872c4))
- [ ] Vote with $WIF through the paymaster once the hackathon vote contract is published
- [ ] Optional EIP-7702 support path
- [ ] Production TWAP + Chainlink rate provider (post-hackathon)

---

Built for the World is Flat Hackathon — October–November 2026.

## License

MIT, see [LICENSE](LICENSE).

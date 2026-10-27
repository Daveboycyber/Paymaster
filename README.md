# WIF Paymaster

**Pay gas in $WIF on Robinhood Chain.**

ERC-4337 Paymaster that lets users execute transactions (including World is Fair votes) with **zero ETH**. Gas is paid in $WIF. A portion of every payment is burned.

Built for the [World is Flat Hackathon](https://worldisflat.fun/build).

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
    ├── validatePaymasterUserOp()  →  checks rate, caps, balance, allowance
    │
    ├── execute UserOp (e.g. send 1 $WIF to vote address)
    │
    └── postOp()  →  pulls $WIF, burns %, sends rest to treasury
```

### Key Contracts

| Contract | Purpose |
|----------|---------|
| `WIFPaymaster` | Main paymaster. Sponsors gas, charges $WIF, burns portion |
| `BoundedRateProvider` | Safe $WIF/ETH rate with hard bounds + circuit breaker |
| `MockWIF` | Test token |

### Safety Features

- Hard per-transaction gas cost cap (default 0.02 ETH)
- Global daily sponsorship limit
- Bounded rate (cannot be manipulated via thin pool)
- Explicit $WIF allowance required
- Configurable premium + burn percentage
- Circuit breaker on rate provider

---

## Quick Start

### 1. Install

```bash
git clone <this-repo>
cd wif-paymaster
forge install
```

### 2. Test

```bash
forge test -vv
```

### 3. Deploy to Robinhood Chain

```bash
export PRIVATE_KEY=0x...
export TREASURY=0xYourTreasury
export INITIAL_WIF_PER_ETH=800000000000000000000000   # adjust to current market

forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://robinhood-mainnet.g.alchemy.com/v2/YOUR_KEY \
  --broadcast \
  --verify  # if explorer supports it
```

After deploy:
1. Call `depositToEntryPoint{value: X ether}()` so the paymaster has ETH to sponsor with.
2. (Optional) Call `addStake()` if required by bundlers.

---

## Configuration (Owner)

```solidity
setPremiumBps(1500);      // 15% premium
setBurnBps(3000);         // 30% burned
setMaxGasCostWei(0.02e18);
setDailyLimitWei(1e18);
setRateProvider(newProvider);
```

---

## Integration (for other builders)

Minimal snippet for a dApp:

```ts
// Using permissionless.js / Alchemy Account Kit / ZeroDev etc.
const userOp = await smartAccount.encodeUserOp({
  // ... your call (vote, transfer, etc.)
  paymaster: {
    address: WIF_PAYMASTER_ADDRESS,
    // most SDKs auto-fill paymasterAndData
  }
});

// User must have approved the paymaster for $WIF beforehand
await wif.approve(WIF_PAYMASTER_ADDRESS, MaxUint256);
```

---

## Addresses (to be filled after deploy)

- **WIFPaymaster**: `TBD`
- **BoundedRateProvider**: `TBD`
- **$WIF**: `0x5173b8eA6923c2d40267890D45C46a3480954773`
- **EntryPoint v0.7**: `0x0000000071727De22E5E9d8BAf0edAc6f37da032`

---

## Roadmap / Next Steps

- [ ] Frontend demo (zero-ETH wallet → real vote)
- [ ] One-click “Enable gas payment with $WIF” button
- [ ] Dashboard of total $WIF collected / burned
- [ ] Optional EIP-7702 support path
- [ ] Production TWAP + Chainlink rate provider (post-hackathon)

---

Built for the World is Flat Hackathon — October 2026.

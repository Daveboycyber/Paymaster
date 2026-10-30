# WIF Paymaster

**Pay gas in $WIF on Robinhood Chain.**

ERC-4337 Paymaster that lets users execute transactions (including World is Flat votes) with **zero ETH**. Gas is paid in $WIF. A portion of every payment is burned.

Built for the [World is Flat Hackathon](https://worldisflat.fun/build).

---

## Live Deployed Contracts (Robinhood Chain · 4663)

| Contract | Address |
|----------|---------|
| **WIFPaymaster** | [`0x7e0bCEFa1568Bf8ad9a20F1AbfDE5FaE47ac84dE`](https://explorer.robinhood.com/address/0x7e0bCEFa1568Bf8ad9a20F1AbfDE5FaE47ac84dE) |
| **BoundedRateProvider** | [`0x3A040be5ee7829A38943294DFC6116Bf095eF497`](https://explorer.robinhood.com/address/0x3A040be5ee7829A38943294DFC6116Bf095eF497) |
| **$WIF Token** | [`0x5173b8eA6923c2d40267890D45C46a3480954773`](https://explorer.robinhood.com/address/0x5173b8eA6923c2d40267890D45C46a3480954773) |
| **EntryPoint v0.7** | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |

---

## Why this exists

Voting with $WIF currently still requires ETH for gas. This friction contradicts the project’s ideology.  
WIF Paymaster removes it and turns $WIF into real chain utility.

**Demo line:**  
> “I voted with only $WIF. My wallet has 0 ETH.”

---

## Repository Structure (Monorepo)

```
Paymaster/
├── src/                  # Solidity contracts
│   ├── WIFPaymaster.sol
│   ├── BoundedRateProvider.sol
│   └── ...
├── test/                 # Foundry tests
├── script/               # Deployment scripts
├── frontend/             # Zero-ETH demo UI (React + Vite)
│   ├── src/
│   ├── package.json
│   └── ...
└── README.md
```

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
    ├── execute UserOp
    │
    └── postOp()  →  pulls $WIF, burns %, sends rest to treasury
```

### Safety Features

- Hard per-transaction gas cost cap
- Global daily sponsorship limit
- Bounded rate (safe for thin liquidity)
- Explicit $WIF allowance required
- Configurable premium + burn percentage
- Circuit breaker on rate provider

---

## Quick Start – Contracts

```bash
git clone https://github.com/Daveboycyber/Paymaster.git
cd Paymaster
forge install
forge test -vv
```

### Deploy

```bash
export PRIVATE_KEY=0x...
export TREASURY=0xYourTreasury
export INITIAL_WIF_PER_ETH=2000000000000000000000000

forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://rpc.mainnet.chain.robinhood.com \
  --broadcast
```

After deploy, fund the paymaster:

```bash
cast send 0x7e0bCEFa1568Bf8ad9a20F1AbfDE5FaE47ac84dE "depositToEntryPoint()" \
  --value 0.05ether \
  --rpc-url https://rpc.mainnet.chain.robinhood.com \
  --private-key $PRIVATE_KEY
```

---

## Quick Start – Frontend Demo

```bash
cd frontend
npm install
npm run dev
```

Then open the local URL. The UI demonstrates the “Vote with only $WIF” flow.

---

## Integration (for other builders)

```ts
// Using permissionless.js / Alchemy Account Kit / ZeroDev
const userOp = await smartAccount.encodeUserOp({
  // your call (vote, transfer, etc.)
  paymaster: {
    address: "0x7e0bCEFa1568Bf8ad9a20F1AbfDE5FaE47ac84dE",
  }
});

// User must approve the paymaster for $WIF first
await wif.approve("0x7e0bCEFa1568Bf8ad9a20F1AbfDE5FaE47ac84dE", MaxUint256);
```

---

## Roadmap

- [x] Deploy contracts to Robinhood Chain
- [x] Frontend demo (monorepo)
- [ ] Real UserOperation integration (Alchemy bundler)
- [ ] One-click “Enable gas payment with $WIF”
- [ ] Dashboard of $WIF collected / burned
- [ ] Production TWAP rate provider

---

Built for the World is Flat Hackathon — October 2026.

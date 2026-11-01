# Security

WIF Paymaster is an ERC-4337 (EntryPoint v0.7) paymaster that sponsors gas in ETH and charges users in $WIF.
This document covers what it trusts, what can go wrong, and how each risk is handled and tested.

**Status:** hackathon code. It has not been audited. Keep the EntryPoint deposit small.

## Reporting a vulnerability

Please open a [private security advisory](https://github.com/Daveboycyber/Paymaster/security/advisories/new)
instead of a public issue.

## Contracts in scope

| Contract | Role |
|----------|------|
| `src/WIFPaymaster.sol` | Validates UserOps, takes the $WIF fee, refunds, burns and pays the treasury |
| `src/BoundedRateProvider.sol` | WIF/ETH rate with bounds, expiry, pause and a rate-limited keeper |
| `keeper/keeper.mjs` | Off-chain bot that refreshes the rate and calls `flush()` |

## Trust model

| Actor | Can | Cannot |
|-------|-----|--------|
| **User (smart account)** | Use the paymaster while it holds enough $WIF; cap the fee with a signed `maxWif` | Get gas without paying, even if the op reverts or revokes the allowance |
| **Anyone** | Call `flush()` | Move funds anywhere except the burn and the treasury |
| **Keeper** | Call `setRate` at most every 10 minutes, moving at most 20% per update, inside the owner's bounds | Change bounds, pause, or move the rate faster |
| **Owner** | Set premium (max 50%), burn share, caps, limits, rate provider, treasury; pause the rate; manage the EntryPoint deposit and stake | Pull users' $WIF: allowances are only used inside `validatePaymasterUserOp`, which only the EntryPoint can call. `rescueWif` cannot touch the burn or treasury shares |
| **EntryPoint v0.7** | Call `validatePaymasterUserOp` and `postOp` | — (canonical `0x0000000071727De22E5E9d8BAf0edAc6f37da032`) |
| **$WIF token** | Trusted as a standard ERC-20 with `burn(uint256)` | — (fixed, `immutable`) |

Recommended: make a Safe the owner of both contracts (`OWNER` in `script/Deploy.s.sol`, then `acceptOwnership()` from
the Safe). Ownership transfers are two-step, so a typo can't lose control.

## Threats and mitigations

| # | Threat | Mitigation | Tests |
|---|--------|------------|-------|
| 1 | **Free gas through reverting ops.** The op reverts, the paymaster charges nothing, the deposit drains | The fee is pulled during validation and kept when the op reverts | `test_RevertedOpStillPays`, `test_PostOpChargesRevertedOps` |
| 2 | **Dodging the fee mid-execution.** The op revokes its allowance or spends its $WIF, so `postOp` can't collect | Prefund is pulled before execution; `postOp` only refunds | `test_RevokingAllowanceCannotDodgeFee` |
| 3 | **Bundlers rejecting or banning the paymaster (ERC-7562).** Validation uses banned opcodes or unstaked storage | No `block.timestamp` in validation: rate expiry is `validUntil`, a full daily window is `validAfter`, both enforced by the EntryPoint. Storage outside the sender is only read or written by a staked paymaster | `test_StaleRateRejectedByEntryPoint`, `test_FullDailyWindowSetsValidAfter` |
| 4 | **Abuse of the setup op.** A new account gets one sponsored op without prior approval; a fake "approve" could make the paymaster pay | Only one per account (`setupUsed`). The callData must be exactly a single `approve(paymaster, >= fee)` on $WIF with 0 value, via `execute`, Safe `executeUserOp` (CALL only, never DELEGATECALL) or ERC-7579 single-call `execute`. The account must already hold the fee in $WIF. If collection fails, `postOp` emits `SetupFeeUnpaid` and does not revert. Worst case: one op of gas per funded account | `test_SetupOp*`, `test_SetupFeeUnpaidNeverReverts`, `testFuzz_RandomCallDataIsNeverASetupOp` |
| 5 | **Draining the daily budget.** One sender uses up the global limit and blocks everyone | Per-account daily limit (default 0.05 ETH) alongside the global one (1 ETH), plus a per-op cap (0.02 ETH). Spam also costs real $WIF per op | `test_AccountDailyLimitIsPerSender`, `test_RevertWhenSingleOpAboveDailyLimits` |
| 6 | **Price manipulation.** A thin pool or bad oracle makes gas nearly free or very expensive | The rate is set off-chain from the deepest WIF/ETH pool, not read from a pool during validation. Hard min/max bounds. Keeper moves are limited to 20% per 10 minutes. The rate expires after 6h, and the owner can pause | `test_KeeperIsRateLimited`, `test_RevertWhenProviderPaused` |
| 7 | **Leaked keeper key** | Same keeper limits as #6: the price can only drift slowly while the owner pauses or replaces the keeper. Users who sign `maxWif` are never charged above it | `test_KeeperIsRateLimited`, `test_UserSignedWifLimit` |
| 8 | **Price change between quote and execution** | The optional `maxWif` in `paymasterAndData` is covered by the user's signature. `postOp` uses the rate from validation, not a fresh one | `test_UserSignedWifLimit`, `test_PostOpUsesValidatedRateAfterRateChange` |
| 9 | **Overcharging** | The charge is capped at the prefund, which is the price of `maxCost` at the validated rate | `test_PostOpChargeCappedAtPrefund`, `testFuzz_ChargeBoundedAndNoWifLeaks` |
| 10 | **Paymaster losing ETH on every op.** `actualGasCost` excludes `postOp` and the EntryPoint's unused-gas penalty | `postOpGasOverhead` (120k) covers the worst case (setup-op `postOp` ~108k), plus the 15% premium | `test_FeeCoversEthSpent` |
| 11 | **`postOp` running out of gas** would revert the user's op and consume their setup op | Clients must set the paymaster postOp gas limit to 150k (the frontend and README do). Measured: steady state ~33k, first op ~84k, setup op ~108k | `test_NewAccountOnboardsWithZeroEth` |
| 12 | **Owner taking fee revenue meant for the burn** | `rescueWif` reverts if it would dip into `pendingBurn + pendingTreasury`. `flush()` is permissionless | `test_RescueCannotTakeReservedWif`, `test_FlushBurnsSupplyAndPaysTreasury` |
| 13 | **Token without `burn()`** | `flush()` falls back to the dead address | `test_FlushFallsBackToDeadAddress` |

The integration tests (`test/WIFPaymaster.integration.t.sol`) run all of this through the real EntryPoint v0.7 with a
SimpleAccount that holds 0 ETH.

## Static analysis

[Slither](https://github.com/crytic/slither) 0.11 on `src/` (excluding informational and optimization), with
12 results, all reviewed:

| Finding | Assessment |
|---------|------------|
| `arbitrary-send-erc20` in `validatePaymasterUserOp` | By design: `from` is `userOp.sender`, who signed the op, and only the EntryPoint can call this |
| `reentrancy-benign` / `reentrancy-events` in `postOp`, `flush` | External calls only go to the immutable $WIF token. `postOp` is EntryPoint-only. `flush()` zeroes its counters before calling out |
| `unused-return` in `quoteWif` | Only the rate is needed there |
| `missing-zero-check` on `setKeeper` | Intentional: `address(0)` disables the keeper |
| `timestamp` comparisons | Only outside validation, for daily windows and keeper intervals, where minute-level drift doesn't matter |

## Known limitations

- **The rate is off-chain.** The keeper reads DexScreener. The on-chain bounds and keeper limits contain the damage of a
  bad reading, but an on-chain TWAP is the long-term fix.
- **Bundles can overshoot daily limits.** Ops in the same bundle are all validated before any `postOp`, so a limit can
  be exceeded by up to one bundle's worth.
- **Fees can't change the ETH float.** Treasury $WIF must be swapped to top up the EntryPoint deposit. On Robinhood
  Chain a sponsored op costs ~0.000006 ETH, so the float is small.
- **No timelock on owner changes.** Use a Safe as owner. A timelock is a post-hackathon item.

## Operations checklist

1. Deploy with `DEPOSIT_WEI`, `STAKE_WEI` and `KEEPER`. Set `OWNER` to a Safe, then call `acceptOwnership()` from it.
2. Verify both contracts on Blockscout.
3. Configure the keeper workflow (`.github/workflows/keeper.yml`): repo variables `RATE_PROVIDER` and `PAYMASTER`,
   secret `KEEPER_PRIVATE_KEY`.
4. Watch the EntryPoint deposit (`entryPoint.balanceOf(paymaster)`) and top it up before it runs low.

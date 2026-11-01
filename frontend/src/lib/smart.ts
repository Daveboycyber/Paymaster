import { encodeFunctionData, http, maxUint256, parseEventLogs, toFunctionSelector, type Address, type Hex } from 'viem'
import { createSmartAccountClient } from 'permissionless'
import { toSimpleSmartAccount } from 'permissionless/accounts'
import { createPimlicoClient } from 'permissionless/clients/pimlico'
import {
  BUNDLER_URL, ENTRY_POINT, PAYMASTER, PAYMASTER_POST_OP_GAS, PAYMASTER_VERIFICATION_GAS, WIF_TOKEN, robinhood,
} from '../config'
import { erc20Abi, paymasterAbi } from './abi'
import { publicClient, type Owner } from './wallet'

const entryPoint = { address: ENTRY_POINT, version: '0.7' } as const

// The WIF paymaster needs no signature or API: only its address and gas limits
const paymasterFields = {
  paymaster: PAYMASTER,
  paymasterData: '0x' as Hex,
  paymasterVerificationGasLimit: PAYMASTER_VERIFICATION_GAS,
  paymasterPostOpGasLimit: PAYMASTER_POST_OP_GAS,
}

const bundler = createPimlicoClient({ transport: http(BUNDLER_URL), entryPoint })

async function feesPerGas() {
  try {
    return (await bundler.getUserOperationGasPrice()).fast
  } catch {
    // Not a Pimlico-compatible bundler: price off the chain with headroom
    const fees = await publicClient.estimateFeesPerGas()
    return { maxFeePerGas: fees.maxFeePerGas * 2n, maxPriorityFeePerGas: fees.maxPriorityFeePerGas * 2n }
  }
}

export async function makeSmartClient(owner: Owner) {
  const account = await toSimpleSmartAccount({
    client: publicClient,
    owner: owner.kind === 'wallet' ? owner.client : owner.account,
    entryPoint,
  })
  return createSmartAccountClient({
    account,
    chain: robinhood,
    bundlerTransport: http(BUNDLER_URL),
    paymaster: {
      getPaymasterStubData: async () => ({ ...paymasterFields, isFinal: true }),
      getPaymasterData: async () => paymasterFields,
    },
    userOperation: { estimateFeesPerGas: feesPerGas },
  })
}

export type SmartClient = Awaited<ReturnType<typeof makeSmartClient>>

export type Sponsored = {
  userOpHash: Hex
  txHash: Hex
  success: boolean
  wifCharged: bigint
  wifBurned: bigint
}

async function send(client: SmartClient, call: { to: Address; data: Hex }, onSubmitted?: () => void): Promise<Sponsored> {
  const userOpHash = await client.sendUserOperation({ calls: [call] })
  onSubmitted?.()
  const receipt = await client.waitForUserOperationReceipt({ hash: userOpHash, timeout: 120_000 })
  const [event] = parseEventLogs({ abi: paymasterAbi, logs: receipt.logs, eventName: 'UserOpSponsored' })
  return {
    userOpHash,
    txHash: receipt.receipt.transactionHash,
    success: receipt.success,
    wifCharged: event?.args.wifCharged ?? 0n,
    wifBurned: event?.args.wifBurned ?? 0n,
  }
}

/** One-time setup: deploys the account and approves the paymaster. Sponsored, paid in WIF. */
export function enableWifGas(client: SmartClient, onSubmitted?: () => void) {
  const data = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [PAYMASTER, maxUint256] })
  return send(client, { to: WIF_TOKEN, data }, onSubmitted)
}

export function sendWif(client: SmartClient, to: Address, amount: bigint, onSubmitted?: () => void) {
  const data = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [to, amount] })
  return send(client, { to: WIF_TOKEN, data }, onSubmitted)
}

const KNOWN_ERRORS: [string, string][] = [
  [toFunctionSelector('InsufficientWifBalance()'), 'Not enough $WIF in your account to cover gas.'],
  [toFunctionSelector('InsufficientWifAllowance()'), 'Turn on $WIF gas first.'],
  [toFunctionSelector('ExceedsMaxGasCost()'), 'This transaction is above the paymaster’s per-transaction gas cap.'],
  [toFunctionSelector('DailyLimitExceeded()'), 'The paymaster hit its daily limit. Try again tomorrow.'],
  [toFunctionSelector('ProviderPaused()'), 'The paymaster is paused right now.'],
  ['AA32', 'The $WIF price expired. The paymaster needs a rate update, try again soon.'],
  ['AA31', 'The paymaster is out of ETH to sponsor gas.'],
  ['AA33', 'The paymaster rejected this transaction.'],
]

export function friendlyError(err: unknown): string {
  const text = String((err as { details?: string })?.details ?? '') + ' ' + String((err as Error)?.message ?? err)
  if (/user rejected|denied|4001/i.test(text)) return 'Request cancelled in your wallet.'
  for (const [needle, message] of KNOWN_ERRORS) {
    if (text.toLowerCase().includes(needle.toLowerCase().replace(/^0x/, ''))) return message
  }
  return (err as { shortMessage?: string })?.shortMessage ?? 'Something went wrong. Please try again.'
}

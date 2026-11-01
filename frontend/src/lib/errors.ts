import { toFunctionSelector } from 'viem'

const KNOWN_ERRORS: [string, string][] = [
  [toFunctionSelector('InsufficientWifBalance()'), 'Not enough $WIF in your account to cover gas.'],
  [toFunctionSelector('InsufficientWifAllowance()'), 'Turn on $WIF gas first.'],
  [toFunctionSelector('WifCostAboveUserLimit()'), 'The $WIF price moved since you signed. Please try again.'],
  [toFunctionSelector('ExceedsMaxGasCost()'), 'This transaction is above the paymaster’s per-transaction gas cap.'],
  [toFunctionSelector('DailyLimitExceeded()'), 'This transaction is above the paymaster’s daily limit.'],
  [toFunctionSelector('ProviderPaused()'), 'The paymaster is paused right now.'],
  ['AA32', 'The paymaster can’t accept this right now: its $WIF price expired or a daily limit is reached.'],
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

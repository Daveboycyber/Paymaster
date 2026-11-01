export { erc20Abi } from 'viem'

export const paymasterAbi = [
  { type: 'function', name: 'quoteWif', stateMutability: 'view', inputs: [{ name: 'ethAmount', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'setupUsed', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'rateProvider', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'burnBps', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'premiumBps', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'pendingBurn', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint128' }] },
  {
    type: 'function', name: 'totals', stateMutability: 'view', inputs: [],
    outputs: [{ name: 'ops', type: 'uint64' }, { name: 'wifCharged', type: 'uint96' }, { name: 'wifBurned', type: 'uint96' }],
  },
  {
    type: 'function', name: 'daily', stateMutability: 'view', inputs: [],
    outputs: [{ name: 'spentWei', type: 'uint128' }, { name: 'start', type: 'uint64' }],
  },
  {
    type: 'function', name: 'accountWindow', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: 'spentWei', type: 'uint128' }, { name: 'start', type: 'uint64' }],
  },
  { type: 'function', name: 'dailyLimitWei', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'accountDailyLimitWei', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    type: 'event',
    name: 'UserOpSponsored',
    inputs: [
      { name: 'sender', type: 'address', indexed: true },
      { name: 'userOpHash', type: 'bytes32', indexed: true },
      { name: 'ethCost', type: 'uint256', indexed: false },
      { name: 'wifCharged', type: 'uint256', indexed: false },
      { name: 'wifBurned', type: 'uint256', indexed: false },
    ],
  },
] as const

export const rateProviderAbi = [
  { type: 'function', name: 'isHealthy', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
] as const

export const entryPointAbi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const

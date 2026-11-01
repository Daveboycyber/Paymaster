export { erc20Abi } from 'viem'

export const paymasterAbi = [
  { type: 'function', name: 'quoteWif', stateMutability: 'view', inputs: [{ name: 'ethAmount', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'setupUsed', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'rateProvider', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'burnBps', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'premiumBps', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
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

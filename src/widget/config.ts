export const RPC_CONFIG = {
  wsProviders: [
    { name: 'publicnode-ws', url: 'wss://ethereum-rpc.publicnode.com' },
  ],
  httpProviders: [
    { name: 'publicnode-http', url: 'https://ethereum-rpc.publicnode.com' },
    { name: '0xrpc-http', url: 'https://0xrpc.io/eth' },
  ],
  timeoutMs: 12000,
  httpPollIntervalMs: 12000,
  reconnectBaseDelayMs: 2000,
  reconnectMaxDelayMs: 30000,
}

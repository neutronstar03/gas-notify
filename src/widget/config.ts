export const RPC_CONFIG = {
  staleAfterMs: 45000,
  wsProviders: [
    { name: 'publicnode-ws', url: 'wss://ethereum-rpc.publicnode.com' },
    { name: 'drpc-ws', url: 'wss://eth.drpc.org' },
  ],
  httpProviders: [
    { name: 'publicnode-http', url: 'https://ethereum-rpc.publicnode.com' },
    { name: 'drpc-http', url: 'https://eth.drpc.org' },
    { name: 'blast-http', url: 'https://eth-mainnet.public.blastapi.io' },
  ],
  timeoutMs: 12000,
  wsNoHeadTimeoutMs: 20000,
  httpPollIntervalMs: 12000,
  reconnectBaseDelayMs: 2000,
  reconnectMaxDelayMs: 30000,
}

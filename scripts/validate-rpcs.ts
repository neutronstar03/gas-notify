import type { BlockData, RpcEndpointInput } from '../legacy-shell/types'
import process from 'node:process'
import { HttpRpcClient } from '../legacy-shell/rpc/httpClient'
import { WsRpcClient } from '../legacy-shell/rpc/wsClient'
import { ensureError, formatGwei, isWsUrl, weiHexToGwei } from '../legacy-shell/utils'

const DEFILLAMA_EXTRA_RPCS_RAW = 'https://raw.githubusercontent.com/DefiLlama/chainlist/main/constants/extraRpcs.js'
const ETHEREUM_SECTION_PATTERN = /1:\s*\{[\s\S]*?rpcs:\s*\[(.*?)\]\s*,\s*privacyData/s
const RPC_ENTRY_PATTERN = /url:\s*"([^"]+)"|"(https?:[^"\s]+|wss?:[^"\s]+)"/g
const TRAILING_COMMA_PATTERN = /,$/

interface ValidationResult {
  name: string
  url: string
  category: 'ws_confirmed' | 'http_confirmed' | 'rejected'
  details: string
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2))
  const candidates = new Map<string, RpcEndpointInput>()

  if (!args.has('--skip-defillama')) {
    for (const rpc of await loadDefiLlamaCandidates()) {
      candidates.set(rpc.url, rpc)
    }
  }

  const envList = process.env.GAS_NOTIFY_RPC_LIST?.split(',').map(url => url.trim()).filter(Boolean) ?? []
  for (const url of envList) {
    candidates.set(url, { url })
  }

  if (candidates.size === 0) {
    [
      { name: 'publicnode-ws', url: 'wss://ethereum-rpc.publicnode.com' },
      { name: '0xrpc-ws', url: 'wss://0xrpc.io/eth' },
      { name: 'publicnode-http', url: 'https://ethereum-rpc.publicnode.com' },
      { name: '0xrpc-http', url: 'https://0xrpc.io/eth' },
    ].forEach(rpc => candidates.set(rpc.url, rpc))
  }

  const results: ValidationResult[] = []
  for (const candidate of candidates.values()) {
    results.push(isWsUrl(candidate.url) ? await validateWs(candidate) : await validateHttp(candidate))
  }

  console.log(JSON.stringify(groupResults(results), null, 2))
}

async function loadDefiLlamaCandidates(): Promise<RpcEndpointInput[]> {
  const text = await fetch(DEFILLAMA_EXTRA_RPCS_RAW, { signal: AbortSignal.timeout(15000) }).then(response => response.text())
  const ethereumSection = text.match(ETHEREUM_SECTION_PATTERN)
  if (!ethereumSection) {
    return []
  }

  const entries = [...ethereumSection[1].matchAll(RPC_ENTRY_PATTERN)]
  const urls = new Set<string>()
  for (const entry of entries) {
    const url = entry[1] ?? entry[2]
    if (url) {
      urls.add(url.replace(TRAILING_COMMA_PATTERN, ''))
    }
  }

  return Array.from(urls, (url, index) => ({ name: `defillama-${index + 1}`, url }))
}

async function validateWs(candidate: RpcEndpointInput): Promise<ValidationResult> {
  const client = new WsRpcClient(candidate.url, 10000)
  try {
    await client.connect()
    await client.subscribeNewHeads(async () => undefined)
    const block = await client.getBlockByNumber('latest')
    return confirmed(candidate, 'ws_confirmed', block)
  }
  catch (error) {
    return rejected(candidate, ensureError(error).message)
  }
  finally {
    client.close()
  }
}

async function validateHttp(candidate: RpcEndpointInput): Promise<ValidationResult> {
  const client = new HttpRpcClient(candidate.url, 10000)
  try {
    const block = await client.getLatestBlock()
    return confirmed(candidate, 'http_confirmed', block)
  }
  catch (error) {
    return rejected(candidate, ensureError(error).message)
  }
}

function confirmed(candidate: RpcEndpointInput, category: ValidationResult['category'], block: BlockData): ValidationResult {
  return {
    name: candidate.name ?? candidate.url,
    url: candidate.url,
    category,
    details: `ok block=${block.number} baseFeeGwei=${formatGwei(weiHexToGwei(block.baseFeePerGas!))}`,
  }
}

function rejected(candidate: RpcEndpointInput, details: string): ValidationResult {
  return {
    name: candidate.name ?? candidate.url,
    url: candidate.url,
    category: 'rejected',
    details,
  }
}

function groupResults(results: ValidationResult[]): Record<string, ValidationResult[]> {
  return {
    ws_confirmed: results.filter(result => result.category === 'ws_confirmed'),
    http_confirmed: results.filter(result => result.category === 'http_confirmed'),
    rejected: results.filter(result => result.category === 'rejected'),
  }
}

void main()

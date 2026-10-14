import type { FeeEstimate } from './feeEstimator'
import type { ConnectionMode, Observation } from './types'
import { RPC_CONFIG } from './config'
import { formatAge, formatWeiGwei } from './format'
import { mustGetElement } from './utils'

const MAX_ROWS = 4

export class WidgetView {
  private readonly rowsEl = mustGetElement<HTMLElement>('gas-notify-rows')
  private readonly statusEl = mustGetElement<HTMLElement>('gas-notify-status')
  private readonly dotEl = mustGetElement<HTMLElement>('gas-notify-dot')
  private readonly footerEl = mustGetElement<HTMLElement>('gas-notify-footer')
  private readonly suggestionEl = mustGetElement<HTMLButtonElement>('gas-notify-suggestion')
  private readonly valueEl = mustGetElement<HTMLElement>('gas-notify-suggestion-value')
  private readonly noteEl = mustGetElement<HTMLElement>('gas-notify-suggestion-note')
  private readonly trendEl = mustGetElement<HTMLElement>('gas-notify-trend')
  private recent: Observation[] = []
  private estimate: FeeEstimate | null = null
  private status = 'Connecting…'
  private mode: ConnectionMode = 'down'
  private copyMessage = ''
  private copyUntil = 0

  constructor() {
    this.suggestionEl.addEventListener('click', async () => {
      if (!this.canCopy())
        return
      const value = formatWeiGwei(this.estimate!.feeWei, true)
      try {
        await navigator.clipboard.writeText(value)
        this.copyMessage = 'Copied'
      }
      catch {
        this.copyMessage = 'Copy failed — try again'
      }
      this.copyUntil = Date.now() + 2000
      this.render()
    })
  }

  setStatus(message: string, mode: ConnectionMode): void {
    this.status = message
    this.mode = mode
    this.render()
  }

  setEstimate(estimate: FeeEstimate): void {
    if (estimate.blockNumber !== this.recent[0]?.blockNumber)
      return
    if (this.estimate?.blockNumber === estimate.blockNumber && !this.estimate.provisional && estimate.provisional)
      return
    this.estimate = estimate
    this.render()
  }

  setObservation(observation: Observation): void {
    this.recent = [observation, ...this.recent.filter(item => item.blockNumber !== observation.blockNumber)].slice(0, MAX_ROWS)
    this.rowsEl.replaceChildren()
    for (let index = 0; index < MAX_ROWS; index++) {
      const item = this.recent[index]
      const row = document.createElement('article')
      row.className = `gas-notify-widget__row${index === 0 && item ? ' gas-notify-widget__row--latest' : ''}`
      const block = document.createElement('span')
      block.className = 'gas-notify-widget__block'
      block.textContent = item ? `x${item.blockNumber.toString().slice(-4).padStart(4, '0')}` : '—'
      block.title = item ? `Block ${item.blockNumber}` : 'Waiting for block'
      const fee = document.createElement('strong')
      fee.className = 'gas-notify-widget__fee'
      fee.textContent = item ? `${formatWeiGwei(item.baseFeeWei)} gwei` : '— gwei'
      const age = document.createElement('span')
      age.className = 'gas-notify-widget__age'
      row.append(block, fee, age)
      this.rowsEl.append(row)
    }
    const [latest, previous] = this.recent
    if (latest && previous && previous.baseFeeWei > 0n) {
      const change = Number((latest.baseFeeWei - previous.baseFeeWei) * 1000n / previous.baseFeeWei) / 10
      this.trendEl.textContent = `${change > 0 ? '+' : ''}${change.toFixed(1)}%`
      this.trendEl.title = 'Base fee change from previous observed block'
    }
    else {
      this.trendEl.textContent = ''
    }
    this.render()
  }

  private isStale(): boolean {
    const latest = this.recent[0]
    return !!latest && Date.now() - latest.timestampMs > RPC_CONFIG.staleAfterMs
  }

  private canCopy(): boolean {
    return !!this.estimate && !this.isStale() && this.estimate.blockNumber === this.recent[0]?.blockNumber
  }

  render(): void {
    const latest = this.recent[0]
    const stale = this.isStale()
    this.rowsEl.dataset.stale = String(stale)
    this.statusEl.textContent = stale ? 'Data stale · reconnecting' : this.status
    this.dotEl.dataset.mode = stale ? 'down' : this.mode
    this.rowsEl.querySelectorAll<HTMLElement>('.gas-notify-widget__age').forEach((el, index) => {
      el.textContent = this.recent[index] ? formatAge(this.recent[index].timestampMs) : '—'
    })
    this.footerEl.textContent = latest
      ? `Received ${formatAge(latest.receivedAtMs)} ago · ${latest.providerName}`
      : 'Waiting for first block…'
    const available = this.canCopy()
    this.suggestionEl.disabled = !available
    this.valueEl.textContent = available ? `${formatWeiGwei(this.estimate!.feeWei, true)} gwei` : stale ? 'Unavailable' : 'Connecting…'
    this.noteEl.textContent = available
      ? Date.now() < this.copyUntil ? this.copyMessage : this.estimate!.provisional ? 'Provisional · click to copy' : 'Click to copy for Rabby'
      : stale ? 'Waiting for fresh data' : latest ? 'Waiting for fee estimate' : 'Waiting for network'
  }
}

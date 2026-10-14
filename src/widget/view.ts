import type { FeeEstimate } from './feeEstimator'
import type { ConnectionMode, Observation } from './types'
import { RPC_CONFIG } from './config'
import { formatAge, formatWeiGwei } from './format'
import { mustGetElement } from './utils'

const MAX_ROWS = 50

export class WidgetView {
  private readonly rowsEl = mustGetElement<HTMLElement>('gas-notify-rows')
  private readonly statusEl = mustGetElement<HTMLElement>('gas-notify-status')
  private readonly dotEl = mustGetElement<HTMLElement>('gas-notify-dot')
  private readonly footerEl = mustGetElement<HTMLElement>('gas-notify-footer')
  private readonly suggestionEl = mustGetElement<HTMLButtonElement>('gas-notify-suggestion')
  private readonly valueEl = mustGetElement<HTMLElement>('gas-notify-suggestion-value')
  private readonly noteEl = mustGetElement<HTMLElement>('gas-notify-suggestion-note')
  private readonly feedbackEl = mustGetElement<HTMLElement>('gas-notify-copy-feedback')
  private recent: Observation[] = []
  private estimate: FeeEstimate | null = null
  private status = 'Connecting…'
  private mode: ConnectionMode = 'down'
  private copyMessage = ''
  private copyUntil = 0
  private visibleRows = 5

  constructor() {
    window.addEventListener('resize', () => this.render())
    this.suggestionEl.addEventListener('click', async () => {
      if (!this.canCopy())
        return
      this.feedbackEl.textContent = ''
      const value = formatWeiGwei(this.estimate!.feeWei, true)
      try {
        await navigator.clipboard.writeText(value)
        this.copyMessage = 'Copied'
      }
      catch {
        this.copyMessage = 'Copy failed — try again'
      }
      this.copyUntil = Date.now() + 2000
      this.feedbackEl.textContent = this.copyMessage
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
    this.renderRows()
    this.render()
  }

  private renderRows(): void {
    this.rowsEl.replaceChildren()
    for (let index = 0; index < this.visibleRows; index++) {
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
      age.textContent = item ? formatAge(item.timestampMs) : '—'
      row.append(block, fee, age)
      this.rowsEl.append(row)
    }
  }

  private fitRows(): void {
    if (!this.rowsEl.firstElementChild)
      this.renderRows()
    const rowHeight = this.rowsEl.firstElementChild!.getBoundingClientRect().height
    if (rowHeight <= 0)
      return
    const rowsStyle = getComputedStyle(this.rowsEl)
    const gap = Number.parseFloat(rowsStyle.rowGap) || 0
    const available = window.innerHeight - this.rowsEl.getBoundingClientRect().top
      - this.footerEl.getBoundingClientRect().height
      - (Number.parseFloat(getComputedStyle(document.body).paddingBottom) || 0)
      - (Number.parseFloat(rowsStyle.paddingBottom) || 0) - 2
    const capacity = Math.max(1, Math.min(MAX_ROWS, Math.floor((available + gap) / (rowHeight + gap))))
    const count = Math.min(capacity, Math.max(5, this.recent.length))
    if (count !== this.visibleRows) {
      this.visibleRows = count
      this.renderRows()
    }
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
    this.suggestionEl.dataset.copied = String(available && Date.now() < this.copyUntil && this.copyMessage === 'Copied')
    this.valueEl.textContent = available ? `${formatWeiGwei(this.estimate!.feeWei, true)} gwei` : stale ? 'Unavailable' : 'Connecting…'
    this.suggestionEl.setAttribute('aria-label', available ? `Copy forecast: ${this.valueEl.textContent}` : `Forecast: ${this.valueEl.textContent}`)
    this.noteEl.textContent = available
      ? Date.now() < this.copyUntil && this.copyMessage !== 'Copied' ? this.copyMessage : this.estimate!.provisional ? 'Provisional' : ''
      : stale ? 'Waiting for fresh data' : latest ? 'Waiting for fee estimate' : 'Waiting for network'
    this.noteEl.hidden = !this.noteEl.textContent
    this.fitRows()
  }
}

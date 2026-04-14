import type { ConnectionMode, Observation } from './types'
import { formatAge, formatGwei } from './format'
import { mustGetElement } from './utils'

const MAX_ROWS = 4

export class WidgetView {
  private readonly rowsEl = mustGetElement<HTMLElement>('gas-notify-rows')
  private readonly statusEl = mustGetElement<HTMLElement>('gas-notify-status')
  private readonly dotEl = mustGetElement<HTMLElement>('gas-notify-dot')
  private readonly footerEl = mustGetElement<HTMLElement>('gas-notify-footer')
  private recent: Observation[] = []

  setStatus(message: string, mode: ConnectionMode): void {
    this.statusEl.textContent = message
    this.dotEl.dataset.mode = mode
  }

  setObservation(observation: Observation): void {
    this.recent = [observation, ...this.recent.filter(item => item.blockNumber !== observation.blockNumber)].slice(0, MAX_ROWS)
    this.render()
  }

  render(): void {
    const placeholders = MAX_ROWS - this.recent.length

    // Render real data rows
    const realRows = this.recent.map((item, index) => `
      <article class="gas-notify-widget__row${index === 0 ? ' gas-notify-widget__row--latest' : ''}">
        <span class="gas-notify-widget__block">x${item.blockNumber.toString().slice(-4).padStart(4, '0')}</span>
        <strong class="gas-notify-widget__fee">${formatGwei(item.baseFeeGwei)} gwei</strong>
        <span class="gas-notify-widget__age">${formatAge(item.timestampMs)}</span>
      </article>
    `).join('')

    // Render placeholder rows with shimmer effect
    const placeholderRows = Array.from({ length: placeholders }).fill(`
      <article class="gas-notify-widget__row gas-notify-widget__row--placeholder">
        <span class="gas-notify-widget__block">────</span>
        <strong class="gas-notify-widget__fee">── gwei</strong>
        <span class="gas-notify-widget__age">──</span>
      </article>
    `).join('')

    this.rowsEl.innerHTML = realRows + placeholderRows
    this.renderFooter()
  }

  renderFooter(): void {
    const latest = this.recent[0]
    this.footerEl.textContent = latest
      ? `Last update ${formatAge(latest.timestampMs)} · ${latest.providerName}`
      : 'Waiting for first block…'
  }
}

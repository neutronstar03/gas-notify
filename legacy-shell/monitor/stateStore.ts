import type { PersistedState } from '../types'
import fs from 'node:fs'
import path from 'node:path'

const EMPTY_STATE: PersistedState = { thresholdState: {} }

export class StateStore {
  constructor(private readonly filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
  }

  load(): PersistedState {
    if (!fs.existsSync(this.filePath)) {
      return structuredClone(EMPTY_STATE)
    }

    const rawState = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as PersistedState & { thresholds?: PersistedState['thresholdState'] }

    return {
      ...EMPTY_STATE,
      ...rawState,
      thresholdState: rawState.thresholdState ?? rawState.thresholds ?? {},
    }
  }

  save(state: PersistedState): void {
    fs.writeFileSync(this.filePath, JSON.stringify(state, null, 2), 'utf8')
  }
}

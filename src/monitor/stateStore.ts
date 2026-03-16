import type { PersistedState } from '../types'
import fs from 'node:fs'
import path from 'node:path'

const EMPTY_STATE: PersistedState = { thresholds: {} }

export class StateStore {
  constructor(private readonly filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
  }

  load(): PersistedState {
    if (!fs.existsSync(this.filePath)) {
      return structuredClone(EMPTY_STATE)
    }

    return {
      ...EMPTY_STATE,
      ...(JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as PersistedState),
    }
  }

  save(state: PersistedState): void {
    fs.writeFileSync(this.filePath, JSON.stringify(state, null, 2), 'utf8')
  }
}

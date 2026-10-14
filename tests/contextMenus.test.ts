import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'

const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome')
const installedListeners: Array<() => Promise<void>> = []
const startupListeners: Array<() => Promise<void>> = []
const items = new Map<string, chrome.contextMenus.CreateProperties>()
let settings: Record<string, string> = {}
let removeCount = 0
let duplicateCount = 0

beforeAll(async () => {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      runtime: {
        onInstalled: { addListener: (listener: () => Promise<void>) => installedListeners.push(listener) },
        onStartup: { addListener: (listener: () => Promise<void>) => startupListeners.push(listener) },
      },
      storage: { local: { get: async () => settings } },
      contextMenus: {
        onClicked: { addListener: () => {} },
        removeAll: async () => {
          removeCount++
          items.clear()
        },
        create: (properties: chrome.contextMenus.CreateProperties, callback: () => void) => {
          const id = properties.id!
          if (items.has(id)) {
            duplicateCount++
            throw new Error(`Duplicate menu ID: ${id}`)
          }
          if (properties.parentId && !items.has(String(properties.parentId))) {
            throw new Error(`Missing parent: ${properties.parentId}`)
          }
          items.set(id, properties)
          queueMicrotask(callback)
          return id
        },
      },
      action: { onClicked: { addListener: () => {} } },
      windows: { onRemoved: { addListener: () => {} } },
    },
  })
  await import('../src/background')
})

beforeEach(() => {
  settings = { widgetColor: 'pearl', widgetSize: 'large' }
  removeCount = 0
  duplicateCount = 0
  items.clear()
})

afterAll(() => {
  if (originalChrome) {
    Object.defineProperty(globalThis, 'chrome', originalChrome)
  }
  else {
    Reflect.deleteProperty(globalThis, 'chrome')
  }
})

describe('context menu lifecycle', () => {
  test('rebuilds persisted menus on startup and preserves selected settings', async () => {
    await installedListeners[0]()
    await startupListeners[0]()

    expect(removeCount).toBe(2)
    expect(duplicateCount).toBe(0)
    expect(items.size).toBe(9)
    expect(items.get('color-pearl')?.checked).toBe(true)
    expect(items.get('size-large')?.checked).toBe(true)
    expect(items.get('color-green')?.checked).toBe(false)
  })

  test('coalesces overlapping install and startup events', async () => {
    await Promise.all([installedListeners[0](), startupListeners[0]()])

    expect(removeCount).toBe(1)
    expect(duplicateCount).toBe(0)
    expect(items.size).toBe(9)
  })

  test('uses defaults for unknown saved settings', async () => {
    settings = { widgetColor: 'unknown', widgetSize: 'unknown' }
    await installedListeners[0]()

    expect(items.get('color-green')?.checked).toBe(true)
    expect(items.get('size-normal')?.checked).toBe(true)
  })
})

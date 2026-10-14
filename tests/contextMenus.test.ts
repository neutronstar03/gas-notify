import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'

const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome')
const items = new Map<string, chrome.contextMenus.CreateProperties>()
let settings: Record<string, string> = {}
let removeCount = 0
let duplicateCount = 0

interface ListenerRegistry {
  installed: Array<() => unknown>
  startup: Array<() => unknown>
  menuClicked: Array<(info: chrome.contextMenus.OnClickData) => unknown>
  actionClicked: Array<() => unknown>
  windowRemoved: Array<(windowId: number) => unknown>
  boundsChanged: Array<(window: chrome.windows.Window) => unknown>
}

/**
 * The background module registers its listeners exactly once per process, so the
 * arrays live on globalThis and are shared with the other background test file.
 */
const registryKey = '__gasNotifyListenerRegistry'

function listeners(): ListenerRegistry {
  const holder = globalThis as unknown as Record<string, ListenerRegistry | undefined>
  const existing = holder[registryKey]
  if (existing) {
    return existing
  }

  const created: ListenerRegistry = {
    installed: [],
    startup: [],
    menuClicked: [],
    actionClicked: [],
    windowRemoved: [],
    boundsChanged: [],
  }
  holder[registryKey] = created
  return created
}

function createChromeMock() {
  return {
    runtime: {
      onInstalled: { addListener: (listener: () => unknown) => listeners().installed.push(listener) },
      onStartup: { addListener: (listener: () => unknown) => listeners().startup.push(listener) },
      getURL: (path: string) => `chrome-extension://test/${path}`,
      lastError: undefined,
    },
    storage: {
      local: {
        get: async () => settings,
        set: async (values: Record<string, unknown>) => {
          settings = { ...settings, ...values } as Record<string, string>
        },
        remove: async (key: string) => {
          delete settings[key]
        },
      },
    },
    contextMenus: {
      onClicked: { addListener: (listener: (info: chrome.contextMenus.OnClickData) => unknown) => listeners().menuClicked.push(listener) },
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
    action: {
      onClicked: { addListener: (listener: () => unknown) => listeners().actionClicked.push(listener) },
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {},
      setBadgeTextColor: () => {},
    },
    windows: {
      onRemoved: { addListener: (listener: (windowId: number) => unknown) => listeners().windowRemoved.push(listener) },
      onBoundsChanged: { addListener: (listener: (window: chrome.windows.Window) => unknown) => listeners().boundsChanged.push(listener) },
      getAll: async () => [],
      get: async () => {
        throw new Error('No window with that id')
      },
      create: async () => undefined,
      update: async () => undefined,
      remove: async () => undefined,
    },
    system: { display: { getInfo: async () => [] } },
  }
}

beforeAll(async () => {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: createChromeMock(),
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
    await listeners().installed[0]()
    await listeners().startup[0]()

    expect(removeCount).toBe(2)
    expect(duplicateCount).toBe(0)
    expect(items.size).toBe(9)
    expect(items.get('color-pearl')?.checked).toBe(true)
    expect(items.get('size-large')?.checked).toBe(true)
    expect(items.get('color-green')?.checked).toBe(false)
  })

  test('coalesces overlapping install and startup events', async () => {
    await Promise.all([listeners().installed[0](), listeners().startup[0]()])

    expect(removeCount).toBe(1)
    expect(duplicateCount).toBe(0)
    expect(items.size).toBe(9)
  })

  test('uses defaults for unknown saved settings', async () => {
    settings = { widgetColor: 'unknown', widgetSize: 'unknown' }
    await listeners().installed[0]()

    expect(items.get('color-green')?.checked).toBe(true)
    expect(items.get('size-normal')?.checked).toBe(true)
  })
})

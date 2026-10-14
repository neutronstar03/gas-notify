import type { WorkArea } from '../src/background'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import {
  COLOR_OPTIONS,
  parseWidgetSettings,
  SIZE_OPTIONS,
  WIDGET_COLOR_KEY,
  WIDGET_SIZE_KEY,
} from '../src/widget/settings'

const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome')
const originalDateNow = Date.now

interface ListenerRegistry {
  installed: Array<() => unknown>
  startup: Array<() => unknown>
  menuClicked: Array<(info: chrome.contextMenus.OnClickData) => unknown>
  actionClicked: Array<() => unknown>
  windowRemoved: Array<(windowId: number) => unknown>
  boundsChanged: Array<(window: chrome.windows.Window) => unknown>
}

/** Shared with tests/contextMenus.test.ts: the module registers listeners once. */
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

interface MockTab {
  id: number
  url: string
}

interface MockWindow {
  id: number
  left?: number
  top?: number
  width?: number
  height?: number
  tabs: MockTab[]
}

let openWindows: MockWindow[] = []
let stored: Record<string, unknown> = {}
let storageWrites: Array<Record<string, unknown>> = []
let createCalls: chrome.windows.CreateData[] = []
let updateCalls: Array<{ windowId: number, details: chrome.windows.UpdateInfo }> = []
let removeCalls: number[] = []
let badgeText = ''
let badgeColor = ''
let badgeTextColor = ''
let displays: Array<{ workArea: { left: number, top: number, width: number, height: number } }> = []
let displayThrows = false
let nextWindowId = 1
let nextTabId = 1

function cloneWindow(window: MockWindow): MockWindow {
  return { ...window, tabs: window.tabs.map(tab => ({ ...tab })) }
}

function resizeWindow(window: MockWindow, details: chrome.windows.UpdateInfo): void {
  window.left = details.left ?? window.left
  window.top = details.top ?? window.top
  window.width = details.width ?? window.width
  window.height = details.height ?? window.height
}

function pickStored(keys: unknown): Record<string, unknown> {
  if (typeof keys === 'string') {
    return keys in stored ? { [keys]: stored[keys] } : {}
  }
  if (Array.isArray(keys)) {
    const picked: Record<string, unknown> = {}
    for (const key of keys) {
      if (typeof key === 'string' && key in stored) {
        picked[key] = stored[key]
      }
    }
    return picked
  }
  return { ...stored }
}

function createChromeMock() {
  return {
    runtime: {
      onInstalled: { addListener: (listener: () => unknown) => listeners().installed.push(listener) },
      onStartup: { addListener: (listener: () => unknown) => listeners().startup.push(listener) },
      getURL: (path: string) => `chrome-extension://gas-notify/${path}`,
      lastError: undefined,
    },
    storage: {
      local: {
        get: async (keys?: unknown) => pickStored(keys),
        set: async (values: Record<string, unknown>) => {
          storageWrites.push(values)
          Object.assign(stored, values)
        },
        remove: async (key: string) => {
          delete stored[key]
        },
      },
    },
    contextMenus: {
      onClicked: { addListener: (listener: (info: chrome.contextMenus.OnClickData) => unknown) => listeners().menuClicked.push(listener) },
      removeAll: async () => {},
      create: (_properties: chrome.contextMenus.CreateProperties, callback?: () => void) => callback?.(),
    },
    action: {
      onClicked: { addListener: (listener: () => unknown) => listeners().actionClicked.push(listener) },
      setBadgeText: async (details: { text: string }) => {
        badgeText = details.text
      },
      setBadgeBackgroundColor: async (details: { color: string }) => {
        badgeColor = details.color
      },
      setBadgeTextColor: (details: { color: string }) => {
        badgeTextColor = details.color
      },
    },
    windows: {
      onRemoved: { addListener: (listener: (windowId: number) => unknown) => listeners().windowRemoved.push(listener) },
      onBoundsChanged: { addListener: (listener: (window: chrome.windows.Window) => unknown) => listeners().boundsChanged.push(listener) },
      getAll: async () => openWindows.map(cloneWindow),
      get: async (windowId: number) => {
        const found = openWindows.find(window => window.id === windowId)
        if (!found) {
          throw new Error(`No window with id ${windowId}`)
        }
        return cloneWindow(found)
      },
      create: async (data: chrome.windows.CreateData) => {
        createCalls.push(data)
        const created: MockWindow = {
          id: nextWindowId++,
          left: data.left,
          top: data.top,
          width: data.width,
          height: data.height,
          tabs: data.url ? [{ id: nextTabId++, url: data.url }] : [],
        }
        openWindows.push(created)
        return cloneWindow(created)
      },
      update: async (windowId: number, details: chrome.windows.UpdateInfo) => {
        updateCalls.push({ windowId, details })
        const found = openWindows.find(window => window.id === windowId)
        if (!found) {
          throw new Error(`No window with id ${windowId}`)
        }
        resizeWindow(found, details)
        return cloneWindow(found)
      },
      remove: async (windowId: number) => {
        removeCalls.push(windowId)
        openWindows = openWindows.filter(window => window.id !== windowId)
      },
    },
    system: {
      display: {
        getInfo: async () => {
          if (displayThrows) {
            throw new Error('system.display unavailable')
          }
          return displays
        },
      },
    },
  }
}

let background: typeof import('../src/background')

beforeAll(async () => {
  Object.defineProperty(globalThis, 'chrome', { configurable: true, value: createChromeMock() })
  background = await import('../src/background')
})

let clock = 1_700_000_000_000

beforeEach(() => {
  openWindows = []
  stored = {}
  storageWrites = []
  createCalls = []
  updateCalls = []
  removeCalls = []
  badgeText = ''
  badgeColor = ''
  badgeTextColor = ''
  displays = [{ workArea: { left: 0, top: 0, width: 1920, height: 1080 } }]
  displayThrows = false
  nextWindowId = 1
  nextTabId = 1
  clock += 10_000

  Date.now = () => clock
  Object.defineProperty(globalThis, 'chrome', { configurable: true, value: createChromeMock() })
})

afterEach(() => {
  Date.now = originalDateNow
})

afterAll(() => {
  if (originalChrome) {
    Object.defineProperty(globalThis, 'chrome', originalChrome)
  }
  else {
    Reflect.deleteProperty(globalThis, 'chrome')
  }
})

async function settle(): Promise<void> {
  for (let index = 0; index < 6; index++) {
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

function clickAction(): void {
  listeners().actionClicked[0]()
}

function fireBoundsChanged(window: Partial<chrome.windows.Window> & { id: number }): void {
  listeners().boundsChanged[0](window as chrome.windows.Window)
}

function clickMenu(menuItemId: string): void {
  listeners().menuClicked[0]({ menuItemId } as chrome.contextMenus.OnClickData)
}

/** Every position value actually handed to chrome.storage.local.set. */
function positionWrites(): unknown[] {
  return storageWrites
    .filter(entry => 'widgetPosition' in entry)
    .map(entry => entry.widgetPosition)
}

describe('widget window bounds', () => {
  test('opens a single window when two clicks overlap', async () => {
    clickAction()
    clock += 400
    clickAction()
    await settle()

    expect(createCalls).toHaveLength(1)
    expect(updateCalls.some(call => call.details.focused === true)).toBe(true)
  })

  test('closes the widget when the second click arrives inside the double-click window', async () => {
    clickAction()
    await settle()
    expect(createCalls).toHaveLength(1)

    clock += 100
    clickAction()
    await settle()

    expect(removeCalls).toEqual([1])
    expect(openWindows).toHaveLength(0)
    expect(badgeText).toBe('')
  })

  test('leaves a moved window alone when the size already matches', async () => {
    clickAction()
    await settle()
    updateCalls = []

    fireBoundsChanged({ id: 1, left: 120, top: 80, width: 280, height: 350 })
    await settle()

    expect(updateCalls).toHaveLength(0)
  })

  test('applies the current settings size instead of the size captured at open time', async () => {
    clickAction()
    await settle()
    updateCalls = []

    // The user changed the size while the window was already open.
    stored[WIDGET_SIZE_KEY] = 'large'
    fireBoundsChanged({ id: 1, left: 300, top: 200, width: 600, height: 700 })
    await settle()

    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].windowId).toBe(1)
    expect(updateCalls[0].details.width).toBe(400)
    expect(updateCalls[0].details.height).toBe(550)
    expect(updateCalls[0].details.left).toBe(300)
    expect(updateCalls[0].details.top).toBe(200)
  })

  test('clamps a resized window back into the display work area', async () => {
    displays = [{ workArea: { left: 0, top: 0, width: 800, height: 600 } }]
    clickAction()
    await settle()
    updateCalls = []

    stored[WIDGET_SIZE_KEY] = 'large'
    fireBoundsChanged({ id: 1, left: 780, top: 580, width: 600, height: 700 })
    await settle()

    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].details.width).toBe(400)
    expect(updateCalls[0].details.height).toBe(550)
    expect(updateCalls[0].details.left).toBe(400)
    expect(updateCalls[0].details.top).toBe(50)
  })

  test('keeps negative coordinates on a display left of the primary one', async () => {
    displays = [
      { workArea: { left: 0, top: 0, width: 1920, height: 1080 } },
      { workArea: { left: -1280, top: 0, width: 1280, height: 1024 } },
    ]
    clickAction()
    await settle()
    updateCalls = []

    stored[WIDGET_SIZE_KEY] = 'large'
    fireBoundsChanged({ id: 1, left: -1200, top: 100, width: 500, height: 600 })
    await settle()

    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].details.left).toBe(-1200)
    expect(updateCalls[0].details.top).toBe(100)
  })

  test('ignores bounds changes for windows that are not the widget', async () => {
    clickAction()
    await settle()
    updateCalls = []

    fireBoundsChanged({ id: 99, left: 10, top: 10, width: 900, height: 900 })
    await settle()

    expect(updateCalls).toHaveLength(0)
  })

  test('skips clamping when the display API is unavailable', async () => {
    displays = []
    displayThrows = true
    clickAction()
    await settle()
    updateCalls = []

    stored[WIDGET_SIZE_KEY] = 'large'
    fireBoundsChanged({ id: 1, left: 300, top: 200, width: 600, height: 700 })
    await settle()

    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].details.width).toBe(400)
    expect(updateCalls[0].details.height).toBe(550)
    expect(updateCalls[0].details.left).toBeUndefined()
    expect(updateCalls[0].details.top).toBeUndefined()
  })
})

describe('widget window position', () => {
  test('reopens the widget where it was last moved', async () => {
    displays = [
      { workArea: { left: 0, top: 0, width: 1920, height: 1080 } },
      { workArea: { left: -1280, top: 0, width: 1280, height: 1024 } },
    ]
    clickAction()
    await settle()

    fireBoundsChanged({ id: 1, left: -1100, top: 60, width: 280, height: 350 })
    await settle()
    updateCalls = []
    expect(stored.widgetPosition).toEqual({ left: -1100, top: 60 })

    clock += 100
    clickAction()
    await settle()
    expect(removeCalls).toHaveLength(1)

    clock += 2_000
    clickAction()
    await settle()

    expect(createCalls).toHaveLength(2)
    expect(createCalls[1].left).toBe(-1100)
    expect(createCalls[1].top).toBe(60)
    expect(createCalls[1].width).toBe(280)
    expect(createCalls[1].height).toBe(350)
  })

  test('pulls an off-screen saved position back onto a display', async () => {
    stored.widgetPosition = { left: 5_000, top: 5_000 }

    clickAction()
    await settle()

    expect(createCalls).toHaveLength(1)
    expect(createCalls[0].left).toBe(1_640)
    expect(createCalls[0].top).toBe(730)
    // The clamped spot replaces the unreachable one on disk.
    expect(stored.widgetPosition).toEqual({ left: 1_640, top: 730 })
  })

  test('opens at the default spot when the saved position is not usable', async () => {
    stored.widgetPosition = { left: 'nope', top: null }

    clickAction()
    await settle()

    expect(createCalls).toHaveLength(1)
    expect(createCalls[0].left).toBeUndefined()
    expect(createCalls[0].top).toBeUndefined()
  })
})

describe('widget position persistence', () => {
  test('writes the position once and skips unchanged repeats', async () => {
    clickAction()
    await settle()

    fireBoundsChanged({ id: 1, left: 120, top: 80, width: 280, height: 350 })
    await settle()
    expect(positionWrites()).toEqual([{ left: 120, top: 80 }])

    fireBoundsChanged({ id: 1, left: 120, top: 80, width: 280, height: 350 })
    await settle()
    expect(positionWrites()).toEqual([{ left: 120, top: 80 }])
  })

  test('coalesces a burst of moves into the latest position', async () => {
    clickAction()
    await settle()

    fireBoundsChanged({ id: 1, left: 10, top: 10, width: 280, height: 350 })
    fireBoundsChanged({ id: 1, left: 200, top: 150, width: 280, height: 350 })
    fireBoundsChanged({ id: 1, left: 400, top: 300, width: 280, height: 350 })
    await settle()

    expect(positionWrites()).toEqual([{ left: 400, top: 300 }])
    expect(stored.widgetPosition).toEqual({ left: 400, top: 300 })
  })
})

describe('parseWidgetPosition', () => {
  test('accepts only finite coordinate pairs', () => {
    expect(background.parseWidgetPosition({ left: -100, top: 20 })).toEqual({ left: -100, top: 20 })
    expect(background.parseWidgetPosition({ left: 10 })).toBeNull()
    expect(background.parseWidgetPosition({ left: '10', top: 20 })).toBeNull()
    expect(background.parseWidgetPosition({ left: Number.POSITIVE_INFINITY, top: 20 })).toBeNull()
    expect(background.parseWidgetPosition(null)).toBeNull()
  })
})

describe('badge', () => {
  test('repaints the badge with the new accent and a dark glyph', async () => {
    clickAction()
    await settle()

    expect(badgeText).toBe('●')
    expect(badgeColor).toBe('#7cffaf')
    expect(badgeTextColor).toBe('#101010')

    clickMenu('color-magenta')
    await settle()

    expect(stored[WIDGET_COLOR_KEY]).toBe('magenta')
    expect(badgeColor).toBe('#b026ff')
    expect(badgeTextColor).toBe('#101010')
    expect(badgeText).toBe('●')
  })

  test('resizes the open window straight from the size menu', async () => {
    clickAction()
    await settle()
    updateCalls = []

    clickMenu('size-large')
    await settle()

    expect(stored[WIDGET_SIZE_KEY]).toBe('large')
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].details.width).toBe(400)
    expect(updateCalls[0].details.height).toBe(550)
  })
})

describe('clampWidgetPosition', () => {
  const primary: WorkArea = { left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080 }
  const secondary: WorkArea = { left: -1280, top: 0, width: 1280, height: 1024, right: 0, bottom: 1024 }

  test('returns null when there is no usable position or display', () => {
    expect(background.clampWidgetPosition({ width: 280, height: 350 }, [primary])).toBeNull()
    expect(background.clampWidgetPosition({ left: 10, top: Number.NaN, width: 280, height: 350 }, [primary])).toBeNull()
    expect(background.clampWidgetPosition({ left: 10, top: 10, width: 280, height: 350 }, [])).toBeNull()
  })

  test('clamps a window into the work area', () => {
    expect(background.clampWidgetPosition({ left: 1900, top: 1000, width: 280, height: 350 }, [primary]))
      .toEqual({ left: 1_640, top: 730 })
  })

  test('pins a window larger than the work area to its origin', () => {
    expect(background.clampWidgetPosition({ left: 100, top: 100, width: 2400, height: 1200 }, [primary]))
      .toEqual({ left: 0, top: 0 })
  })

  test('keeps negative coordinates on displays left of the primary one', () => {
    expect(background.clampWidgetPosition({ left: -1200, top: 100, width: 400, height: 550 }, [primary, secondary]))
      .toEqual({ left: -1200, top: 100 })
  })

  test('falls back to the most overlapping display for an off-screen window', () => {
    expect(background.clampWidgetPosition({ left: 5_000, top: 5_000, width: 280, height: 350 }, [primary, secondary]))
      .toEqual({ left: 1_640, top: 730 })
  })
})

describe('widget settings', () => {
  test('exposes the v2 window sizes', () => {
    expect(SIZE_OPTIONS.map(option => [option.id, option.width, option.height])).toEqual([
      ['normal', 280, 350],
      ['large', 400, 550],
    ])
    expect(COLOR_OPTIONS).toHaveLength(5)
  })

  test('parses raw storage values with defaults', () => {
    expect(parseWidgetSettings({ [WIDGET_COLOR_KEY]: 'magenta', [WIDGET_SIZE_KEY]: 'large' }))
      .toEqual({ color: 'magenta', size: 'large' })
    expect(parseWidgetSettings({ [WIDGET_COLOR_KEY]: 'nope', [WIDGET_SIZE_KEY]: 7 }))
      .toEqual({ color: 'green', size: 'normal' })
    expect(parseWidgetSettings(undefined)).toEqual({ color: 'green', size: 'normal' })
  })
})

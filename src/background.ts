/* global chrome */

import type { WidgetSettings, WidgetSize } from './widget/settings'
import {
  COLOR_OPTIONS,
  findColorOption,
  findSizeOption,
  parseWidgetSettings,
  SIZE_OPTIONS,
  WIDGET_COLOR_KEY,
  WIDGET_SIZE_KEY,
} from './widget/settings'

const WIDGET_PATH = 'src/widget.html'

const WIDGET_WINDOW_ID_KEY = 'widgetWindowId'

const WIDGET_POSITION_KEY = 'widgetPosition'

const COLOR_MENU_PREFIX = 'color-'
const SIZE_MENU_PREFIX = 'size-'

/**
 * Two action clicks closer together than this close the widget instead of
 * focusing it.
 */
const DOUBLE_CLICK_MS = 300

/** Widget accents are light, so the badge glyph itself stays dark for contrast. */
const BADGE_TEXT_COLOR = '#101010'

export interface WidgetBounds {
  left?: number
  top?: number
  width: number
  height: number
}

export interface WidgetPosition {
  left: number
  top: number
}

export interface WorkArea {
  left: number
  top: number
  width: number
  height: number
  right: number
  bottom: number
}

// Widget window geometry. The last position is cached in memory so a drag does
// not rewrite the same value, and persisted to chrome.storage.local so the
// widget reopens in the same spot after the browser or the worker restarts.
let cachedPosition: WidgetPosition | null = null
let pendingPosition: WidgetPosition | null = null
let positionWriteQueue: Promise<void> = Promise.resolve()
let lastClickTime = 0

// Overlapping lifecycle events share a single rebuild so they cannot remove each
// other's menu items; clicks share a single queue so they cannot open two windows.
let contextMenuInitialization: Promise<void> | null = null
let clickQueue: Promise<void> = Promise.resolve()

// Initialize context menu on install/startup
chrome.runtime.onInstalled.addListener(createContextMenu)
chrome.runtime.onStartup.addListener(createContextMenu)

chrome.runtime.onStartup.addListener(() => {
  guard(initializeWidgetPresence, 'startup check failed')
})

chrome.runtime.onInstalled.addListener(() => {
  guard(initializeWidgetPresence, 'install check failed')
})

chrome.contextMenus.onClicked.addListener((info) => {
  guard(() => handleContextMenuClick(info), 'context menu action failed')
})

chrome.action.onClicked.addListener(() => {
  // Timestamp the click synchronously so double-click detection stays accurate,
  // then serialize the async work behind any click already in flight.
  const clickedAt = Date.now()
  clickQueue = clickQueue
    .catch((error) => {
      console.error('Gas Notify: action click failed', error)
    })
    .then(() => handleActionClick(clickedAt))
})

chrome.windows.onRemoved.addListener((windowId) => {
  guard(() => handleWindowRemoved(windowId), 'window removal handling failed')
})

// Registered at module top level so position persistence survives service worker
// restarts instead of being re-registered for every opened window.
chrome.windows.onBoundsChanged.addListener((changedWindow) => {
  guard(() => handleWidgetBoundsChanged(changedWindow), 'bounds handling failed')
})

function guard(action: () => Promise<void>, message: string): void {
  action().catch((error) => {
    console.error(`Gas Notify: ${message}`, error)
  })
}

function createContextMenu(): Promise<void> {
  // Share overlapping lifecycle events so rebuilds cannot remove each other's items.
  contextMenuInitialization ??= rebuildContextMenu()
    .catch((error) => {
      console.error('Gas Notify context menu initialization failed', error)
    })
    .finally(() => {
      contextMenuInitialization = null
    })
  return contextMenuInitialization
}

function createMenuItem(properties: chrome.contextMenus.CreateProperties): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.contextMenus.create(properties, () => {
      const error = chrome.runtime.lastError
      if (error) {
        reject(new Error(error.message))
      }
      else {
        resolve()
      }
    })
  })
}

async function rebuildContextMenu(): Promise<void> {
  const { color: colorId, size: sizeId } = await readSettings()

  // Chrome retains menus across browser sessions; clear them before reusing IDs.
  await chrome.contextMenus.removeAll()

  // Color menu
  await createMenuItem({
    id: 'color-menu',
    title: '🎨 Color',
    contexts: ['action'],
  })

  for (const color of COLOR_OPTIONS) {
    await createMenuItem({
      id: `${COLOR_MENU_PREFIX}${color.id}`,
      parentId: 'color-menu',
      title: color.label,
      type: 'radio',
      checked: color.id === colorId,
      contexts: ['action'],
    })
  }

  // Size menu
  await createMenuItem({
    id: 'size-menu',
    title: '📐 Size',
    contexts: ['action'],
  })

  for (const size of SIZE_OPTIONS) {
    await createMenuItem({
      id: `${SIZE_MENU_PREFIX}${size.id}`,
      parentId: 'size-menu',
      title: size.label,
      type: 'radio',
      checked: size.id === sizeId,
      contexts: ['action'],
    })
  }
}

async function handleContextMenuClick(info: chrome.contextMenus.OnClickData): Promise<void> {
  const menuId = String(info.menuItemId)

  // Handle color selection
  if (menuId.startsWith(COLOR_MENU_PREFIX)) {
    const colorId = findColorOption(menuId.slice(COLOR_MENU_PREFIX.length))?.id
    if (!colorId) {
      return
    }

    await chrome.storage.local.set({ [WIDGET_COLOR_KEY]: colorId })
    // The widget picks the new color up through storage.onChanged; the badge is
    // owned by the worker, so it has to be repainted here.
    await refreshBadge()
    return
  }

  // Handle size selection
  if (menuId.startsWith(SIZE_MENU_PREFIX)) {
    const sizeId = findSizeOption(menuId.slice(SIZE_MENU_PREFIX.length))?.id
    if (!sizeId) {
      return
    }

    await chrome.storage.local.set({ [WIDGET_SIZE_KEY]: sizeId })
    const windowId = await findExistingWidgetWindow(readWidgetUrl())
    if (windowId !== null) {
      await applyWidgetSize(windowId, sizeId)
    }
  }
}

/**
 * Resize the open widget window, keeping its position where possible and
 * clamping it into the work area of the display it currently sits on.
 */
async function applyWidgetSize(windowId: number, sizeId: WidgetSize): Promise<void> {
  const option = findSizeOption(sizeId) ?? SIZE_OPTIONS[0]
  const current = await getWindowSafely(windowId)
  if (!current) {
    return
  }

  if (current.width === option.width && current.height === option.height) {
    return
  }

  const position = clampWidgetPosition(
    { left: current.left, top: current.top, width: option.width, height: option.height },
    await readWorkAreas(),
  )

  await updateWindowBounds(windowId, {
    width: option.width,
    height: option.height,
    ...position,
  })
}

async function updateWindowBounds(windowId: number, details: chrome.windows.UpdateInfo): Promise<void> {
  try {
    await chrome.windows.update(windowId, details)
  }
  catch {
    // The window may have closed between the event and this update.
  }
}

async function getWindowSafely(
  windowId: number,
  options?: chrome.windows.QueryOptions,
): Promise<chrome.windows.Window | null> {
  try {
    return await chrome.windows.get(windowId, options ?? {})
  }
  catch {
    return null
  }
}

async function refreshBadge(): Promise<void> {
  const windowId = await findExistingWidgetWindow(readWidgetUrl())
  await updateBadge(windowId !== null)
}

async function updateBadge(isOpen: boolean): Promise<void> {
  if (!isOpen) {
    // Clear badge when window closed
    await chrome.action.setBadgeText({ text: '' })
    return
  }

  const { color } = await readSettings()
  const accent = findColorOption(color)?.accent ?? COLOR_OPTIONS[0].accent

  await chrome.action.setBadgeBackgroundColor({ color: accent })
  setBadgeTextColor(BADGE_TEXT_COLOR)
  // Color dot when window is open
  await chrome.action.setBadgeText({ text: '●' })
}

function setBadgeTextColor(color: string): void {
  // setBadgeTextColor ships with Chrome 110; older builds keep the default glyph.
  const action = chrome.action as typeof chrome.action & {
    setBadgeTextColor?: (details: { color: string }) => void
  }
  if (typeof action.setBadgeTextColor === 'function') {
    action.setBadgeTextColor({ color })
  }
}

async function handleWindowRemoved(windowId: number): Promise<void> {
  const storedId = await getStoredWindowId()
  if (storedId !== windowId) {
    return
  }

  await setStoredWindowId(null)
  await updateBadge(false)
}

/**
 * One module-scope listener for every widget window. Bounds changes are only used
 * to remember where the user put the window: the user owns the size, so a manual
 * resize is never corrected here.
 */
async function handleWidgetBoundsChanged(changedWindow: chrome.windows.Window): Promise<void> {
  const windowId = changedWindow.id
  if (windowId === undefined) {
    return
  }

  if (!(await isWidgetWindow(windowId))) {
    return
  }

  // Persist where the user put the window so the next open reuses it.
  const left = normalizeCoordinate(changedWindow.left)
  const top = normalizeCoordinate(changedWindow.top)
  if (left !== undefined && top !== undefined) {
    persistWidgetPosition({ left, top })
  }
}

async function isWidgetWindow(windowId: number): Promise<boolean> {
  if ((await getStoredWindowId()) === windowId) {
    return true
  }

  // The stored id is only a hint: the widget can also be opened by navigating to
  // the page directly, so fall back to inspecting the window's tab.
  const window = await getWindowSafely(windowId, { populate: true })
  return window ? hasWidgetTab(window, readWidgetUrl()) : false
}

/**
 * Clamp a target window rectangle into the work area of the display it belongs
 * to. Coordinates are viewport relative, so negative values are normal on a
 * display placed left of or above the primary one.
 */
export function clampWidgetPosition(
  bounds: WidgetBounds,
  workAreas: readonly WorkArea[],
): WidgetPosition | null {
  const left = normalizeCoordinate(bounds.left)
  const top = normalizeCoordinate(bounds.top)
  if (left === undefined || top === undefined || workAreas.length === 0) {
    return null
  }

  const area = pickWorkArea(workAreas, { left, top, width: bounds.width, height: bounds.height })
  const maxLeft = area.right - bounds.width
  const maxTop = area.bottom - bounds.height

  return {
    left: maxLeft <= area.left ? area.left : Math.min(Math.max(left, area.left), maxLeft),
    top: maxTop <= area.top ? area.top : Math.min(Math.max(top, area.top), maxTop),
  }
}

function pickWorkArea(
  workAreas: readonly WorkArea[],
  bounds: { left: number, top: number, width: number, height: number },
): WorkArea {
  const centerX = bounds.left + bounds.width / 2
  const centerY = bounds.top + bounds.height / 2

  const containing = workAreas.find(area =>
    centerX >= area.left && centerX <= area.right && centerY >= area.top && centerY <= area.bottom,
  )
  if (containing) {
    return containing
  }

  // Off screen (or bigger than a single display): keep the most overlapping one.
  let best = workAreas[0]
  let bestOverlap = -1
  for (const area of workAreas) {
    const overlapWidth = Math.max(0, Math.min(area.right, bounds.left + bounds.width) - Math.max(area.left, bounds.left))
    const overlapHeight = Math.max(0, Math.min(area.bottom, bounds.top + bounds.height) - Math.max(area.top, bounds.top))
    const overlap = overlapWidth * overlapHeight
    if (overlap > bestOverlap) {
      bestOverlap = overlap
      best = area
    }
  }

  return best
}

async function readWorkAreas(): Promise<WorkArea[]> {
  // chrome.system.display needs the "system.display" permission; when it is not
  // available the callers simply skip clamping.
  const systemApi = (chrome as unknown as {
    system?: { display?: { getInfo: () => Promise<Array<{ workArea: WorkArea }>> } }
  }).system
  const displayApi = systemApi?.display
  if (typeof displayApi?.getInfo !== 'function') {
    return []
  }

  try {
    const displays = await displayApi.getInfo()
    return displays
      .map(display => display.workArea)
      .filter(area => area.width > 0 && area.height > 0)
      .map(area => ({
        left: area.left,
        top: area.top,
        width: area.width,
        height: area.height,
        right: area.left + area.width,
        bottom: area.top + area.height,
      }))
  }
  catch {
    return []
  }
}

function normalizeCoordinate(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

async function handleActionClick(clickedAt: number): Promise<void> {
  const widgetUrl = readWidgetUrl()
  const existingWindowId = await findExistingWidgetWindow(widgetUrl)

  // Double-click detected (< 300ms)
  if (existingWindowId !== null && clickedAt - lastClickTime < DOUBLE_CLICK_MS) {
    lastClickTime = 0
    await closeWidgetWindow(existingWindowId)
    return
  }

  lastClickTime = clickedAt

  if (existingWindowId !== null) {
    await focusWidgetWindow(existingWindowId)
    return
  }

  await openWidgetWindow(widgetUrl)
}

async function closeWidgetWindow(windowId: number): Promise<void> {
  try {
    await chrome.windows.remove(windowId)
  }
  catch {
    // Window already closed
  }

  await setStoredWindowId(null)
  await updateBadge(false)
}

async function focusWidgetWindow(windowId: number): Promise<void> {
  try {
    await chrome.windows.update(windowId, { focused: true, drawAttention: true })
  }
  catch {
    // The window vanished before we could focus it; drop the stale state.
    await setStoredWindowId(null)
    await updateBadge(false)
  }
}

async function openWidgetWindow(widgetUrl: string): Promise<void> {
  const settings = await readSettings()
  const option = findSizeOption(settings.size) ?? SIZE_OPTIONS[0]

  const position = clampWidgetPosition(
    { ...(await readSavedPosition()), width: option.width, height: option.height },
    await readWorkAreas(),
  )

  const newWindow = await chrome.windows.create({
    url: `${widgetUrl}?color=${settings.color}&size=${settings.size}`,
    type: 'popup',
    focused: true,
    width: option.width,
    height: option.height,
    ...position,
  })

  const windowId = newWindow?.id
  if (windowId === undefined) {
    return
  }

  if (position) {
    persistWidgetPosition(position)
  }

  await setStoredWindowId(windowId)
  await updateBadge(true)
}

async function initializeWidgetPresence(): Promise<void> {
  const windowId = await findExistingWidgetWindow(readWidgetUrl())
  await updateBadge(windowId !== null)
}

async function findExistingWidgetWindow(widgetUrl: string): Promise<number | null> {
  const storedId = await getStoredWindowId()

  // First check stored ID
  if (storedId !== null) {
    const storedWindow = await getWindowSafely(storedId, { populate: true })
    if (storedWindow && hasWidgetTab(storedWindow, widgetUrl)) {
      return storedId
    }
  }

  // Fallback: search all windows
  const windows = await chrome.windows.getAll({ populate: true })
  const existing = windows.find(window => hasWidgetTab(window, widgetUrl))
  if (existing?.id !== undefined) {
    await setStoredWindowId(existing.id)
    return existing.id
  }

  if (storedId !== null) {
    // Stale id: the window was closed while the worker was asleep.
    await setStoredWindowId(null)
  }
  return null
}

function hasWidgetTab(window: chrome.windows.Window, widgetUrl: string): boolean {
  return window.tabs?.some(tab => tab.url?.startsWith(widgetUrl)) ?? false
}

function readWidgetUrl(): string {
  return chrome.runtime.getURL(WIDGET_PATH)
}

async function readSettings(): Promise<WidgetSettings> {
  return parseWidgetSettings(await chrome.storage.local.get([WIDGET_COLOR_KEY, WIDGET_SIZE_KEY]))
}

async function getStoredWindowId(): Promise<number | null> {
  const result = await chrome.storage.local.get(WIDGET_WINDOW_ID_KEY) as { [WIDGET_WINDOW_ID_KEY]?: number }
  return result[WIDGET_WINDOW_ID_KEY] ?? null
}

/**
 * Persist the widget position when it actually changed, coalescing the writes so
 * a drag across the screen lands as a single storage update.
 */
function persistWidgetPosition(position: WidgetPosition): void {
  if (cachedPosition && cachedPosition.left === position.left && cachedPosition.top === position.top) {
    return
  }

  cachedPosition = position
  pendingPosition = position
  positionWriteQueue = positionWriteQueue
    .then(async () => {
      const next = pendingPosition
      if (!next) {
        return
      }

      pendingPosition = null
      await chrome.storage.local.set({ [WIDGET_POSITION_KEY]: next })
    })
    .catch((error) => {
      console.error('Gas Notify: saving the widget position failed', error)
    })
}

async function readSavedPosition(): Promise<WidgetPosition | null> {
  const result = await chrome.storage.local.get(WIDGET_POSITION_KEY) as { [WIDGET_POSITION_KEY]?: unknown }
  cachedPosition = parseWidgetPosition(result[WIDGET_POSITION_KEY])
  return cachedPosition
}

/** Read a saved position, ignoring anything that is not a pair of finite numbers. */
export function parseWidgetPosition(value: unknown): WidgetPosition | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  const left = normalizeCoordinate(record.left)
  const top = normalizeCoordinate(record.top)
  return left !== undefined && top !== undefined ? { left, top } : null
}

async function setStoredWindowId(id: number | null): Promise<void> {
  if (id === null) {
    await chrome.storage.local.remove(WIDGET_WINDOW_ID_KEY)
  }
  else {
    await chrome.storage.local.set({ [WIDGET_WINDOW_ID_KEY]: id })
  }
}

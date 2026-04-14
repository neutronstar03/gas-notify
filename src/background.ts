/* global chrome */

const WIDGET_PATH = 'src/widget.html'

const WIDGET_WINDOW_ID_KEY = 'widgetWindowId'
const WIDGET_COLOR_KEY = 'widgetColor'
const WIDGET_SIZE_KEY = 'widgetSize'

// Color options
const COLOR_OPTIONS = [
  { id: 'green', label: '💚 Green', accent: '#7cffaf' },
  { id: 'pearl', label: '💧 Pearl Aqua', accent: '#78dae4' },
  { id: 'magenta', label: '💜 Hyper Magenta', accent: '#b026ff' },
  { id: 'fuchsia', label: '💖 Hot Fuchsia', accent: '#ff1654' },
  { id: 'lime', label: '💛 Lime Cream', accent: '#fffd98' },
] as const

// Size options
const SIZE_OPTIONS = [
  { id: 'normal', label: '◽ Normal', width: 280, height: 270 },
  { id: 'large', label: '◼️ Large', width: 400, height: 420 },
] as const

let lastClickTime = 0

// Initialize context menu on install/startup
chrome.runtime.onInstalled.addListener(createContextMenu)
chrome.runtime.onStartup.addListener(createContextMenu)

function createContextMenu(): void {
  // Color menu
  chrome.contextMenus.create({
    id: 'color-menu',
    title: '🎨 Color',
    contexts: ['action'],
  })

  for (const color of COLOR_OPTIONS) {
    chrome.contextMenus.create({
      id: `color-${color.id}`,
      parentId: 'color-menu',
      title: color.label,
      type: 'radio',
      contexts: ['action'],
    })
  }

  // Size menu
  chrome.contextMenus.create({
    id: 'size-menu',
    title: '📐 Size',
    contexts: ['action'],
  })

  for (const size of SIZE_OPTIONS) {
    chrome.contextMenus.create({
      id: `size-${size.id}`,
      parentId: 'size-menu',
      title: size.label,
      type: 'radio',
      contexts: ['action'],
    })
  }

  // Set initial checked states
  chrome.storage.local.get([WIDGET_COLOR_KEY, WIDGET_SIZE_KEY]).then((result) => {
    const color = result[WIDGET_COLOR_KEY] || 'green'
    const size = result[WIDGET_SIZE_KEY] || 'normal'
    chrome.contextMenus.update(`color-${color}`, { checked: true })
    chrome.contextMenus.update(`size-${size}`, { checked: true })
  })
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info) => {
  const menuId = String(info.menuItemId)

  // Handle color selection
  if (menuId.startsWith('color-')) {
    const color = menuId.replace('color-', '')
    const validColor = COLOR_OPTIONS.find(c => c.id === color)?.id
    if (validColor) {
      await chrome.storage.local.set({ [WIDGET_COLOR_KEY]: validColor })
      await notifyWidgetThemeChange()
    }
  }

  // Handle size selection
  if (menuId.startsWith('size-')) {
    const size = menuId.replace('size-', '')
    const validSize = SIZE_OPTIONS.find(s => s.id === size)?.id
    if (validSize) {
      await chrome.storage.local.set({ [WIDGET_SIZE_KEY]: validSize })
      await notifyWidgetThemeChange()
      await updateWindowSizeForSize(validSize)
    }
  }
})

async function notifyWidgetThemeChange(): Promise<void> {
  // Send message to widget window if open
  const windowId = await getStoredWindowId()
  if (windowId !== null) {
    const windows = await chrome.windows.getAll({ populate: true })
    const widgetWindow = windows.find(w => w.id === windowId)
    if (widgetWindow?.tabs?.[0]?.id) {
      try {
        await chrome.tabs.sendMessage(widgetWindow.tabs[0].id, { type: 'theme-change' })
      }
      catch {
        // Window may have closed or page not loaded
      }
    }
  }
}

async function updateWindowSizeForSize(size: string): Promise<void> {
  const windowId = await getStoredWindowId()
  if (windowId === null)
    return

  const sizeOption = SIZE_OPTIONS.find(s => s.id === size)
  if (!sizeOption)
    return

  try {
    await chrome.windows.update(windowId, { width: sizeOption.width, height: sizeOption.height })
  }
  catch {
    // Window may have been closed
  }
}

chrome.action.onClicked.addListener(async () => {
  const now = Date.now()
  const timeSinceLastClick = now - lastClickTime
  const widgetUrl = chrome.runtime.getURL(WIDGET_PATH)
  const existingWindowId = await findExistingWidgetWindow(widgetUrl)

  // Double-click detected (< 300ms)
  if (timeSinceLastClick < 300 && existingWindowId !== null) {
    // Close the window
    try {
      await chrome.windows.remove(existingWindowId)
      await setStoredWindowId(null)
      await updateBadge(false)
    }
    catch {
      // Window already closed
      await setStoredWindowId(null)
      await updateBadge(false)
    }
    lastClickTime = 0
    return
  }

  lastClickTime = now

  // Single-click behavior
  if (existingWindowId !== null) {
    await chrome.windows.update(existingWindowId, { focused: true, drawAttention: true })
    return
  }

  // Get current color and size for theming
  const settingsResult = await chrome.storage.local.get([WIDGET_COLOR_KEY, WIDGET_SIZE_KEY])
  const color = settingsResult[WIDGET_COLOR_KEY] || 'green'
  const size = settingsResult[WIDGET_SIZE_KEY] || 'normal'
  const sizeOption = SIZE_OPTIONS.find(s => s.id === size) || SIZE_OPTIONS[0]

  const newWindow = await chrome.windows.create({
    url: `${widgetUrl}?color=${color}&size=${size}`,
    type: 'popup',
    focused: true,
    width: sizeOption.width,
    height: sizeOption.height,
  })

  if (!newWindow)
    return

  const windowId = newWindow.id
  if (windowId !== undefined) {
    await setStoredWindowId(windowId)
    await updateBadge(true)

    // Enforce non-resizable by updating if user tries to resize
    chrome.windows.onBoundsChanged.addListener((changedWindow) => {
      if (changedWindow.id === windowId) {
        chrome.windows.update(windowId, { width: sizeOption.width, height: sizeOption.height })
      }
    })
  }
})

// Listen for window removal to update badge
chrome.windows.onRemoved.addListener(async (windowId) => {
  const storedId = await getStoredWindowId()
  if (storedId === windowId) {
    await setStoredWindowId(null)
    await updateBadge(false)
  }
})

async function findExistingWidgetWindow(widgetUrl: string): Promise<number | null> {
  const storedId = await getStoredWindowId()

  // First check stored ID
  if (storedId !== null) {
    try {
      const window = await chrome.windows.get(storedId)
      if (window) {
        const windows = await chrome.windows.getAll({ populate: true })
        const widgetWindow = windows.find(w => w.id === storedId)
        const hasWidgetTab = widgetWindow?.tabs?.some(tab => tab.url?.startsWith(widgetUrl))
        if (hasWidgetTab) {
          return storedId
        }
      }
    }
    catch {
      // Window no longer exists
    }
  }

  // Fallback: search all windows
  const windows = await chrome.windows.getAll({ populate: true })
  for (const currentWindow of windows) {
    const hasWidgetTab = currentWindow.tabs?.some(tab => tab.url?.startsWith(widgetUrl))
    if (hasWidgetTab && currentWindow.id !== undefined) {
      await setStoredWindowId(currentWindow.id)
      await updateBadge(true)
      return currentWindow.id
    }
  }

  return null
}

async function getStoredWindowId(): Promise<number | null> {
  const result = await chrome.storage.local.get(WIDGET_WINDOW_ID_KEY) as { [WIDGET_WINDOW_ID_KEY]?: number }
  return result[WIDGET_WINDOW_ID_KEY] ?? null
}

async function setStoredWindowId(id: number | null): Promise<void> {
  if (id === null) {
    await chrome.storage.local.remove(WIDGET_WINDOW_ID_KEY)
  }
  else {
    await chrome.storage.local.set({ [WIDGET_WINDOW_ID_KEY]: id })
  }
}

async function updateBadge(isOpen: boolean): Promise<void> {
  if (isOpen) {
    // Get current color for badge
    const result = await chrome.storage.local.get(WIDGET_COLOR_KEY)
    const colorId = result[WIDGET_COLOR_KEY] || 'green'
    const colorOption = COLOR_OPTIONS.find(c => c.id === colorId) || COLOR_OPTIONS[0]

    // Color dot when window is open
    await chrome.action.setBadgeText({ text: '●' })
    await chrome.action.setBadgeBackgroundColor({ color: colorOption.accent })
  }
  else {
    // Clear badge when window closed
    await chrome.action.setBadgeText({ text: '' })
  }
}

// Initialize badge on startup
chrome.runtime.onStartup.addListener(async () => {
  const widgetUrl = chrome.runtime.getURL(WIDGET_PATH)
  const existingId = await findExistingWidgetWindow(widgetUrl)
  await updateBadge(existingId !== null)
})

// Also check on install
chrome.runtime.onInstalled.addListener(async () => {
  const widgetUrl = chrome.runtime.getURL(WIDGET_PATH)
  const existingId = await findExistingWidgetWindow(widgetUrl)
  await updateBadge(existingId !== null)
})

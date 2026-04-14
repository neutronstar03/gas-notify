/* global chrome */

const WIDGET_PATH = 'src/widget.html'
// Window dimensions to match content body of ~264x233 pixels
// Window chrome adds ~16px width (borders) and ~31px height (title bar)
const WIDGET_WINDOW_WIDTH = 280
const WIDGET_WINDOW_HEIGHT = 270

const WIDGET_WINDOW_ID_KEY = 'widgetWindowId'
const WIDGET_THEME_KEY = 'widgetTheme'

let lastClickTime = 0

// Initialize context menu on install/startup
chrome.runtime.onInstalled.addListener(createContextMenu)
chrome.runtime.onStartup.addListener(createContextMenu)

function createContextMenu(): void {
  chrome.contextMenus.create({
    id: 'theme-menu',
    title: '🎨 Theme',
    contexts: ['action'],
  })

  chrome.contextMenus.create({
    id: 'theme-original',
    parentId: 'theme-menu',
    title: 'Original (Compact)',
    type: 'radio',
    contexts: ['action'],
  })

  chrome.contextMenus.create({
    id: 'theme-large',
    parentId: 'theme-menu',
    title: 'Large (Accessibility)',
    type: 'radio',
    contexts: ['action'],
  })

  // Set initial checked state
  chrome.storage.local.get(WIDGET_THEME_KEY).then((result) => {
    const theme = result[WIDGET_THEME_KEY] || 'original'
    chrome.contextMenus.update(`theme-${theme}`, { checked: true })
  })
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === 'theme-original') {
    await chrome.storage.local.set({ [WIDGET_THEME_KEY]: 'original' })
    await notifyWidgetThemeChange('original')
    await updateWindowSizeForTheme('original')
  }
  else if (info.menuItemId === 'theme-large') {
    await chrome.storage.local.set({ [WIDGET_THEME_KEY]: 'large' })
    await notifyWidgetThemeChange('large')
    await updateWindowSizeForTheme('large')
  }
})

async function notifyWidgetThemeChange(theme: string): Promise<void> {
  // Send message to widget window if open
  const windowId = await getStoredWindowId()
  if (windowId !== null) {
    const windows = await chrome.windows.getAll({ populate: true })
    const widgetWindow = windows.find(w => w.id === windowId)
    if (widgetWindow?.tabs?.[0]?.id) {
      try {
        await chrome.tabs.sendMessage(widgetWindow.tabs[0].id, { type: 'theme-change', theme })
      }
      catch {
        // Window may have closed or page not loaded
      }
    }
  }
}

async function updateWindowSizeForTheme(theme: string): Promise<void> {
  const windowId = await getStoredWindowId()
  if (windowId === null)
    return

  const isLarge = theme === 'large'
  const width = isLarge ? 400 : WIDGET_WINDOW_WIDTH
  const height = isLarge ? 420 : WIDGET_WINDOW_HEIGHT

  try {
    await chrome.windows.update(windowId, { width, height })
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

  // Get current theme for sizing
  const themeResult = await chrome.storage.local.get(WIDGET_THEME_KEY)
  const theme = themeResult[WIDGET_THEME_KEY] || 'original'
  const isLarge = theme === 'large'

  const width = isLarge ? 400 : WIDGET_WINDOW_WIDTH
  const height = isLarge ? 420 : WIDGET_WINDOW_HEIGHT

  const newWindow = await chrome.windows.create({
    url: `${widgetUrl}?theme=${theme}`,
    type: 'popup',
    focused: true,
    width,
    height,
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
        chrome.windows.update(windowId, { width, height })
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
    // Green dot when window is open
    await chrome.action.setBadgeText({ text: '●' })
    await chrome.action.setBadgeBackgroundColor({ color: '#7cffaf' })
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

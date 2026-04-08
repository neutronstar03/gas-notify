/* global chrome */

const WIDGET_PATH = 'src/widget.html'
const WIDGET_WIDTH = 264
const WIDGET_HEIGHT = 320

chrome.action.onClicked.addListener(async () => {
  const widgetUrl = chrome.runtime.getURL(WIDGET_PATH)
  const existingWindowId = await findExistingWidgetWindow(widgetUrl)

  if (existingWindowId !== null) {
    await chrome.windows.update(existingWindowId, { focused: true, drawAttention: true })
    return
  }

  await chrome.windows.create({
    url: widgetUrl,
    type: 'popup',
    focused: true,
    width: WIDGET_WIDTH,
    height: WIDGET_HEIGHT,
  })
})

async function findExistingWidgetWindow(widgetUrl: string): Promise<number | null> {
  const windows = await chrome.windows.getAll({ populate: true })

  for (const currentWindow of windows) {
    const hasWidgetTab = currentWindow.tabs?.some(tab => tab.url === widgetUrl)
    if (hasWidgetTab && currentWindow.id !== undefined) {
      return currentWindow.id
    }
  }

  return null
}

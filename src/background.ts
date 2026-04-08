/* global chrome */

chrome.action.onClicked.addListener(async (tab: chrome.tabs.Tab) => {
  if (!tab.id) {
    return
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'gas-notify/toggle-overlay' })
  }
  catch (error) {
    console.warn('Gas Notify overlay toggle failed', error)
  }
})

const MENU_ID = 'voxlight-speak';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: '🔊 Read aloud with Voxlight',
    contexts: ['selection'],
  });
});

// Injected on demand via activeTab — no broad host permissions needed,
// and it works immediately after install without reloading tabs.
async function speakInTab(tabId) {
  try {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tabId, { type: 'voxlight-speak' });
  } catch (e) {
    // Restricted page (chrome://, Web Store, PDF viewer) — nothing we can do.
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID && tab && tab.id != null) speakInTab(tab.id);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'voxlight-speak' && tab && tab.id != null) speakInTab(tab.id);
});

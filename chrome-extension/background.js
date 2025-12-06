/**
 * Psychofauna Background Service Worker
 *
 * MVP path: classification is handled in an offscreen document so we can
 * access DOM APIs (e.g., URL.createObjectURL) that are unavailable in the
 * service worker context.
 */
const OFFSCREEN_URL = chrome.runtime.getURL('offscreen.html');

// ============================================
// State
// ============================================

let modelReady = false;
let modelPromise = null;

// ============================================
// Helpers
// ============================================

function notifyAllTabs(message) {
  chrome.tabs
    .query({ url: ['*://twitter.com/*', '*://x.com/*'] })
    .then((tabs) => {
      for (const tab of tabs) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {
          // Tab might not have content script yet; ignore.
        });
      }
    });
}

async function ensureOffscreenDocument() {
  if (!chrome.offscreen) {
    console.error('[Psychofauna BG] Offscreen API not available');
    return false;
  }

  const hasDocument = await chrome.offscreen.hasDocument?.();
  if (hasDocument) return true;

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['DOM_PARSER'],
    justification: 'Run transformer model in offscreen document',
  });

  return true;
}

function sendMessageToOffscreen(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(response);
      }
    });
  });
}

function ensureModel() {
  if (modelReady) return Promise.resolve(true);
  if (modelPromise) return modelPromise;

  modelPromise = ensureOffscreenDocument()
    .then(() => sendMessageToOffscreen({ type: 'offscreen-init' }))
    .then((response) => {
      modelReady = !!response?.ready;
      if (modelReady) {
        notifyAllTabs({ type: 'modelReady' });
      }
      return modelReady;
    })
    .catch((error) => {
      console.error('[Psychofauna BG] Model init failed:', error);
      modelReady = false;
      return false;
    })
    .finally(() => {
      modelPromise = null;
    });

  return modelPromise;
}

async function processClassification(message, sender) {
  if (!sender.tab?.id) {
    return { error: 'No tab associated with request' };
  }

  const ready = await ensureModel();
  if (!ready) {
    return { error: 'Model not ready' };
  }

  try {
    const response = await sendMessageToOffscreen({
      type: 'offscreen-classify',
      batchId: message.batchId,
      items: message.items,
    });

    const results = response?.results || [];

    chrome.tabs
      .sendMessage(sender.tab.id, {
        type: 'classificationResults',
        batchId: message.batchId,
        results,
      })
      .catch((err) => {
        console.error('[Psychofauna BG] Failed to send results to tab:', err);
      });

    return { queued: true };
  } catch (error) {
    console.error('[Psychofauna BG] Classification failed:', error);
    return { error: error.message || 'Classification failed' };
  }
}

// ============================================
// Message Handling
// ============================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Psychofauna BG] Received:', message.type, 'from tab', sender.tab?.id);

  switch (message.type) {
    case 'checkModelReady':
      sendResponse({ ready: modelReady });
      return false;

    case 'classify':
      processClassification(message, sender).then(sendResponse);
      return true; // Keep the message channel open for async response

    case 'getStatus':
      sendResponse({
        modelReady: modelReady,
        pendingBatches: 0,
      });
      return false;

    default:
      // No-op
      return false;
  }
});

// ============================================
// Initialization
// ============================================

console.log('[Psychofauna BG] Background script loaded');
// Warm up the model immediately so the content script can start queuing.
ensureOffscreenDocument().then(() => ensureModel());

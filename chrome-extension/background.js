/**
 * Psychofauna Background Service Worker
 *
 * MVP path: run classification directly in the service worker (no dedicated
 * web worker) to stay MV3-compliant and avoid remote imports.
 */

import { initModel, classifyBatch, isModelReady } from './worker.js';

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

function ensureModel() {
  if (modelReady) return Promise.resolve(true);
  if (modelPromise) return modelPromise;

  modelPromise = initModel()
    .then(() => {
      modelReady = isModelReady();
      notifyAllTabs({ type: 'modelReady' });
      return true;
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
    const results = await classifyBatch(message.items);

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
ensureModel();

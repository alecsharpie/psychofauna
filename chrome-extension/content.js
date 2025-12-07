/**
 * Psychofauna Content Script
 * 
 * Runs on Twitter/X pages, detects tweets via MutationObserver,
 * and communicates with the background service worker for classification.
 */

(function() {
  'use strict';

  // ============================================
  // Configuration
  // ============================================
  
  const CONFIG = {
    // Tweet container selector for Twitter/X
    tweetSelector: '[data-testid="tweet"]',
    
    // Threshold for flagging (legacy; used if no topic block matches)
    flagThreshold: 0.7,
    
    // Batch settings
    batchSize: 5,
    batchDebounceMs: 100,
    
    // Debug mode (toggle via popup or storage)
    debug: true, // Default to true for MVP development
  };

  // ============================================
  // State
  // ============================================
  
  const state = {
    processed: new WeakSet(),
    pending: new Map(), // element -> { id, text }
    inflightBatches: new Map(), // batchId -> [{ element, id }]
    batchIdCounter: 0,
    stats: {
      total: 0,
      flagged: 0,
      safe: 0,
      processing: 0,
    },
    modelReady: false,
    batchTimeout: null,
    blockedTopics: new Set(),
  };

  // ============================================
  // Debug Utilities
  // ============================================
  
  function log(...args) {
    if (CONFIG.debug) {
      console.log('[Psychofauna]', ...args);
    }
  }

  function updateDebugPanel() {
    if (!CONFIG.debug) return;
    
    let panel = document.querySelector('.psychofauna-debug-panel');
    
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'psychofauna-debug-panel';
      document.body.appendChild(panel);
    }
    
    panel.innerHTML = `
      <h3>🧠 Psychofauna Debug</h3>
      <div class="stat">
        <span>Model:</span>
        <span class="stat-value">${state.modelReady ? '✅ Ready' : '⏳ Loading...'}</span>
      </div>
      <div class="stat">
        <span>Total processed:</span>
        <span class="stat-value">${state.stats.total}</span>
      </div>
      <div class="stat">
        <span>Flagged:</span>
        <span class="stat-value flagged">${state.stats.flagged}</span>
      </div>
      <div class="stat">
        <span>Safe:</span>
        <span class="stat-value safe">${state.stats.safe}</span>
      </div>
      <div class="stat">
        <span>Processing:</span>
        <span class="stat-value">${state.stats.processing}</span>
      </div>
    `;
  }

  function addDebugOverlay(element, status, score = null, label = null) {
    if (!CONFIG.debug) return;
    
    // Remove existing overlay
    const existing = element.querySelector('.psychofauna-debug-overlay');
    if (existing) existing.remove();
    
    // Ensure element has relative positioning for overlay
    const computedStyle = window.getComputedStyle(element);
    if (computedStyle.position === 'static') {
      element.style.position = 'relative';
    }
    
    const overlay = document.createElement('div');
    overlay.className = `psychofauna-debug-overlay ${status}`;
    
    if (status === 'processing') {
      overlay.textContent = '⏳ Processing...';
    } else {
      overlay.innerHTML = `
        <span class="psychofauna-debug-score">${(score * 100).toFixed(1)}%</span>
        <span class="psychofauna-debug-label">${label || status}</span>
      `;
    }
    
    element.appendChild(overlay);
  }

  // ============================================
  // Text Extraction
  // ============================================
  
  function extractTweetText(tweetElement) {
    // Twitter's tweet text is in a specific structure
    // The main text content is usually in [data-testid="tweetText"]
    const textElement = tweetElement.querySelector('[data-testid="tweetText"]');
    
    if (textElement) {
      return textElement.innerText.trim();
    }
    
    // Fallback: get all text content but try to filter out UI elements
    // This is less precise but catches edge cases
    const clone = tweetElement.cloneNode(true);
    
    // Remove elements that are likely UI, not content
    const uiSelectors = [
      '[data-testid="like"]',
      '[data-testid="retweet"]',
      '[data-testid="reply"]',
      '[data-testid="bookmark"]',
      '[data-testid="share"]',
      '[role="button"]',
      'time',
      '[data-testid="User-Name"]',
    ];
    
    uiSelectors.forEach(sel => {
      clone.querySelectorAll(sel).forEach(el => el.remove());
    });
    
    return clone.innerText.trim();
  }

  // ============================================
  // Classification Queue
  // ============================================
  
  function queueForClassification(element) {
    if (state.processed.has(element)) return;
    
    const text = extractTweetText(element);
    
    // Skip empty or very short content
    if (!text || text.length < 10) {
      log('Skipping short/empty tweet');
      return;
    }
    
    state.processed.add(element);
    
    const id = `tweet-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    state.pending.set(element, { id, text });
    
    // Mark as processing
    element.dataset.psychofaunaStatus = 'processing';
    state.stats.processing++;
    updateDebugPanel();
    addDebugOverlay(element, 'processing');
    
    log('Queued tweet:', text.substring(0, 50) + '...');
    
    scheduleFlush();
  }

  function scheduleFlush() {
    clearTimeout(state.batchTimeout);
    
    if (state.pending.size >= CONFIG.batchSize) {
      flushQueue();
    } else {
      state.batchTimeout = setTimeout(flushQueue, CONFIG.batchDebounceMs);
    }
  }

  function flushQueue() {
    if (state.pending.size === 0) return;
    if (!state.modelReady) {
      log('Model not ready, waiting...');
      setTimeout(flushQueue, 500);
      return;
    }
    
    const batchId = state.batchIdCounter++;
    const batch = Array.from(state.pending.entries());
    state.pending.clear();
    
    // Store reference to elements for when results come back
    state.inflightBatches.set(batchId, batch.map(([el, data]) => ({ element: el, id: data.id })));
    
    // Send to background for classification
    const texts = batch.map(([_, data]) => ({ id: data.id, text: data.text }));
    
    log(`Sending batch ${batchId} with ${texts.length} items`);
    
    chrome.runtime.sendMessage({
      type: 'classify',
      batchId: batchId,
      items: texts,
    });
  }

  // ============================================
  // Handle Classification Results
  // ============================================
  
  function handleClassificationResults(batchId, results) {
    log(`Received results for batch ${batchId}:`, results);
    
    const batch = state.inflightBatches.get(batchId);
    if (!batch) {
      log(`No batch found for id ${batchId}`);
      return;
    }
    
    state.inflightBatches.delete(batchId);
    
    // Create lookup by id
    const resultsById = new Map(results.map(r => [r.id, r]));
    
    for (const { element, id } of batch) {
      const result = resultsById.get(id);
      
      state.stats.processing--;
      state.stats.total++;
      
      if (!result) {
        log(`No result for ${id}`);
        element.dataset.psychofaunaStatus = 'error';
        continue;
      }
      
      const label = (result.label || '').toLowerCase();
      const isBlockedTopic = state.blockedTopics.has(label);
      const isNegativeSentiment = label === 'negative' && result.score >= CONFIG.flagThreshold;
      const isFlagged = isBlockedTopic || isNegativeSentiment;
      
      if (isFlagged) {
        element.dataset.psychofaunaFlagged = 'true';
        element.dataset.psychofaunaStatus = 'flagged';
        state.stats.flagged++;
        log(`FLAGGED (${result.score.toFixed(3)}):`, result.text?.substring(0, 50));
      } else {
        element.dataset.psychofaunaStatus = 'safe';
        state.stats.safe++;
      }
      
      addDebugOverlay(element, isFlagged ? 'flagged' : 'safe', result.score, result.label);
      updateDebugPanel();
    }
  }

  // ============================================
  // Tweet Detection (MutationObserver)
  // ============================================
  
  function processTweet(element) {
    if (!element.matches(CONFIG.tweetSelector)) return;
    queueForClassification(element);
  }

  function scanForTweets(root) {
    // Check if root itself is a tweet
    if (root.matches?.(CONFIG.tweetSelector)) {
      processTweet(root);
    }
    
    // Check children
    const tweets = root.querySelectorAll?.(CONFIG.tweetSelector) || [];
    tweets.forEach(processTweet);
  }

  function setupMutationObserver() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          scanForTweets(node);
        }
      }
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
    
    log('MutationObserver started');
    
    return observer;
  }

  // ============================================
  // Message Handling
  // ============================================
  
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    log('Received message:', message.type);
    
    switch (message.type) {
      case 'modelReady':
        state.modelReady = true;
        log('Model is ready!');
        updateDebugPanel();
        // Process any tweets that were waiting
        flushQueue();
        break;
        
      case 'classificationResults':
        handleClassificationResults(message.batchId, message.results);
        break;
        
      case 'setDebug':
        CONFIG.debug = message.enabled;
        if (!CONFIG.debug) {
          const panel = document.querySelector('.psychofauna-debug-panel');
          if (panel) panel.remove();
          document.querySelectorAll('.psychofauna-debug-overlay').forEach(el => el.remove());
        } else {
          updateDebugPanel();
        }
        break;

      case 'setBlockedTopics':
        state.blockedTopics = new Set(message.blockedTopics || []);
        log('Blocked topics updated:', Array.from(state.blockedTopics));
        break;
        
      case 'getStats':
        sendResponse(state.stats);
        break;
    }
  });

  // ============================================
  // Initialization
  // ============================================
  
  function init() {
    log('Initializing Psychofauna on', window.location.hostname);
    
    // Load settings
    chrome.storage.local.get(['debugMode', 'blockedTopics'], (settings) => {
      CONFIG.debug = settings.debugMode !== false; // default true
      state.blockedTopics = new Set(settings.blockedTopics || []);
      updateDebugPanel();
    });
    
    // Check if model is ready
    chrome.runtime.sendMessage({ type: 'checkModelReady' }, (response) => {
      if (response?.ready) {
        state.modelReady = true;
        log('Model already ready');
      }
    });
    
    // Set up mutation observer
    setupMutationObserver();
    
    // Process any tweets already on the page
    scanForTweets(document.body);
    
    log('Initialization complete');
  }

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

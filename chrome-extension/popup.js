/**
 * Psychofauna Popup Script
 * 
 * Handles the extension popup UI, showing status and stats.
 */

// ============================================
// DOM Elements
// ============================================

const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const statTotal = document.getElementById('statTotal');
const statFlagged = document.getElementById('statFlagged');
const statSafe = document.getElementById('statSafe');
const debugToggle = document.getElementById('debugToggle');

// ============================================
// Status Updates
// ============================================

async function updateStatus() {
  try {
    // Check if model is ready via background
    const response = await chrome.runtime.sendMessage({ type: 'getStatus' });
    
    if (response.modelReady) {
      statusDot.className = 'status-dot ready';
      statusText.textContent = 'Model ready';
    } else {
      statusDot.className = 'status-dot loading';
      statusText.textContent = 'Loading model...';
    }
  } catch (error) {
    statusDot.className = 'status-dot';
    statusText.textContent = 'Error: ' + error.message;
  }
}

async function updateStats() {
  try {
    // Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || !tab.url?.match(/twitter\.com|x\.com/)) {
      // Not on Twitter/X
      statTotal.textContent = '-';
      statFlagged.textContent = '-';
      statSafe.textContent = '-';
      return;
    }
    
    // Request stats from content script
    const stats = await chrome.tabs.sendMessage(tab.id, { type: 'getStats' });
    
    if (stats) {
      statTotal.textContent = stats.total;
      statFlagged.textContent = stats.flagged;
      statSafe.textContent = stats.safe;
    }
  } catch (error) {
    // Content script might not be loaded yet
    console.log('Could not get stats:', error);
  }
}

// ============================================
// Controls
// ============================================

async function handleDebugToggle() {
  const enabled = debugToggle.checked;
  
  // Save preference
  await chrome.storage.local.set({ debugMode: enabled });
  
  // Notify content script
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url?.match(/twitter\.com|x\.com/)) {
      await chrome.tabs.sendMessage(tab.id, { type: 'setDebug', enabled });
    }
  } catch (error) {
    console.log('Could not update debug mode:', error);
  }
}

async function loadSettings() {
  const settings = await chrome.storage.local.get(['debugMode']);
  debugToggle.checked = settings.debugMode !== false; // Default to true
}

// ============================================
// Event Listeners
// ============================================

debugToggle.addEventListener('change', handleDebugToggle);

// ============================================
// Initialization
// ============================================

async function init() {
  await loadSettings();
  await updateStatus();
  await updateStats();
  
  // Refresh stats periodically while popup is open
  setInterval(updateStats, 2000);
}

init();

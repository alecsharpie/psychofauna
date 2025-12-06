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
const topicsContainer = document.getElementById('topicsContainer');

// Labels for sentiment model
const TOPICS = [
  { id: 'negative', label: 'Negative' },
  { id: 'positive', label: 'Positive' },
];

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
  const settings = await chrome.storage.local.get(['debugMode', 'blockedTopics']);
  debugToggle.checked = settings.debugMode !== false; // Default to true

  const blocked = new Set(settings.blockedTopics || []);
  topicsContainer.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.checked = blocked.has(checkbox.value);
  });
}

async function handleTopicChange() {
  const blockedTopics = Array.from(
    topicsContainer.querySelectorAll('input[type="checkbox"]:checked')
  ).map((c) => c.value);

  await chrome.storage.local.set({ blockedTopics });

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url?.match(/twitter\.com|x\.com/)) {
      await chrome.tabs.sendMessage(tab.id, { type: 'setBlockedTopics', blockedTopics });
    }
  } catch (error) {
    console.log('Could not update blocked topics:', error);
  }
}

// ============================================
// Event Listeners
// ============================================

debugToggle.addEventListener('change', handleDebugToggle);
topicsContainer.addEventListener('change', handleTopicChange);

// ============================================
// Initialization
// ============================================

async function init() {
  // Build topics checklist
  topicsContainer.innerHTML = '';
  TOPICS.forEach((topic) => {
    const id = `topic-${topic.id}`;
    const wrapper = document.createElement('label');
    wrapper.className = 'topic-row';
    wrapper.setAttribute('for', id);
    wrapper.innerHTML = `
      <input type="checkbox" id="${id}" value="${topic.id}">
      <span>${topic.label}</span>
    `;
    topicsContainer.appendChild(wrapper);
  });

  await loadSettings();
  await updateStatus();
  await updateStats();
  
  // Refresh stats periodically while popup is open
  setInterval(updateStats, 2000);
}

init();

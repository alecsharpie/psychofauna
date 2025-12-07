/**
 * Psychofauna ML Module
 *
 * Loads a compact text-classification transformer via Transformers.js (local import)
 * and runs it inside the MV3 offscreen document. Falls back to a simple heuristic
 * scorer if the model cannot be loaded.
 */

// ============================================
// Config
// ============================================

const REMOTE_MODEL_ID = 'Xenova/distilbert-base-uncased-finetuned-sst-2-english'; // sentiment: positive / negative
const LOCAL_MODEL_ID = 'sst2'; // folder name under models/
const LOCAL_MODEL_BASE = 'models';
const USE_LOCAL_MODEL = true; // prefer packaged model to avoid remote fetch/CORS
const FALLBACK_THRESHOLD = 0.7;

// Keywords for heuristic fallback
const RAGE_KEYWORDS = [
  'outrage', 'disgrace', 'worst', 'idiot', 'traitor', 'shame', 'hate',
  'destroy', 'corrupt', 'fraud', 'disgusting', 'criminal', 'liar',
  'pathetic', 'stupid', 'angry', 'rage', 'infuriating', 'furious',
  'boycott', 'never again', 'cancel', 'terrible', 'ruined', 'disaster'
];

const CLICKBAIT_PHRASES = [
  'you won\'t believe', 'this is why', 'no one is talking about',
  'what they don\'t want you to know', 'shocking', 'unbelievable'
];

// ============================================
// State
// ============================================

let modelReady = false;
let classifier = null;
let usingFallback = false;

// ============================================
// Helpers
// ============================================

let pipelineFn = null;
let envObj = null;
let transformersReadyPromise = null;

// Hard-disable Worker constructor in this offscreen document to prevent
// downstream libraries from spawning blob workers (which are blocked by CSP).
function disableWorkersHard() {
  if (typeof Worker !== 'undefined') {
    try {
      // eslint-disable-next-line no-global-assign
      Worker = undefined;
    } catch (_) {
      // ignore
    }
  }
}

function getModelId() {
  if (USE_LOCAL_MODEL) {
    return LOCAL_MODEL_ID;
  }
  return REMOTE_MODEL_ID;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function heuristicScore(text) {
  const original = text || '';
  const lower = original.toLowerCase();

  let score = 0;

  const keywordHits = RAGE_KEYWORDS.reduce((acc, kw) => acc + (lower.includes(kw) ? 1 : 0), 0);
  score += Math.min(keywordHits * 0.08, 0.5);

  const clickbaitHits = CLICKBAIT_PHRASES.reduce((acc, phrase) => acc + (lower.includes(phrase) ? 1 : 0), 0);
  score += Math.min(clickbaitHits * 0.12, 0.36);

  const exclamations = (original.match(/!/g) || []).length;
  if (exclamations >= 3) score += 0.1;

  const uppercaseChars = (original.match(/[A-Z]/g) || []).length;
  const letters = (original.match(/[A-Za-z]/g) || []).length || 1;
  const uppercaseRatio = uppercaseChars / letters;
  if (letters > 15 && uppercaseRatio > 0.35) score += 0.1;

  if (original.trim().length < 30) score *= 0.6;

  return clamp01(score);
}

async function configureTransformers() {
  if (transformersReadyPromise) return transformersReadyPromise;

  transformersReadyPromise = (async () => {
    // Nuke Worker before loading the library so it cannot snapshot the constructor.
    disableWorkersHard();

    const mod = await import(chrome.runtime.getURL('libs/transformers.min.js'));
    pipelineFn = mod.pipeline;
    envObj = mod.env;

    if (!pipelineFn || !envObj) {
      throw new Error('Failed to load Transformers.js exports');
    }

    // Configure to keep everything on the main thread and avoid blob workers/caches.
    envObj.allowLocalModels = USE_LOCAL_MODEL;
    envObj.localModelPath = chrome.runtime.getURL(LOCAL_MODEL_BASE);
    envObj.allowRemoteModels = !USE_LOCAL_MODEL;
    envObj.allowWebWorkers = false;
    envObj.useBrowserCache = false;
    envObj.backends ??= {};
    envObj.backends.onnx ??= {};
    envObj.backends.onnx.wasm ??= {};
    envObj.backends.onnx.wasm.proxy = false;
    envObj.backends.onnx.wasm.numThreads = 1;
    envObj.useFastTokenizer = false;
    envObj.remoteHost = 'https://huggingface.co';
    envObj.fetchOptions = { mode: 'cors', credentials: 'omit' };
  })().catch((err) => {
    transformersReadyPromise = null;
    throw err;
  });

  return transformersReadyPromise;
}

// ============================================
// Model Initialization
// ============================================

export async function initModel() {
  if (modelReady) return true;
  try {
    await configureTransformers();

    classifier = await pipelineFn('text-classification', getModelId(), {
      quantized: true,
      progress_callback: (progress) => {
        if (progress?.status === 'done') {
          console.log('[Psychofauna ML] Model download complete');
        }
      },
    });

    usingFallback = false;
    modelReady = true;
    console.log('[Psychofauna ML] Transformer model loaded:', getModelId());
    return true;
  } catch (error) {
    console.error('[Psychofauna ML] Failed to load transformer model, using fallback:', error);
    console.error('[Psychofauna ML] If using local mode, ensure model files exist under chrome-extension/models/' + LOCAL_MODEL_ID);
    usingFallback = true;
    modelReady = true; // still mark ready so the pipeline runs with heuristics
    return false;
  }
}

export function isModelReady() {
  return modelReady;
}

// ============================================
// Classification
// ============================================

export async function classifyBatch(items) {
  if (!modelReady) {
    throw new Error('Model not ready');
  }

  const safeItems = items || [];

  if (usingFallback || !classifier) {
    return safeItems.map((item) => {
      const text = (item.text || '').slice(0, 512);
      const score = heuristicScore(text);
      return {
        id: item.id,
        text: text.substring(0, 50),
        label: score >= FALLBACK_THRESHOLD ? 'ragebait' : 'safe',
        score,
        source: 'heuristic',
      };
    });
  }

  const outputs = [];
  for (const item of safeItems) {
    const text = (item.text || '').slice(0, 512);
    try {
      const result = await classifier(text, { topk: 1 });
      // result is an array like [{ label: 'World', score: 0.x }]
      const top = Array.isArray(result) ? result[0] : result;
      const score = top?.score ?? 0;
      const label = (top?.label || '').toLowerCase();

      outputs.push({
        id: item.id,
        text: text.substring(0, 50),
        label,
        score,
        source: USE_LOCAL_MODEL ? 'local-' + LOCAL_MODEL_ID : REMOTE_MODEL_ID,
      });
    } catch (err) {
      console.error('[Psychofauna ML] Error classifying item', item.id, err);
      const score = heuristicScore(text);
      outputs.push({
        id: item.id,
        text: text.substring(0, 50),
        label: score >= FALLBACK_THRESHOLD ? 'ragebait' : 'safe',
        score,
        source: usingFallback ? 'heuristic' : 'transformer+fallback',
        error: err?.message,
      });
    }
  }

  return outputs;
}

// ============================================
// Offscreen Message Bridge
// ============================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message?.type) {
    case 'offscreen-init': {
      initModel()
        .then((ready) => sendResponse({ ready }))
        .catch((err) =>
          sendResponse({ ready: false, error: err?.message || 'Model init failed' })
        );
      return true; // async response
    }

    case 'offscreen-classify': {
      (async () => {
        if (!modelReady) {
          const ok = await initModel();
          if (!ok) throw new Error('Model not ready');
        }

        const results = await classifyBatch(message.items);
        sendResponse({ batchId: message.batchId, results });
      })().catch((err) => {
        console.error('[Psychofauna ML] Offscreen classify failed:', err);
        sendResponse({ error: err?.message || 'Classification failed' });
      });
      return true; // async response
    }

    default:
      // Ignore unrelated messages
      return false;
  }
});

console.log('[Psychofauna ML] Offscreen ML module loaded');

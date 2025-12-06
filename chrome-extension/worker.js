/**
 * Psychofauna ML Module (MVP)
 *
 * For the MVP we replace the remote Transformers.js dependency with a simple
 * heuristic-based scorer that runs entirely locally inside the background
 * service worker. This keeps us compliant with MV3 (no remote code) and avoids
 * spawning a dedicated worker.
 */

// ============================================
// State
// ============================================

let modelReady = false;

// Keywords that often correlate with ragebait / inflammatory language
const RAGE_KEYWORDS = [
  'outrage', 'disgrace', 'worst', 'idiot', 'traitor', 'shame', 'hate',
  'destroy', 'corrupt', 'fraud', 'disgusting', 'criminal', 'liar',
  'pathetic', 'stupid', 'angry', 'rage', 'infuriating', 'furious',
  'boycott', 'never again', 'cancel', 'terrible', 'ruined', 'disaster'
];

// Phrases that tend to signal sensationalized framing
const CLICKBAIT_PHRASES = [
  'you won\'t believe', 'this is why', 'no one is talking about',
  'what they don\'t want you to know', 'shocking', 'unbelievable'
];

// ============================================
// Model Initialization (noop for heuristic)
// ============================================

export async function initModel() {
  // Heuristic model is instant; keep async for future swap to real model.
  modelReady = true;
  return true;
}

export function isModelReady() {
  return modelReady;
}

// ============================================
// Scoring Helpers
// ============================================

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function computeScore(text) {
  const original = text || '';
  const lower = original.toLowerCase();

  let score = 0;

  // Keyword hits
  const keywordHits = RAGE_KEYWORDS.reduce((acc, kw) => acc + (lower.includes(kw) ? 1 : 0), 0);
  score += Math.min(keywordHits * 0.08, 0.5);

  // Clickbait phrases
  const clickbaitHits = CLICKBAIT_PHRASES.reduce((acc, phrase) => acc + (lower.includes(phrase) ? 1 : 0), 0);
  score += Math.min(clickbaitHits * 0.12, 0.36);

  // Excessive punctuation / shouting
  const exclamations = (original.match(/!/g) || []).length;
  if (exclamations >= 3) score += 0.1;

  const uppercaseChars = (original.match(/[A-Z]/g) || []).length;
  const letters = (original.match(/[A-Za-z]/g) || []).length || 1;
  const uppercaseRatio = uppercaseChars / letters;
  if (letters > 15 && uppercaseRatio > 0.35) score += 0.1;

  // Length guard: very short texts are usually benign
  if (original.trim().length < 30) score *= 0.6;

  return clamp01(score);
}

// ============================================
// Classification
// ============================================

export async function classifyBatch(items) {
  if (!modelReady) {
    throw new Error('Model not ready');
  }

  return (items || []).map((item) => {
    const text = (item.text || '').slice(0, 512);
    const score = computeScore(text);

    return {
      id: item.id,
      text: text.substring(0, 50),
      label: score >= 0.7 ? 'ragebait' : 'safe',
      score,
    };
  });
}

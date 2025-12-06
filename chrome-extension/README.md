# Psychofauna Chrome Extension

A Chrome extension that uses local ML to detect and highlight potentially inflammatory "ragebait" content on Twitter/X.

## Status: MVP / Proof of Concept

This is an early development version that:
- ✅ Detects tweets on Twitter/X via MutationObserver
- ✅ Runs a small transformer classifier (fallback to heuristic) in the background service worker
- ✅ Highlights flagged content with a red border
- ✅ Shows debug overlay with classification scores

## Installation (Developer Mode)

1. Clone or download this folder
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked" and select this folder
5. Navigate to Twitter/X and you should see the extension working

## How It Works

```
Tweet appears in feed
       ↓
Content script detects it via MutationObserver  
       ↓
Text extracted, queued in batches
       ↓
Sent to background service worker transformer classifier (fallback to heuristic)
       ↓
Classification result returned
       ↓
Tweet highlighted if flagged (red border)
```

## Files

- `manifest.json` - Extension configuration
- `content.js` - Runs on Twitter/X, handles tweet detection
- `background.js` - Service worker, coordinates communication + classification
- `worker.js` - ML module (Transformers.js with heuristic fallback)
- `popup.html/js` - Extension popup UI
- `styles.css` - Styling for flagged content

## Current Model (MVP)

- Primary: `Xenova/distilbert-base-uncased-finetuned-sst-2-english` via Transformers.js (sentiment: Positive / Negative). You can hide labels in the popup.
- Fallback: heuristic scorer (keywords, shoutiness, clickbait phrases) if the model fails to load.

### Adding the local model (recommended to avoid CORS issues)
Some Chrome environments block service-worker fetches to Hugging Face. Bundle the model locally:

```
npx -y @xenova/transformers fetch Xenova/distilbert-base-uncased-finetuned-sst-2-english --dest ./chrome-extension/models/sst2
```

Then reload the extension. The ML module prefers the packaged model under `models/sst2` and falls back to remote fetch only if you disable local mode in `worker.js`.

## Next Steps

1. **Custom model training** - Train a model specifically on ragebait examples
2. **Better dataset** - Collect and label real ragebait content
3. **User feedback** - Let users mark false positives/negatives
4. **More sites** - Extend beyond Twitter/X
5. **Performance optimization** - WebGPU acceleration (remove wasm-unsafe-eval), smarter batching

## Development

The extension uses:
- Chrome Extension Manifest V3
- Background service worker for classification
- [Transformers.js](https://huggingface.co/docs/transformers.js) (local import expected at `libs/transformers.min.js`)

### Adding the local Transformers.js bundle
- Download `https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.1/dist/transformers.min.js`
- Place it at `chrome-extension/libs/transformers.min.js`
- The model weights will be fetched from Hugging Face on first run and cached by the browser.

### Hugging Face access token (for scripted downloads)
- Create a read-only token at https://huggingface.co/settings/tokens
- Export it before running the fetch script: `export HUGGING_FACE_HUB_TOKEN=hf_...`
- Run the helper: `sh scripts/fetch_hf_sst_model.sh` (downloads to `models/sst2`)

### Debug Mode

Debug mode (on by default) shows:
- A floating panel with stats
- Score overlays on each processed tweet
- Console logging

Toggle via the extension popup or set `CONFIG.debug = false` in `content.js`.

## License

MIT

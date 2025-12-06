# Psychofauna Chrome Extension

A Chrome extension that uses local ML to detect and highlight potentially inflammatory "ragebait" content on Twitter/X.

## Status: MVP / Proof of Concept

This is an early development version that:
- ✅ Detects tweets on Twitter/X via MutationObserver
- ✅ Runs a lightweight heuristic classifier in the background service worker
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
Sent to background service worker heuristic classifier
       ↓
Classification result returned
       ↓
Tweet highlighted if flagged (red border)
```

## Files

- `manifest.json` - Extension configuration
- `content.js` - Runs on Twitter/X, handles tweet detection
- `background.js` - Service worker, coordinates communication + classification
- `worker.js` - Heuristic classifier (MVP), swap to real model later
- `popup.html/js` - Extension popup UI
- `styles.css` - Styling for flagged content

## Current Model (MVP)

Using a lightweight heuristic scorer (keywords, shoutiness, clickbait phrases) to stay MV3-compliant without remote code. It catches:
- Obvious toxic/inflammatory language
- Sensational framing and excessive punctuation

It doesn't catch:
- Subtle emotional manipulation
- Politically charged but "polite" content
- Outrage-farming that uses dog whistles

## Next Steps

1. **Custom model training** - Train a model specifically on ragebait examples
2. **Better dataset** - Collect and label real ragebait content
3. **User feedback** - Let users mark false positives/negatives
4. **More sites** - Extend beyond Twitter/X
5. **Performance optimization** - WebGPU acceleration, smarter batching

## Development

The extension uses:
- Chrome Extension Manifest V3
- Background service worker for classification

### Debug Mode

Debug mode (on by default) shows:
- A floating panel with stats
- Score overlays on each processed tweet
- Console logging

Toggle via the extension popup or set `CONFIG.debug = false` in `content.js`.

## License

MIT

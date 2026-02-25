# CLAUDE.md — VocabLoop AI Assistant Guide

## Project Overview

VocabLoop is a Progressive Web App (PWA) for learning English vocabulary using a Spaced Repetition System (SRS) algorithm. It helps users master words through intelligent, timed reviews with gamification. The app supports offline usage, real human pronunciation, and includes multiple vocabulary decks for different learning levels.

- **Live site**: https://karryzhang.github.io/VocabLoop/
- **License**: MIT
- **Primary language**: Chinese (zh-CN) with bilingual UI (Chinese/English)

## Architecture

**Single-file monolithic PWA** — the entire frontend lives in `index.html` (~5000 lines) using Vue.js 2 via CDN. No build step required. Optional Node.js backend for authentication only.

### Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend framework | Vue.js 2 (CDN, not npm) |
| Styling | Vanilla CSS (no framework), CSS custom properties for theming |
| Storage | localStorage (keys: `srs_{deck}_v1`, `shared_dict_v1`, `srs_global_v1`) |
| Backend (optional) | Node.js (Vercel serverless function) |
| Auth | PBKDF2 SHA-512 hashing, base64url tokens |
| External APIs | Dictionary API (`api.dictionaryapi.dev`), optional Google Gemini |
| Data enrichment | Anthropic Claude API (Haiku model) |

## File Structure

```
VocabLoop/
├── index.html              # Main PWA app (~5000 lines, Vue.js 2 monolith)
├── account.html            # Login/registration page (standalone, no Vue)
├── manifest.json           # PWA manifest
├── api/
│   ├── auth.js             # Node.js auth endpoint (register/login)
│   └── sync.js             # Cloud sync endpoint (push/pull/merge learning data)
├── data/
│   ├── pet-words-1000.json       # Cambridge PET exam vocab (1000 words)
│   ├── daily-words-1000.json     # Daily conversational phrases (1000+ words)
│   ├── crypto-words-1000.json    # Crypto/finance terminology (1000 words)
│   └── ielts-words.json          # IELTS B2-C1 academic vocab (1400 words)
├── icons/                  # PWA icons (favicon, apple-touch, 192px, 512px)
├── scripts/
│   ├── enrich-vocab.js     # Claude API script to generate examples/notes
│   └── .enrich-progress.json
└── README.md               # Chinese-language project readme
```

## Development

### Running Locally

No build step. Open `index.html` directly in a browser, or serve with any static file server:

```bash
# Python
python3 -m http.server 8000

# Node
npx serve .
```

### Data Enrichment Script

Requires `ANTHROPIC_API_KEY` environment variable:

```bash
# Full enrichment (all files)
ANTHROPIC_API_KEY=sk-ant-xxx node scripts/enrich-vocab.js

# Single file
ANTHROPIC_API_KEY=sk-ant-xxx node scripts/enrich-vocab.js --file pet

# Dry run (mock data, no API calls)
node scripts/enrich-vocab.js --dry-run
```

### Deployment

Static hosting (GitHub Pages, Vercel, Netlify). The `api/auth.js` endpoint requires a Node.js runtime (Vercel serverless).

## Cloud Sync

Learning data is synced to the cloud via `api/sync.js` so users can continue across devices.

### Sync Architecture

- **Endpoint**: `POST /api/sync` with actions: `push`, `pull`, `merge`
- **Auth**: Token from `vocabloop_auth` localStorage (base64url-encoded)
- **Storage**: In-memory Map keyed by username (same pattern as auth.js; replace with DB for production)

### Data Synced

| Key | Synced | Reason |
|-----|--------|--------|
| `srs_{deck}_v1` | Yes | Core learning state (per-word SRS data) |
| `srs_global_v1` | Yes | Streaks, achievements, total reviews |
| `preferred_deck` | Yes | Last selected deck |
| `reading_history` | Yes | AI-generated reading articles |
| `shared_dict_v1` | No | Cache, can be rebuilt from API |
| `vocabloop_theme` | No | Device preference |
| `vocabloop_auth` | No | Device session |

### Merge Strategy

- **Per-word merge**: For SRS states, each word is compared independently; the version with the later `next` review timestamp wins (more recently studied)
- **Global state**: `dailyStreak` and `totalReviewed` take the max; `achievements` are unioned; `lastStudyDate` takes the later date
- **Reading history**: Deduplicated union, capped at 50 entries

### Sync Triggers

1. **On page load**: If logged in, full merge sync (cloud + local → merged result)
2. **After each save**: Debounced push (3s) after `saveState()` / `saveGlobal()`
3. **On visibility change**: Pull when returning from background
4. **Manual**: Sync button in header
5. **On login/register**: Merge sync in account.html before redirect

## Code Conventions

### JavaScript

- **Naming**: camelCase for methods/properties (`fetchDict`, `currentDeck`), UPPER_CASE for constants (`MAX_NEW_DAY`, `LEARN_STEPS`)
- **Vue 2 reactivity**: Use `this.$set()` for dynamic property addition
- **No modules**: All code is inline `<script>` tags; no import/export
- **account.html**: Pure vanilla JS (no Vue), self-contained

### CSS

- CSS custom properties (`--bg`, `--surface`, `--blue`, etc.) for theming
- Dark mode via `[data-theme="dark"]` attribute on `<html>`
- Mobile-first responsive design with `@media` queries
- BEM-like class naming (`.cb-again`, `.chip-new`, `.dw-quote-author`)
- Border radius convention: `--r: 16px` in index.html

### Data Schema

Vocabulary JSON files follow this structure:

```json
{
  "word": "accept",
  "zh": "接受",
  "pos": "",
  "ipa": "",
  "ex": "Please accept my apology.",
  "ex2": "She accepted the job offer immediately.",
  "note": ""
}
```

Fields: `word` (required), `zh` (Chinese translation, required), `pos` (part of speech), `ipa` (phonetic), `ex`/`ex2` (example sentences), `note` (abbreviation expansion for crypto terms).

### localStorage Keys

| Key | Purpose |
|-----|---------|
| `srs_{deck_id}_v1` | Per-deck SRS learning state |
| `shared_dict_v1` | Cached dictionary/pronunciation data |
| `srs_global_v1` | Cross-deck global state (achievements, streaks, XP) |
| `vocabloop_theme` | Theme preference (`light`/`dark`) |
| `vocabloop_auth` | Auth session (`{ username, token, at }`) |
| `vocabloop_sync_ts` | Timestamp of last successful cloud sync |

### SRS Algorithm (Custom SM-2 Variant)

- Stages: new → learning → young → mature → mastered
- Learning steps: [1min, 5min, 10min]
- Graduation interval: 1 day
- Easy interval: 4 days
- Maturity threshold: 21 days
- Max interval: 180 days (auto-master)
- Ease factor (EF): Base 2.5, adjusted per review quality

## Testing

No formal test framework. Test manually in the browser. The enrichment script supports `--dry-run` for safe testing.

## Key Patterns to Preserve

1. **Single-file architecture** — Do not split `index.html` into separate files
2. **No build tooling** — No webpack, Vite, or npm for the frontend
3. **CDN dependencies** — Vue.js loaded from CDN, not bundled
4. **Bilingual i18n** — All user-facing text must support both Chinese and English
5. **Offline-first** — PWA must work without network; localStorage is the primary data store
6. **Dark mode support** — All UI changes must respect both light and dark themes
7. **Mobile-first** — Design for mobile screens first, then scale up

## Commit Style

Commit messages follow conventional style in Chinese or English:
- `feat:` for new features
- `fix:` for bug fixes
- `style:` for visual/CSS changes
- Example: `feat: 音频预加载——队列前 N 张卡片提前缓冲，播放即时响应`

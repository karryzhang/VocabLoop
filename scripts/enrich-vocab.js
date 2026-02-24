#!/usr/bin/env node
/**
 * enrich-vocab.js — Add ex2 (inflected example) + note (abbreviation expansion) to all vocab files
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-xxx node scripts/enrich-vocab.js
 *   ANTHROPIC_API_KEY=sk-ant-xxx node scripts/enrich-vocab.js --file pet   # single file
 *   ANTHROPIC_API_KEY=sk-ant-xxx node scripts/enrich-vocab.js --dry-run    # no API calls, mock only
 *
 * Output: data/ files are updated in-place (originals backed up as .bak)
 * Progress: saved to scripts/.enrich-progress.json — re-run is safe (skips done words)
 */

const fs   = require('fs');
const path = require('path');

const API_KEY  = process.env.ANTHROPIC_API_KEY;
const DRY_RUN  = process.argv.includes('--dry-run');
const FILE_ARG = (() => { const i = process.argv.indexOf('--file'); return i !== -1 ? process.argv[i+1] : null; })();

if (!API_KEY && !DRY_RUN) {
    console.error('ERROR: Set ANTHROPIC_API_KEY env var.\nExample: ANTHROPIC_API_KEY=sk-ant-xxx node scripts/enrich-vocab.js');
    process.exit(1);
}

const ROOT        = path.join(__dirname, '..');
const DATA_DIR    = path.join(ROOT, 'data');
const PROGRESS_FILE = path.join(__dirname, '.enrich-progress.json');
const BATCH_SIZE  = 20;  // words per API call
const DELAY_MS    = 600; // ms between batches to stay within rate limits

// ── File config ──────────────────────────────────────────────────────────────
const FILES = [
    {
        id:   'pet',
        file: path.join(DATA_DIR, 'pet-words-1000.json'),
        mode: 'full',       // generate both ex AND ex2 (no existing examples)
    },
    {
        id:   'daily',
        file: path.join(DATA_DIR, 'daily-words-1000.json'),
        mode: 'ex2only',    // already has ex, only add ex2
    },
    {
        id:   'crypto',
        file: path.join(DATA_DIR, 'crypto-words-1000.json'),
        mode: 'ex2note',    // add ex2 + note for abbreviations
    },
];

// ── Load/save progress ───────────────────────────────────────────────────────
function loadProgress() {
    try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')); } catch { return {}; }
}
function saveProgress(p) {
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2));
}

// ── Anthropic API call ───────────────────────────────────────────────────────
async function callClaude(prompt) {
    if (DRY_RUN) {
        // Return mock data for testing
        return '[{"word":"mock","ex":"Mock sentence.","ex2":"The mock data was generated quickly."}]';
    }
    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'x-api-key': API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 4096,
            messages: [{ role: 'user', content: prompt }],
        }),
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`API ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    return data.content[0].text;
}

// ── Parse Claude's JSON response robustly ───────────────────────────────────
function parseJSON(text) {
    // Strip markdown code fences if present
    const cleaned = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
    // Find the JSON array
    const start = cleaned.indexOf('[');
    const end   = cleaned.lastIndexOf(']');
    if (start === -1 || end === -1) throw new Error('No JSON array found in response');
    return JSON.parse(cleaned.slice(start, end + 1));
}

// ── Build prompt for each mode ───────────────────────────────────────────────
function buildPrompt(batch, mode) {
    const wordList = batch.map(w => {
        const parts = [`${w.word} | ${w.zh}`];
        if (w.pos) parts.push(w.pos);
        if (w.ex)  parts.push(`existing_ex: "${w.ex}"`);
        return parts.join(' | ');
    }).join('\n');

    if (mode === 'full') {
        return `You are writing example sentences for an English vocabulary learning app (PET level).
For each word, produce TWO sentences in English:
1. "ex": A short, simple sentence using the BASE form of the word. Clear and direct.
2. "ex2": A natural sentence using an INFLECTED form (plural, past tense, 3rd-person -s, -ing, comparative, etc.). Slightly more complex.

Rules:
- Sentences should be realistic and contextually natural
- Keep sentences under 20 words each
- Do NOT use the Chinese translation in the sentence
- Return ONLY a JSON array, no other text

Format: [{"word":"...","ex":"...","ex2":"..."},...]

Words (word | Chinese | part-of-speech):
${wordList}`;
    }

    if (mode === 'ex2only') {
        return `You are writing example sentences for an English vocabulary learning app (daily conversational phrases).
For each word/phrase, produce ONE sentence in English:
1. "ex2": A natural sentence where the word/phrase appears in a realistic, slightly complex context — using an inflected or extended form when possible (e.g., past tense, progressive, with adverbials, embedded in a longer sentence).

Rules:
- The sentence should feel natural and conversational
- Keep it under 22 words
- Return ONLY a JSON array, no other text

Format: [{"word":"...","ex2":"..."},...]

Words (word | Chinese | existing example):
${wordList}`;
    }

    if (mode === 'ex2note') {
        return `You are writing example sentences for an English vocabulary learning app (crypto/finance).
For each term, produce:
1. "ex2": A natural English sentence using an INFLECTED or extended form (past tense, plural, participial phrase, etc.). Can include realistic crypto/finance context.
2. "note": ONLY if the word is an abbreviation or acronym (e.g. DeFi, NFT, PoW, DAO, HODL, CEX), write the full English expansion in the format "short for [Full Name]". Leave "note" empty string "" for regular words.

Rules:
- Sentences under 22 words
- note should be concise: "short for Decentralized Finance" not a full definition
- Return ONLY a JSON array, no other text

Format: [{"word":"...","ex2":"...","note":"..."},...]

Words (word | Chinese | existing example):
${wordList}`;
    }

    throw new Error(`Unknown mode: ${mode}`);
}

// ── Process one file ─────────────────────────────────────────────────────────
async function processFile(config, progress) {
    console.log(`\n── ${config.id.toUpperCase()} (${config.mode}) ──`);
    const words = JSON.parse(fs.readFileSync(config.file, 'utf8'));
    const done  = progress[config.id] || {};

    // Find words that still need enrichment
    const todo = words.filter(w => !done[w.word]);
    console.log(`  ${words.length} total, ${Object.keys(done).length} done, ${todo.length} remaining`);

    if (todo.length === 0) {
        console.log('  Already complete!');
        return words;
    }

    // Process in batches
    const enriched = { ...done };
    let batchNum = 0;
    for (let i = 0; i < todo.length; i += BATCH_SIZE) {
        const batch = todo.slice(i, i + BATCH_SIZE);
        batchNum++;
        const total = Math.ceil(todo.length / BATCH_SIZE);
        process.stdout.write(`  Batch ${batchNum}/${total} (words ${i+1}–${Math.min(i+BATCH_SIZE, todo.length)})... `);

        let attempts = 0;
        while (attempts < 3) {
            try {
                const prompt   = buildPrompt(batch, config.mode);
                const response = await callClaude(prompt);
                const results  = parseJSON(response);

                // Merge results
                for (const r of results) {
                    if (r.word) enriched[r.word] = r;
                }
                console.log('OK');
                break;
            } catch (e) {
                attempts++;
                if (attempts >= 3) {
                    console.log(`FAILED after 3 attempts: ${e.message}`);
                    // Continue with next batch rather than crashing
                } else {
                    console.log(`  Retry ${attempts}/3 (${e.message.slice(0, 60)})...`);
                    await sleep(2000 * attempts);
                }
            }
        }

        // Save progress after each batch
        progress[config.id] = enriched;
        saveProgress(progress);

        if (i + BATCH_SIZE < todo.length) await sleep(DELAY_MS);
    }

    // Merge enriched data back into words array
    const updated = words.map(w => {
        const e = enriched[w.word];
        if (!e) return w;
        const out = { ...w };
        if (e.ex  && !out.ex)  out.ex   = e.ex;
        if (e.ex2)              out.ex2  = e.ex2;
        if (e.note)             out.note = e.note;
        return out;
    });

    return updated;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log('VocabLoop — vocabulary enrichment script');
    console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no API calls)' : 'LIVE'}`);
    if (FILE_ARG) console.log(`Single file: ${FILE_ARG}`);

    const progress = loadProgress();
    const targets  = FILE_ARG ? FILES.filter(f => f.id === FILE_ARG) : FILES;

    if (targets.length === 0) {
        console.error(`No file matched --file ${FILE_ARG}. Options: pet, daily, crypto`);
        process.exit(1);
    }

    for (const config of targets) {
        const updated = await processFile(config, progress);

        // Backup original and write updated
        const bakPath = config.file + '.bak';
        if (!fs.existsSync(bakPath)) {
            fs.copyFileSync(config.file, bakPath);
            console.log(`  Backed up to ${path.basename(bakPath)}`);
        }
        fs.writeFileSync(config.file, JSON.stringify(updated, null, 2) + '\n');
        console.log(`  Saved ${config.file.split('/').pop()}`);
    }

    console.log('\nDone! Review the .bak files if you need to revert.');
    if (!DRY_RUN) {
        fs.unlinkSync(PROGRESS_FILE);
        console.log('Progress file cleaned up.');
    }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });

'use strict';
const fs   = require('fs');
const path = require('path');

const SAVE_PATH   = path.join(__dirname, '../save.json');
const SAVE_TMP    = SAVE_PATH + '.tmp';
const DEBOUNCE_MS = 400;

let _pending = null;   // latest state queued to write
let _timer   = null;   // debounce handle
let _writing = false;  // true while async write is in flight

function _doWrite() {
  if (_writing || _pending === null) return;
  _writing = true;
  const data = JSON.stringify(_pending, null, 2);
  _pending = null;

  // Atomic write: tmp → rename so a crash mid-write never corrupts the save
  fs.promises.writeFile(SAVE_TMP, data, 'utf-8')
    .then(() => fs.promises.rename(SAVE_TMP, SAVE_PATH))
    .then(() => process.stdout.write('  [Game saved.]\n'))
    .catch(err => process.stderr.write(`  [Save warning: ${err.message}]\n`))
    .finally(() => {
      _writing = false;
      if (_pending !== null) _doWrite(); // flush any save that arrived during write
    });
}

// Queue a save. Returns immediately — never blocks gameplay.
// Rapid calls within DEBOUNCE_MS are coalesced into a single write.
function saveGame(state) {
  _pending = state;
  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(() => { _timer = null; _doWrite(); }, DEBOUNCE_MS);
}

// Load is synchronous (only runs once at startup — blocking there is fine).
// Tries the main save first; falls back to .tmp if main is corrupt/missing.
function loadGame() {
  for (const p of [SAVE_PATH, SAVE_TMP]) {
    if (!fs.existsSync(p)) continue;
    try { return JSON.parse(fs.readFileSync(p, 'utf-8')); }
    catch { /* corrupt or partial write — try fallback */ }
  }
  return null;
}

function deleteSave() {
  for (const p of [SAVE_PATH, SAVE_TMP]) {
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch { /* best-effort cleanup */ }
  }
  _cancelPending();
}

// Synchronously flush any pending save (called on process exit / signals).
function _flushSync() {
  if (_timer) { clearTimeout(_timer); _timer = null; }
  if (_pending) {
    try {
      fs.writeFileSync(SAVE_TMP, JSON.stringify(_pending, null, 2), 'utf-8');
      fs.renameSync(SAVE_TMP, SAVE_PATH);
    } catch { /* best-effort on exit */ }
    _pending = null;
  }
}

// Cancel any queued save without writing (for tests / intentional discard).
function _cancelPending() {
  if (_timer) { clearTimeout(_timer); _timer = null; }
  _pending = null;
}

process.on('exit',    _flushSync);
process.on('SIGINT',  () => { _flushSync(); process.exit(0); });
process.on('SIGTERM', () => { _flushSync(); process.exit(0); });

module.exports = { saveGame, loadGame, deleteSave, _cancelPending };

'use strict';

const SAVE_KEY = 'litrpg.savedRun.v1';
const META_KEY = 'litrpg.meta.v1';
const { createDefaultMeta, normalizeMeta } = require('../engine/metaCore');

function getDefaultStorage() {
  try {
    return globalThis.localStorage || null;
  } catch (_error) {
    return null;
  }
}

function readJSON(key, fallback, storage = getDefaultStorage()) {
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_error) {
    return fallback;
  }
}

function writeJSON(key, value, storage = getDefaultStorage()) {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch (_error) {
    return false;
  }
}

function removeKey(key, storage = getDefaultStorage()) {
  if (!storage) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch (_error) {
    return false;
  }
}

function loadSavedRun(storage) {
  const saveData = readJSON(SAVE_KEY, null, storage);
  if (!saveData || !saveData.player || !saveData.currentSceneId) return null;
  return saveData;
}

function loadMeta(storage) {
  return normalizeMeta(readJSON(META_KEY, createDefaultMeta(), storage));
}

function saveMeta(meta, storage) {
  return writeJSON(META_KEY, normalizeMeta(meta), storage);
}

function saveRunSnapshot(saveData, storage) {
  return writeJSON(SAVE_KEY, saveData, storage);
}

function clearSavedRun(storage) {
  return removeKey(SAVE_KEY, storage);
}

module.exports = {
  SAVE_KEY,
  META_KEY,
  loadSavedRun,
  saveRunSnapshot,
  clearSavedRun,
  loadMeta,
  saveMeta,
};

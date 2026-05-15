'use strict';

const SAVE_KEY = 'litrpg.savedRun.v1';
const META_KEY = 'litrpg.meta.v1';
const { createDefaultMeta, normalizeMeta } = require('../engine/metaCore');
let nativeAsyncStorage;

function getDefaultStorage() {
  try {
    return globalThis.localStorage || null;
  } catch (_error) {
    return null;
  }
}

function getNativeAsyncStorage() {
  if (nativeAsyncStorage !== undefined) return nativeAsyncStorage;
  try {
    const module = require('@react-native-async-storage/async-storage');
    nativeAsyncStorage = module.default || module;
  } catch (_error) {
    nativeAsyncStorage = null;
  }
  return nativeAsyncStorage;
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

async function readJSONAsync(key, fallback, storage = getDefaultStorage()) {
  if (storage) return readJSON(key, fallback, storage);
  const asyncStorage = getNativeAsyncStorage();
  if (!asyncStorage) return fallback;
  try {
    const raw = await asyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_error) {
    return fallback;
  }
}

async function writeJSONAsync(key, value, storage = getDefaultStorage()) {
  if (storage) return writeJSON(key, value, storage);
  const asyncStorage = getNativeAsyncStorage();
  if (!asyncStorage) return false;
  try {
    await asyncStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (_error) {
    return false;
  }
}

async function removeKeyAsync(key, storage = getDefaultStorage()) {
  if (storage) return removeKey(key, storage);
  const asyncStorage = getNativeAsyncStorage();
  if (!asyncStorage) return false;
  try {
    await asyncStorage.removeItem(key);
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

async function loadSavedRunAsync(storage) {
  const saveData = await readJSONAsync(SAVE_KEY, null, storage);
  if (!saveData || !saveData.player || !saveData.currentSceneId) return null;
  return saveData;
}

function loadMeta(storage) {
  return normalizeMeta(readJSON(META_KEY, createDefaultMeta(), storage));
}

async function loadMetaAsync(storage) {
  return normalizeMeta(await readJSONAsync(META_KEY, createDefaultMeta(), storage));
}

function saveMeta(meta, storage) {
  return writeJSON(META_KEY, normalizeMeta(meta), storage);
}

function saveMetaAsync(meta, storage) {
  return writeJSONAsync(META_KEY, normalizeMeta(meta), storage);
}

function saveRunSnapshot(saveData, storage) {
  return writeJSON(SAVE_KEY, saveData, storage);
}

function saveRunSnapshotAsync(saveData, storage) {
  return writeJSONAsync(SAVE_KEY, saveData, storage);
}

function clearSavedRun(storage) {
  return removeKey(SAVE_KEY, storage);
}

function clearSavedRunAsync(storage) {
  return removeKeyAsync(SAVE_KEY, storage);
}

module.exports = {
  SAVE_KEY,
  META_KEY,
  loadSavedRun,
  loadSavedRunAsync,
  saveRunSnapshot,
  saveRunSnapshotAsync,
  clearSavedRun,
  clearSavedRunAsync,
  loadMeta,
  loadMetaAsync,
  saveMeta,
  saveMetaAsync,
};

const fs = require('fs');
const path = require('path');
const { createDefaultMeta } = require('./metaCore');

const META_PATH = path.join(__dirname, '../meta.json');

function loadMeta() {
  if (!fs.existsSync(META_PATH)) {
    return createDefaultMeta();
  }
  return JSON.parse(fs.readFileSync(META_PATH, 'utf-8'));
}

function saveMeta(meta) {
  fs.writeFileSync(META_PATH, JSON.stringify(meta, null, 2), 'utf-8');
}

function addCurrency(amount) {
  const meta = loadMeta();
  meta.currency += amount;
  saveMeta(meta);
  return meta;
}

module.exports = { loadMeta, saveMeta, addCurrency };

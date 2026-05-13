'use strict';

const ITEMS = require('../data/items.json');
const GEAR_SLOTS = ['weapon', 'armor', 'trinket'];
const GEAR_STAT_LABELS = {
  attack: 'ATK',
  defense: 'DEF',
  maxHp: 'HP',
  perception: 'PER',
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function describeItem(item) {
  if (!item) return 'Unknown item';
  if (item.effect === 'heal') return `Restores ${item.value} HP`;
  if (item.effect === 'cleanse') return 'Removes poison and burn';
  if (item.type === 'gear') {
    const traitText = item.trait?.text ? ` ${item.trait.text}` : '';
    return `${formatSlot(item.slot)}: ${formatGearStats(item.stats)}.${traitText}`.trim();
  }
  if (item.type === 'relic') return 'Relic';
  if (item.type === 'key_item') return 'Key item';
  return item.effect || item.type || 'Item';
}

function formatSlot(slot) {
  if (!slot) return 'Gear';
  return slot.charAt(0).toUpperCase() + slot.slice(1);
}

function formatGearStats(stats = {}) {
  const parts = Object.entries(stats)
    .filter(([, value]) => value)
    .map(([stat, value]) => `${value > 0 ? '+' : ''}${value} ${GEAR_STAT_LABELS[stat] || stat}`);
  return parts.length > 0 ? parts.join(', ') : 'No stat bonus';
}

function compareGearStats(candidateStats = {}, equippedStats = {}) {
  const statKeys = [...new Set(Object.keys(candidateStats).concat(Object.keys(equippedStats)))];
  const deltas = {};
  for (const stat of statKeys) {
    const delta = (candidateStats[stat] || 0) - (equippedStats[stat] || 0);
    if (delta) deltas[stat] = delta;
  }
  return deltas;
}

function ensureEquipment(player) {
  if (!player.equipment) player.equipment = {};
  for (const slot of GEAR_SLOTS) {
    if (!Object.prototype.hasOwnProperty.call(player.equipment, slot)) player.equipment[slot] = null;
  }
  return player.equipment;
}

function applyGearStats(player, stats = {}, direction = 1) {
  for (const [stat, rawAmount] of Object.entries(stats)) {
    const amount = (rawAmount || 0) * direction;
    if (stat === 'maxHp') {
      player.maxHp = Math.max(1, (player.maxHp || 1) + amount);
      player.hp = Math.max(0, Math.min(player.maxHp, (player.hp || 0) + amount));
    } else if (stat === 'attack') {
      player.attack = Math.max(1, (player.attack || 1) + amount);
    } else if (stat === 'defense' || stat === 'perception') {
      player[stat] = Math.max(0, (player[stat] || 0) + amount);
    }
  }
}

function getInventoryItems(player) {
  const equipment = ensureEquipment(player);
  const grouped = new Map();
  for (const [index, id] of (player.inventory || []).entries()) {
    if (!grouped.has(id)) {
      grouped.set(id, { id, count: 0, indices: [], firstIndex: index });
    }
    const stack = grouped.get(id);
    stack.count += 1;
    stack.indices.push(index);
  }

  return [...grouped.values()].map(stack => {
    const id = stack.id;
    const item = ITEMS[id] || { id, name: id, type: 'unknown', effect: 'none', value: 0 };
    const name = item.name || id;
    const equippedItemId = item.type === 'gear' && item.slot ? equipment[item.slot] : null;
    const equippedItem = equippedItemId ? ITEMS[equippedItemId] : null;
    const comparisonStats = item.type === 'gear' ? compareGearStats(item.stats || {}, equippedItem?.stats || {}) : {};
    return {
      id,
      index: stack.firstIndex,
      indices: stack.indices,
      count: stack.count,
      name,
      label: stack.count > 1 ? `${name} x${stack.count}` : name,
      type: item.type || 'unknown',
      slot: item.slot || null,
      stats: clone(item.stats || {}),
      trait: item.trait ? clone(item.trait) : null,
      traitText: item.trait?.text || null,
      effect: item.effect || 'none',
      value: item.value || 0,
      usable: item.type === 'consumable',
      equippable: item.type === 'gear',
      currentEquippedId: equippedItemId || null,
      currentEquippedName: equippedItem ? equippedItem.name || equippedItemId : null,
      comparisonStats,
      comparisonText: item.type === 'gear' ? formatGearStats(comparisonStats) : null,
      description: describeItem(item),
    };
  });
}

function getEquippedItems(player) {
  const equipment = ensureEquipment(player);
  return GEAR_SLOTS.map(slot => {
    const itemId = equipment[slot];
    const item = itemId ? ITEMS[itemId] : null;
    return {
      slot,
      itemId: itemId || null,
      name: item ? item.name || itemId : 'Empty',
      description: item ? describeItem(item) : 'No gear equipped',
      stats: item ? clone(item.stats || {}) : {},
      trait: item?.trait ? clone(item.trait) : null,
      traitText: item?.trait?.text || null,
    };
  });
}

function equipGearItem(player, itemId, options = {}) {
  const item = ITEMS[itemId];
  if (!item || item.type !== 'gear' || !GEAR_SLOTS.includes(item.slot)) return false;
  ensureEquipment(player);

  const previousItemId = player.equipment[item.slot];
  if (previousItemId) {
    const previousItem = ITEMS[previousItemId];
    applyGearStats(player, previousItem?.stats || {}, -1);
    if (options.returnPreviousToInventory) {
      if (!player.inventory) player.inventory = [];
      player.inventory.push(previousItemId);
    }
  }

  applyGearStats(player, item.stats || {}, 1);
  player.equipment[item.slot] = itemId;
  return true;
}

function equipInventoryItem(inputPlayer, itemId) {
  const player = clone(inputPlayer);
  const item = ITEMS[itemId];
  const inventoryIndex = (player.inventory || []).indexOf(itemId);
  ensureEquipment(player);

  if (inventoryIndex === -1) {
    return {
      ok: false,
      reason: 'item_not_found',
      player,
      events: [{ type: 'equip_failed', itemId, reason: 'item_not_found' }],
    };
  }

  if (!item || item.type !== 'gear' || !GEAR_SLOTS.includes(item.slot)) {
    return {
      ok: false,
      reason: 'not_gear',
      player,
      events: [{ type: 'equip_failed', itemId, reason: 'not_gear' }],
    };
  }

  player.inventory.splice(inventoryIndex, 1);
  const previousItemId = player.equipment[item.slot];
  equipGearItem(player, itemId, { returnPreviousToInventory: true });

  return {
    ok: true,
    player,
    events: [{
      type: 'item_equipped',
      itemId,
      name: item.name || itemId,
      slot: item.slot,
      replacedItemId: previousItemId || null,
    }],
  };
}

function useInventoryItem(inputPlayer, itemId) {
  const player = clone(inputPlayer);
  const item = ITEMS[itemId];
  const inventoryIndex = (player.inventory || []).indexOf(itemId);

  if (inventoryIndex === -1) {
    return {
      ok: false,
      reason: 'item_not_found',
      player,
      events: [{ type: 'item_use_failed', itemId, reason: 'item_not_found' }],
    };
  }

  if (!item || item.type !== 'consumable') {
    return {
      ok: false,
      reason: 'not_consumable',
      player,
      events: [{ type: 'item_use_failed', itemId, reason: 'not_consumable' }],
    };
  }

  const events = [];
  const used = {
    type: 'item_used',
    itemId,
    name: item.name || itemId,
    effect: item.effect,
  };

  if (item.effect === 'heal') {
    const healed = Math.min((player.maxHp || 0) - (player.hp || 0), item.value || 0);
    player.hp = Math.min(player.maxHp || player.hp || 0, (player.hp || 0) + healed);
    used.healed = healed;
  } else if (item.effect === 'cleanse') {
    const before = (player.statusEffects || []).length;
    player.statusEffects = (player.statusEffects || []).filter(effect => effect.type !== 'poison' && effect.type !== 'burn');
    used.removed = before - player.statusEffects.length;
  } else {
    return {
      ok: false,
      reason: 'unsupported_effect',
      player,
      events: [{ type: 'item_use_failed', itemId, reason: 'unsupported_effect' }],
    };
  }

  player.inventory.splice(inventoryIndex, 1);
  events.push(used);
  return { ok: true, player, events };
}

module.exports = {
  ITEMS,
  ensureEquipment,
  equipGearItem,
  getEquippedItems,
  getInventoryItems,
  equipInventoryItem,
  useInventoryItem,
};

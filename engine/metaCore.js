'use strict';

const CLASSES = require('../data/classes.json');

const DEFAULT_META = {
  currency: 0,
  upgrades: {
    hp: 0,
    atk: 0,
    def: 0,
    per: 0,
    rewardMultiplier: 0,
  },
  unlockedClasses: ['fighter', 'mage', 'rogue'],
  unlockedAbilities: ['power_strike', 'guard'],
};

const UPGRADE_DEFS = [
  { stat: 'hp', label: 'HP+', cost: 10, amount: 5 },
  { stat: 'atk', label: 'ATK+', cost: 10, amount: 2 },
  { stat: 'def', label: 'DEF+', cost: 10, amount: 1 },
  { stat: 'per', label: 'PER+', cost: 10, amount: 1 },
  { stat: 'rewardMultiplier', label: 'Reward+', cost: 20, amount: 5 },
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createDefaultMeta() {
  return clone(DEFAULT_META);
}

function normalizeMeta(meta = {}) {
  const base = createDefaultMeta();
  return {
    currency: Number.isFinite(meta.currency) ? meta.currency : base.currency,
    upgrades: {
      ...base.upgrades,
      ...(meta.upgrades || {}),
    },
    unlockedClasses: Array.isArray(meta.unlockedClasses)
      ? [...new Set(meta.unlockedClasses)]
      : base.unlockedClasses,
    unlockedAbilities: Array.isArray(meta.unlockedAbilities)
      ? [...new Set(meta.unlockedAbilities)]
      : base.unlockedAbilities,
  };
}

function awardMetaCurrency(meta, amount) {
  const next = normalizeMeta(meta);
  next.currency += Math.max(0, amount || 0);
  return next;
}

function getFloorCurrencyReward(meta, floor = 1) {
  const normalized = normalizeMeta(meta);
  const completedFloor = Math.max(1, floor || 1);
  const baseReward = completedFloor * 15;
  const bonusReward = (normalized.upgrades.rewardMultiplier || 0) * 5;
  return baseReward + bonusReward;
}

function getUpgradeDef(stat) {
  return UPGRADE_DEFS.find(upgrade => upgrade.stat === stat) || null;
}

function purchaseUpgrade(meta, stat) {
  const upgrade = getUpgradeDef(stat);
  const next = normalizeMeta(meta);
  if (!upgrade) return { ok: false, reason: 'unknown_upgrade', meta: next };
  if (next.currency < upgrade.cost) return { ok: false, reason: 'not_enough_currency', meta: next };
  next.currency -= upgrade.cost;
  next.upgrades[upgrade.stat] = (next.upgrades[upgrade.stat] || 0) + 1;
  return { ok: true, upgrade, meta: next };
}

function purchaseAbility(meta, classId, abilityId) {
  const next = normalizeMeta(meta);
  const gameClass = CLASSES[classId];
  if (!gameClass || !next.unlockedClasses.includes(gameClass.id)) {
    return { ok: false, reason: 'class_locked', meta: next };
  }

  if (!(gameClass.abilityPool || []).includes(abilityId)) {
    return { ok: false, reason: 'ability_not_in_class', meta: next };
  }

  if ((gameClass.defaultAbilityIds || []).includes(abilityId) || next.unlockedAbilities.includes(abilityId)) {
    return { ok: false, reason: 'already_unlocked', meta: next };
  }

  const cost = gameClass.unlockCosts?.[abilityId];
  if (!Number.isFinite(cost)) {
    return { ok: false, reason: 'not_unlockable', meta: next };
  }

  if (next.currency < cost) {
    return { ok: false, reason: 'not_enough_currency', meta: next };
  }

  next.currency -= cost;
  next.unlockedAbilities.push(abilityId);
  return { ok: true, classId: gameClass.id, abilityId, cost, meta: next };
}

function applyMetaUpgrades(player, meta) {
  const normalized = normalizeMeta(meta);
  player.maxHp += (normalized.upgrades.hp || 0) * 5;
  player.hp = player.maxHp;
  player.attack += (normalized.upgrades.atk || 0) * 2;
  player.defense += (normalized.upgrades.def || 0) * 1;
  player.perception += (normalized.upgrades.per || 0) * 1;
  return player;
}

module.exports = {
  DEFAULT_META,
  UPGRADE_DEFS,
  createDefaultMeta,
  normalizeMeta,
  awardMetaCurrency,
  getFloorCurrencyReward,
  purchaseUpgrade,
  purchaseAbility,
  applyMetaUpgrades,
};

'use strict';

const ABILITIES = require('../data/abilities.json');
const CLASSES = require('../data/classes.json');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function abilityDescription(ability) {
  if (!ability) return '';
  if (ability.type === 'damage_bonus') return `Deal +${ability.value || 0} damage.`;
  if (ability.type === 'damage_reduce') return 'Brace for a reduced enemy hit.';
  if (ability.type === 'berserk') return `Spend ${ability.hpCost || 0} HP to deal +${ability.value || 0} damage.`;
  if (ability.type === 'heal') return `Restore ${ability.value || 0} HP.`;
  if (ability.type === 'status_attack') {
    const status = ability.status?.type ? ` and apply ${ability.status.type}` : '';
    return `Deal ${ability.damage || 0} damage${status}.`;
  }
  return 'Use this combat ability.';
}

function abilityFromId(id) {
  const ability = ABILITIES[id];
  if (!ability) return null;
  return { ...clone(ability), currentCooldown: 0 };
}

function getClass(classId = 'fighter') {
  return CLASSES[classId] || CLASSES.fighter;
}

function getClassOptions(meta, selectedClassId = 'fighter') {
  const unlocked = new Set(meta.unlockedClasses || ['fighter']);
  return Object.values(CLASSES)
    .filter(gameClass => unlocked.has(gameClass.id))
    .map(gameClass => ({
      id: gameClass.id,
      name: gameClass.name,
      description: gameClass.description,
      statMods: clone(gameClass.statMods || {}),
      selected: gameClass.id === getClass(selectedClassId).id,
    }));
}

function getClassAbilityIds(meta, selectedClassId = 'fighter') {
  const gameClass = getClass(selectedClassId);
  const unlocked = new Set(meta.unlockedAbilities || []);
  const classDefault = gameClass.defaultAbilityIds || [];
  return gameClass.abilityPool.filter(id => unlocked.has(id) || classDefault.includes(id));
}

function getUnlockedAbilityOptions(unlockedAbilityIds = [], selectedClassId = null) {
  const ids = selectedClassId
    ? unlockedAbilityIds.filter(id => getClass(selectedClassId).abilityPool.includes(id))
    : unlockedAbilityIds;
  return ids
    .map(id => abilityFromId(id))
    .filter(Boolean)
    .map(ability => ({
      id: ability.id,
      name: ability.name || ability.id,
      type: ability.type,
      description: abilityDescription(ability),
      cooldown: ability.cooldown || 0,
    }));
}

function getAbilityUnlockOptions(meta, selectedClassId = 'fighter') {
  const gameClass = getClass(selectedClassId);
  const unlocked = new Set(meta.unlockedAbilities || []);
  const defaults = new Set(gameClass.defaultAbilityIds || []);
  const unlockCosts = gameClass.unlockCosts || {};
  return Object.keys(unlockCosts)
    .filter(id => (gameClass.abilityPool || []).includes(id))
    .map(id => {
      const ability = abilityFromId(id);
      if (!ability) return null;
      const owned = defaults.has(id) || unlocked.has(id);
      return {
        id: ability.id,
        name: ability.name || ability.id,
        type: ability.type,
        description: abilityDescription(ability),
        cooldown: ability.cooldown || 0,
        cost: unlockCosts[id],
        owned,
        locked: !owned,
      };
    })
    .filter(Boolean);
}

function pickRunAbilities(unlockedAbilityIds = [], selectedAbilityIds = [], limit = 2, selectedClassId = null) {
  const allowedIds = selectedClassId
    ? unlockedAbilityIds.filter(id => getClass(selectedClassId).abilityPool.includes(id))
    : unlockedAbilityIds;
  const unlocked = new Set(allowedIds);
  const pickedIds = selectedAbilityIds.filter(id => unlocked.has(id));
  const fallbackIds = allowedIds.filter(id => !pickedIds.includes(id));
  return pickedIds
    .concat(fallbackIds)
    .slice(0, limit)
    .map(id => abilityFromId(id))
    .filter(Boolean);
}

function getCombatAbilities(player) {
  return (player.abilities || []).map(ability => {
    const currentCooldown = ability.currentCooldown || 0;
    return {
      id: ability.id,
      name: ability.name || ability.id,
      type: ability.type,
      description: abilityDescription(ability),
      cooldown: ability.cooldown || 0,
      currentCooldown,
      ready: currentCooldown <= 0,
    };
  });
}

function tickAbilityCooldowns(player, exceptId) {
  for (const ability of player.abilities || []) {
    if (ability.id === exceptId) continue;
    if ((ability.currentCooldown || 0) > 0) {
      ability.currentCooldown -= 1;
    }
  }
}

module.exports = {
  abilityDescription,
  getClass,
  getClassAbilityIds,
  getClassOptions,
  getAbilityUnlockOptions,
  getUnlockedAbilityOptions,
  pickRunAbilities,
  getCombatAbilities,
  tickAbilityCooldowns,
};

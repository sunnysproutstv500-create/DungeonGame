'use strict';

const { applyStatus } = require('./statusEffects');
const { gainXP } = require('./state');

function evaluateCondition(condition, player) {
  if (!condition) return true;

  if (condition.hasItem !== undefined) {
    return (player.inventory || []).includes(condition.hasItem);
  }

  if (condition.perception !== undefined) {
    return (player.perception || 0) >= condition.perception;
  }

  if (condition.stat && condition.operator !== undefined && condition.value !== undefined) {
    const statMap = {
      hp: player.hp,
      atk: player.attack,
      def: player.defense,
      level: player.level,
    };
    const val = statMap[condition.stat];
    if (val === undefined) return false;
    switch (condition.operator) {
      case '>': return val > condition.value;
      case '<': return val < condition.value;
      case '>=': return val >= condition.value;
      case '<=': return val <= condition.value;
      case '==': return val === condition.value;
      default: return false;
    }
  }

  return true;
}

function getAvailableChoices(scene, player) {
  if (!scene.choices) return [];
  const used = (player.usedChoices || {})[scene.id] || [];
  return scene.choices.filter(choice => {
    if (choice.once && used.includes(choice.text)) return false;
    if (!evaluateCondition(choice.condition, player)) return false;
    if (!choice.requires) return true;
    if (choice.requires.items && !choice.requires.items.every(itemId => player.inventory.includes(itemId))) return false;
    if (choice.requires.item && !player.inventory.includes(choice.requires.item)) return false;
    if (choice.requires.route && player.route !== choice.requires.route) return false;
    if (choice.requires.gold && player.gold < choice.requires.gold) return false;
    return true;
  });
}

function applyEffect(player, effect) {
  if (!effect) return;

  if (effect.damage) {
    const dmg = Math.min(effect.damage, player.hp);
    player.hp -= dmg;
  }

  if (effect.heal) {
    const healed = Math.min(effect.heal, player.maxHp - player.hp);
    player.hp += healed;
  }

  if (effect.giveItem) {
    player.inventory.push(effect.giveItem);
  }

  if (effect.giveGold) {
    player.gold += effect.giveGold;
  }

  if (effect.giveXP) {
    gainXP(player, effect.giveXP);
  }

  if (effect.spendGold) {
    player.gold = Math.max(0, player.gold - effect.spendGold);
  }

  if (effect.setRoute) {
    player.route = effect.setRoute;
  }

  if (effect.applyStatus) {
    if (!player.statusEffects) player.statusEffects = [];
    applyStatus(player, effect.applyStatus);
  }
}

function isRoomCleared(scene, player) {
  const allOnce = (scene.choices || []).filter(c => c.once);
  if (allOnce.length === 0) return false;
  const accessible = allOnce.filter(c => evaluateCondition(c.condition, player));
  if (accessible.length === 0) return false;
  const used = (player.usedChoices || {})[scene.id] || [];
  return accessible.every(c => used.includes(c.text));
}

module.exports = { evaluateCondition, getAvailableChoices, applyEffect, isRoomCleared };

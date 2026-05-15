const fs = require('fs');
const path = require('path');
const { gainXP } = require('./state');
const { applyStatus, fmtEffects } = require('./statusEffects');

function loadScenes() {
  const scenesPath = path.join(__dirname, '../data/scenes.json');
  const raw = fs.readFileSync(scenesPath, 'utf-8');
  return JSON.parse(raw);
}

function displayScene(scene, player) {
  console.log('\n' + '='.repeat(60));
  console.log(`  ${scene.title.toUpperCase()}`);
  console.log('='.repeat(60));
  console.log(`\n${scene.text}\n`);
  if (player) {
    const fx = fmtEffects(player);
    if (fx) console.log(`  Active effects: ${fx}\n`);
  }
}

function evaluateCondition(condition, player) {
  if (!condition) return true;

  if (condition.hasItem !== undefined) {
    return (player.inventory || []).includes(condition.hasItem);
  }

  if (condition.perception !== undefined) {
    return (player.perception || 0) >= condition.perception;
  }

  if (condition.contractsCompleted !== undefined) {
    return (player.contractsCompleted || 0) >= condition.contractsCompleted;
  }

  if (condition.stat && condition.operator !== undefined && condition.value !== undefined) {
    const statMap = {
      hp:    player.hp,
      atk:   player.attack,
      def:   player.defense,
      level: player.level,
    };
    const val = statMap[condition.stat];
    if (val === undefined) return false;
    switch (condition.operator) {
      case '>':  return val >  condition.value;
      case '<':  return val <  condition.value;
      case '>=': return val >= condition.value;
      case '<=': return val <= condition.value;
      case '==': return val === condition.value;
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
    console.log(`  You take ${dmg} damage. (HP: ${player.hp}/${player.maxHp})`);
  }

  if (effect.heal) {
    const healed = Math.min(effect.heal, player.maxHp - player.hp);
    player.hp += healed;
    console.log(`  You recover ${healed} HP. (HP: ${player.hp}/${player.maxHp})`);
  }

  if (effect.giveItem) {
    player.inventory.push(effect.giveItem);
    console.log(`  You obtained: ${effect.giveItem}`);
  }

  if (Array.isArray(effect.giveItems)) {
    for (const itemId of effect.giveItems) {
      player.inventory.push(itemId);
      console.log(`  You obtained: ${itemId}`);
    }
  }

  if (effect.giveGold) {
    player.gold += effect.giveGold;
    console.log(`  You found ${effect.giveGold} gold.`);
  }

  if (effect.giveXP) {
    gainXP(player, effect.giveXP);
  }

  if (effect.spendGold) {
    player.gold = Math.max(0, player.gold - effect.spendGold);
    console.log(`  You spend ${effect.spendGold} gold.`);
  }

  if (effect.setRoute) {
    player.route = effect.setRoute;
  }

  if (effect.completeContract) {
    if (!Array.isArray(player.completedContracts)) player.completedContracts = [];
    if (!player.completedContracts.includes(effect.completeContract)) {
      player.completedContracts.push(effect.completeContract);
    }
    player.contractsCompleted = player.completedContracts.length;
    console.log(`  Contract complete: ${effect.completeContract}. (${player.contractsCompleted}/5)`);
  }

  if (effect.applyStatus) {
    if (!player.statusEffects) player.statusEffects = [];
    applyStatus(player, effect.applyStatus);
    const t = effect.applyStatus.type;
    const tag = t === 'poison' ? '☠️ ' : t === 'burn' ? '🔥 ' : '';
    console.log(`  ${tag}You are now ${t} (${effect.applyStatus.duration} turns).`);
  }
}

function isRoomCleared(scene, player) {
  const allOnce = (scene.choices || []).filter(c => c.once);
  if (allOnce.length === 0) return false;
  // Only count once-choices the player can actually access (condition met)
  const accessible = allOnce.filter(c => evaluateCondition(c.condition, player));
  if (accessible.length === 0) return false;
  const used = (player.usedChoices || {})[scene.id] || [];
  return accessible.every(c => used.includes(c.text));
}

function getPerceptionHint(scene, player) {
  if (!scene.choices) return;
  const per = player.perception || 0;
  const hidden = scene.choices.filter(c => c.condition && c.condition.perception !== undefined);
  for (const c of hidden) {
    const req = c.condition.perception;
    if (per === req - 1) {
      console.log(`  (Something about this place feels off — like you're missing something.)`);
      return;
    }
  }
}

module.exports = { loadScenes, displayScene, getAvailableChoices, applyEffect, evaluateCondition, getPerceptionHint, isRoomCleared };

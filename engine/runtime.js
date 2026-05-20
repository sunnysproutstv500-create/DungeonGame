'use strict';

const { createPlayer, gainXP } = require('./state');
const { getAvailableChoices, applyEffect, isRoomCleared } = require('./sceneCore');
const { generateFloor, filterChoices } = require('./floorGen');
const { getFloorMap, visitRoom, revealConnected } = require('./map');
const { completeFloor, endRun } = require('./runLifecycle');
const { applyMetaUpgrades, createDefaultMeta, normalizeMeta } = require('./metaCore');
const { ensureEquipment, equipGearItem, equipInventoryItem, getEquippedItems, getInventoryItems, useInventoryItem } = require('./itemCore');
const { applyStatus, getEffAtk, getEffDef } = require('./statusEffects');
const { getAbilityUnlockOptions, getClass, getClassAbilityIds, getClassOptions, getCombatAbilities, getUnlockedAbilityOptions, pickRunAbilities, tickAbilityCooldowns } = require('./abilityCore');
const SCENES = require('../data/scenes.json');
const ITEMS = require('../data/items.json');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function withConsoleMuted(fn) {
  const originalLog = console.log;
  try {
    console.log = () => {};
    return fn();
  } finally {
    console.log = originalLog;
  }
}

function getItemName(itemId) {
  return ITEMS[itemId]?.name || itemId;
}

const PROGRESS_ITEMS = {
  security_route_token: 'Security route authorization logged.',
  ward_route_token: 'Ward route authorization logged.',
  security_clearance: 'Warden door security clearance found.',
  warden_override: 'Warden maintenance override found.',
  overseer_code: 'Service corridor code found.',
  cipher_fragment: 'Alternate completion proof secured.',
  warden_badge: 'Combat completion proof secured.',
  f4_gold_key: 'Gold Vault Key secured.',
  f4_blood_key: 'Blood Vault Key secured.',
  f4_signal_key: 'Signal Vault Key secured.',
  f4_auction_contract: 'Sponsor auction counter secured.',
  f4_blood_writ: 'Blood Writ counter secured.',
  f4_signal_patch: 'Signal Patch counter secured.',
  f5_combat_protocol: 'Combat Protocol Clearance secured.',
  f5_memory_protocol: 'Memory Protocol Clearance secured.',
  f5_debt_protocol: 'Debt Protocol Clearance secured.',
  f5_identity_protocol: 'Identity Protocol Clearance secured.',
  f5_combat_override: 'Combat Override Sigil will bend the Rulekeeper.',
  f5_memory_override: 'Memory Override Sigil will bend the Rulekeeper.',
  f5_debt_override: 'Debt Override Sigil will bend the Rulekeeper.',
  f5_identity_override: 'Identity Override Sigil will bend the Rulekeeper.',
  f6_glass_anchor: 'Glass Anchor Shard stabilized.',
  f6_root_anchor: 'Root Anchor Shard stabilized.',
  f6_road_anchor: 'Road Anchor Shard stabilized.',
  f6_glass_anomaly: 'Glass Anomaly Mark will distort the Outside Thing.',
  f6_root_anomaly: 'Root Anomaly Mark will distort the Outside Thing.',
  f6_road_anomaly: 'Road Anomaly Mark will distort the Outside Thing.',
  f7_forager_trust: 'Forager Trust Bond earned.',
  f7_scout_trust: 'Scout Trust Bond earned.',
  f7_healer_trust: 'Healer Trust Bond earned.',
  f7_builder_trust: 'Builder Trust Bond earned.',
  f7_forager_favor: 'Forager Favor secured for the Claimant fight.',
  f7_scout_favor: 'Scout Favor secured for the Claimant fight.',
  f7_healer_favor: 'Healer Favor secured for the Claimant fight.',
  f7_builder_favor: 'Builder Favor secured for the Claimant fight.',
  f8_scent_trap: 'Scent Trap set for the Pale Stalker hunt.',
  f8_snare_trap: 'Snare Trap set for the Pale Stalker hunt.',
  f8_echo_trap: 'Echo Trap set for the Pale Stalker hunt.',
  f8_sight_trap: 'Sight Trap set for the Pale Stalker hunt.',
  f8_scent_edge: "Scent Hunter's Edge secured for the Pale Stalker fight.",
  f8_snare_edge: "Snare Hunter's Edge secured for the Pale Stalker fight.",
  f8_echo_edge: "Echo Hunter's Edge secured for the Pale Stalker fight.",
  f8_sight_edge: "Sight Hunter's Edge secured for the Pale Stalker fight.",
  f9_glass_root: 'Glass Root awakened in the Root Cathedral.',
  f9_blood_root: 'Blood Root awakened in the Root Cathedral.',
  f9_ash_root: 'Ash Root awakened in the Root Cathedral.',
  f9_glass_boon: 'Glass Boon secured for the Buried Saint fight.',
  f9_blood_boon: 'Blood Boon secured for the Buried Saint fight.',
  f9_ash_boon: 'Ash Boon secured for the Buried Saint fight.',
};

function getProgressMessageForItem(itemId) {
  return PROGRESS_ITEMS[itemId] || null;
}

function describeChoiceEffect(effect, beforePlayer, afterPlayer) {
  if (!effect) return null;
  const parts = [];

  if (effect.damage) {
    const damage = Math.max(0, (beforePlayer.hp || 0) - (afterPlayer.hp || 0));
    if (damage > 0) parts.push(`You take ${damage} damage.`);
  }

  if (effect.heal) {
    const healed = Math.max(0, (afterPlayer.hp || 0) - (beforePlayer.hp || 0));
    if (healed > 0) parts.push(`You recover ${healed} HP.`);
    else parts.push('You are already at full HP.');
  }

  if (effect.giveItem) {
    parts.push(`You obtained ${getItemName(effect.giveItem)}.`);
    const progress = getProgressMessageForItem(effect.giveItem);
    if (progress) parts.push(`Progress: ${progress}`);
  }

  if (Array.isArray(effect.giveItems)) {
    for (const itemId of effect.giveItems) {
      parts.push(`You obtained ${getItemName(itemId)}.`);
      const progress = getProgressMessageForItem(itemId);
      if (progress) parts.push(`Progress: ${progress}`);
    }
  }

  if (effect.giveGold) {
    parts.push(`You found ${effect.giveGold} gold.`);
  }

  if (effect.giveXP) {
    const gained = Math.max(0, (afterPlayer.xp || 0) - (beforePlayer.xp || 0));
    parts.push(`You gained ${effect.giveXP} XP.`);
    if ((afterPlayer.level || 1) > (beforePlayer.level || 1)) {
      parts.push(`Level up: ${beforePlayer.level} -> ${afterPlayer.level}.`);
    } else if (gained !== effect.giveXP) {
      parts.push(`XP progress: ${afterPlayer.xp}/${afterPlayer.xpToNext}.`);
    }
  }

  if (effect.spendGold) {
    parts.push(`You spent ${effect.spendGold} gold.`);
  }

  if (effect.setRoute) {
    const routeName = effect.setRoute === 'security' ? 'security route' : effect.setRoute === 'ward' ? 'ward route' : effect.setRoute;
    parts.push(`You commit to the ${routeName}.`);
  }

  if (effect.completeContract) {
    parts.push(`Contract complete: ${effect.completeContract}.`);
    parts.push(`Contracts completed: ${afterPlayer.contractsCompleted || 0}/5.`);
  }

  if (effect.applyStatus) {
    parts.push(`You are now ${effect.applyStatus.type} for ${effect.applyStatus.duration} turns.`);
  }

  return parts.length > 0 ? parts.join(' ') : null;
}

function formatEffectItem(effect) {
  return effect?.giveItem ? getItemName(effect.giveItem) : null;
}

function getChoiceRiskLabel(choice) {
  const risks = [];
  const effect = choice.effect || {};
  if (effect.damage) risks.push(`${effect.damage} HP`);
  if (effect.applyStatus?.type) risks.push(effect.applyStatus.type);
  const next = choice.nextScene ? SCENES[choice.nextScene] : null;
  if (next?.combat) risks.push('fight');
  return risks.length > 0 ? `Risk: ${risks.join(', ')}` : null;
}

function getChoiceRewardLabel(choice) {
  const rewards = [];
  const effect = choice.effect || {};
  if (effect.heal) rewards.push(`${effect.heal} HP`);
  if (effect.giveItem) rewards.push(formatEffectItem(effect));
  if (Array.isArray(effect.giveItems)) rewards.push(...effect.giveItems.map(getItemName));
  if (effect.giveGold) rewards.push(`${effect.giveGold} gold`);
  if (effect.giveXP) rewards.push(`${effect.giveXP} XP`);
  if (effect.setRoute) rewards.push(`${effect.setRoute} route`);
  if (effect.completeContract) rewards.push('contract credit');
  return rewards.length > 0 ? `Reward: ${rewards.join(', ')}` : null;
}

function getChoiceProgressLabel(choice) {
  if (choice.condition?.contractsCompleted === 5 && choice.nextScene === 'floor3_boss_portal') {
    return 'Progress: 5/5 contracts complete. Boss portal unlocked.';
  }
  if (choice.condition?.contractsCompleted !== undefined) {
    return `Progress: unlocks at ${choice.condition.contractsCompleted}/5 contracts.`;
  }
  const itemProgress = getProgressMessageForItem(choice.effect?.giveItem);
  if (itemProgress) return `Progress: ${itemProgress}`;
  if (choice.requires?.items) return `Requires: ${choice.requires.items.map(getItemName).join(', ')}`;
  if (choice.requires?.item) return `Requires: ${getItemName(choice.requires.item)}`;
  return null;
}

function hasItem(player, itemId) {
  return (player.inventory || []).includes(itemId);
}

function buildObjective(player) {
  if ((player.floor || 1) === 3) {
    const completed = player.contractsCompleted || 0;
    const ready = completed >= 5;
    return {
      route: 'contracts',
      goal: ready ? 'Enter the Market Arbiter boss portal' : `Complete contracts ${completed}/5`,
      missing: ready ? [] : [`${5 - completed} contract${5 - completed === 1 ? '' : 's'} remaining`],
      ready,
    };
  }

  if ((player.floor || 1) === 4) {
    const required = [
      ['f4_gold_key', 'Gold Vault Key'],
      ['f4_blood_key', 'Blood Vault Key'],
      ['f4_signal_key', 'Signal Vault Key'],
    ];
    const missing = required.filter(([itemId]) => !hasItem(player, itemId)).map(([, label]) => label);
    const completed = required.length - missing.length;
    const ready = missing.length === 0;
    return {
      route: 'sponsor-vault',
      goal: ready ? "Challenge the Sponsor's Champion" : `Collect Vault Keys ${completed}/3`,
      missing,
      ready,
    };
  }

  if ((player.floor || 1) === 5) {
    const required = [
      ['f5_combat_protocol', 'Combat Protocol Clearance'],
      ['f5_memory_protocol', 'Memory Protocol Clearance'],
      ['f5_debt_protocol', 'Debt Protocol Clearance'],
      ['f5_identity_protocol', 'Identity Protocol Clearance'],
    ];
    const missing = required.filter(([itemId]) => !hasItem(player, itemId)).map(([, label]) => label);
    const completed = required.length - missing.length;
    const ready = missing.length === 0;
    return {
      route: 'overseer-engine',
      goal: ready ? 'Challenge the Rulekeeper' : `Clear Protocols ${completed}/4`,
      missing,
      ready,
    };
  }

  if ((player.floor || 1) === 6) {
    const required = [
      ['f6_glass_anchor', 'Glass Anchor Shard'],
      ['f6_root_anchor', 'Root Anchor Shard'],
      ['f6_road_anchor', 'Road Anchor Shard'],
    ];
    const missing = required.filter(([itemId]) => !hasItem(player, itemId)).map(([, label]) => label);
    const completed = required.length - missing.length;
    const ready = missing.length === 0;
    return {
      route: 'fracture-map',
      goal: ready ? 'Challenge the Outside Thing' : `Stabilize Anchors ${completed}/3`,
      missing,
      ready,
    };
  }

  if ((player.floor || 1) === 7) {
    const required = [
      ['f7_forager_trust', 'Forager Trust Bond'],
      ['f7_scout_trust', 'Scout Trust Bond'],
      ['f7_healer_trust', 'Healer Trust Bond'],
      ['f7_builder_trust', 'Builder Trust Bond'],
    ];
    const missing = required.filter(([itemId]) => !hasItem(player, itemId)).map(([, label]) => label);
    const completed = required.length - missing.length;
    const ready = missing.length === 0;
    return {
      route: 'first-free-zone',
      goal: ready ? 'Challenge the Claimant at the boss trail' : `Earn Trust Bonds ${completed}/4`,
      missing,
      ready,
    };
  }

  if ((player.floor || 1) === 8) {
    const required = [
      ['f8_scent_trap', 'Scent Trap'],
      ['f8_snare_trap', 'Snare Trap'],
      ['f8_echo_trap', 'Echo Trap'],
      ['f8_sight_trap', 'Sight Trap'],
    ];
    const missing = required.filter(([itemId]) => !hasItem(player, itemId)).map(([, label]) => label);
    const completed = required.length - missing.length;
    const ready = missing.length === 0;
    return {
      route: 'hunt-beyond',
      goal: ready ? 'Face the Pale Stalker' : `Set Hunt Traps ${completed}/4`,
      missing,
      ready,
    };
  }

  if ((player.floor || 1) === 9) {
    const required = [
      ['f9_glass_root', 'Glass Root'],
      ['f9_blood_root', 'Blood Root'],
      ['f9_ash_root', 'Ash Root'],
    ];
    const missing = required.filter(([itemId]) => !hasItem(player, itemId)).map(([, label]) => label);
    const completed = required.length - missing.length;
    const ready = missing.length === 0;
    return {
      route: 'root-cathedral',
      goal: ready ? 'Challenge the Buried Saint' : `Awaken Ancient Roots ${completed}/3`,
      missing,
      ready,
    };
  }

  const route = player.route || 'unknown';
  if (player.runEnded) {
    return { route, goal: 'Run ended', missing: [], ready: false };
  }

  if (route === 'security') {
    const required = [
      ['security_route_token', 'Security Route Authorization'],
      ['security_clearance', 'Security Clearance'],
      ['warden_override', 'Warden Override'],
    ];
    const missing = required.filter(([itemId]) => !hasItem(player, itemId)).map(([, label]) => label);
    return {
      route,
      goal: missing.length === 0 ? 'Enter Restricted Access and confront the Warden' : `Find ${missing[0]}`,
      missing,
      ready: missing.length === 0,
    };
  }

  if (route === 'ward') {
    const required = [
      ['ward_route_token', 'Ward Route Authorization'],
      ['overseer_code', 'Service Corridor Code'],
    ];
    const missing = required.filter(([itemId]) => !hasItem(player, itemId)).map(([, label]) => label);
    return {
      route,
      goal: missing.length === 0 ? 'Use the service route or request evaluation' : `Find ${missing[0]}`,
      missing,
      ready: missing.length === 0,
    };
  }

  return {
    route,
    goal: 'Choose a route through Floor 1',
    missing: ['Route decision'],
    ready: false,
  };
}

function sceneBelongsToFloor(id, floor) {
  if (floor >= 2) return id.startsWith(`floor${floor}_`);
  return !/^floor\d+_/.test(id);
}

function buildMapProgress(state) {
  const floor = state.player.floor || 1;
  const mapState = getFloorMap(state.player, floor);
  const discovered = new Set((mapState.discovered || []).filter(id => sceneBelongsToFloor(id, floor)));
  const visited = new Set((mapState.visited || []).filter(id => sceneBelongsToFloor(id, floor)));
  if (SCENES[state.currentSceneId]?.map && sceneBelongsToFloor(state.currentSceneId, floor)) {
    discovered.add(state.currentSceneId);
    visited.add(state.currentSceneId);
  }

  const totalRooms = Object.entries(SCENES).filter(([id, scene]) => scene.map && sceneBelongsToFloor(id, floor)).length;
  const rooms = [...discovered]
    .map(id => {
      const scene = SCENES[id];
      if (!scene?.map) return null;
      return {
        id,
        name: scene.title,
        shortName: scene.map.name || id,
        tag: scene.map.tag || 'event',
        visited: visited.has(id),
        cleared: state.player.clearedRooms?.[id] === true,
        current: id === state.currentSceneId,
      };
    })
    .filter(Boolean);

  return {
    floor,
    currentRoom: SCENES[state.currentSceneId]?.title || state.currentSceneId,
    discoveredCount: discovered.size,
    visitedCount: visited.size,
    totalRooms,
    rooms,
  };
}

function buildContractProgress(player) {
  if ((player.floor || 1) !== 3) return null;
  const completed = player.contractsCompleted || 0;
  const required = 5;
  return {
    completed,
    required,
    ready: completed >= required,
    label: `Contracts ${completed}/${required}`,
  };
}

function makeInitialState(player, floorConfig) {
  return {
    player,
    currentSceneId: 'start_room',
    floorConfig: floorConfig || generateFloor(player.floor || 1),
    sceneGrants: {},
  };
}

function startNewRun(options = {}) {
  const player = createPlayer(options.name || 'Stranger');
  const meta = normalizeMeta(options.meta || createDefaultMeta());
  const gameClass = getClass(options.classId || 'fighter');
  applyMetaUpgrades(player, meta);
  player.maxHp = Math.max(1, player.maxHp + (gameClass.statMods.maxHp || 0));
  player.hp = player.maxHp;
  player.attack = Math.max(1, player.attack + (gameClass.statMods.attack || 0));
  player.defense = Math.max(0, player.defense + (gameClass.statMods.defense || 0));
  player.perception = Math.max(0, player.perception + (gameClass.statMods.perception || 0));
  player.classId = gameClass.id;
  player.className = gameClass.name;
  for (const itemId of gameClass.starterGear || []) {
    equipGearItem(player, itemId);
  }
  const classAbilityIds = getClassAbilityIds(meta, gameClass.id);
  player.abilities = pickRunAbilities(classAbilityIds, options.selectedAbilityIds || gameClass.defaultAbilityIds, 2, gameClass.id);
  if (options.playerPatch) Object.assign(player, clone(options.playerPatch));
  const state = makeInitialState(player, generateFloor(player.floor || 1));
  return enterScene(state).state;
}

function getRunSetupOptions(meta, selectedClassId = 'fighter') {
  const normalized = normalizeMeta(meta || createDefaultMeta());
  const gameClass = getClass(selectedClassId);
  const classAbilityIds = getClassAbilityIds(normalized, gameClass.id);
  return {
    maxAbilities: 2,
    selectedClassId: gameClass.id,
    classes: getClassOptions(normalized, gameClass.id),
    selectedAbilityIds: pickRunAbilities(classAbilityIds, gameClass.defaultAbilityIds, 2, gameClass.id).map(ability => ability.id),
    abilities: getUnlockedAbilityOptions(classAbilityIds, gameClass.id),
    unlocks: getAbilityUnlockOptions(normalized, gameClass.id),
  };
}

function hydrateRun(saveData) {
  const state = {
    player: clone(saveData.player),
    currentSceneId: saveData.currentSceneId || 'start_room',
    floorConfig: saveData.floorConfig || generateFloor(saveData.player?.floor || 1),
    sceneGrants: saveData.sceneGrants || {},
    combat: saveData.combat || null,
  };
  if (!state.player.mapData) state.player.mapData = {};
  if (!state.player.clearedRooms) state.player.clearedRooms = {};
  if (!state.player.usedChoices) state.player.usedChoices = {};
  ensureEquipment(state.player);
  return enterScene(state).state;
}

function createSaveData(state) {
  const snapshot = clone(state);
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    player: snapshot.player,
    currentSceneId: snapshot.currentSceneId,
    floorConfig: snapshot.floorConfig,
    sceneGrants: snapshot.sceneGrants || {},
    combat: snapshot.combat || null,
  };
}

function getScene(state) {
  return SCENES[state.currentSceneId];
}

function getCombatData(state, scene) {
  if (!scene?.combat) return null;
  const enemyData = state.floorConfig?.enemyVariants?.[state.currentSceneId] || scene.combat;
  return applyCombatAdvantages(enemyData, state.player);
}

function applyCombatAdvantages(enemyData, player) {
  const adjusted = clone(enemyData);
  const inventory = new Set(player?.inventory || []);
  adjusted.advantagesApplied = [];

  for (const advantage of adjusted.advantages || []) {
    if (!inventory.has(advantage.item)) continue;
    adjusted.advantagesApplied.push(advantage.item);
    if (advantage.hpDelta) adjusted.hp = Math.max(1, (adjusted.hp || 1) + advantage.hpDelta);
    if (advantage.attackDelta) adjusted.attack = Math.max(1, (adjusted.attack || 1) + advantage.attackDelta);
    if (advantage.defenseDelta) adjusted.defense = Math.max(0, (adjusted.defense || 0) + advantage.defenseDelta);
    if (advantage.removeAbilities?.length) {
      const removals = new Set(advantage.removeAbilities);
      adjusted.abilities = (adjusted.abilities || []).filter(id => !removals.has(id));
      adjusted.phases = (adjusted.phases || []).map(phase => ({
        ...phase,
        abilities: (phase.abilities || []).filter(id => !removals.has(id)),
      }));
    }
  }

  return adjusted;
}

function makeCombatState(enemyData) {
  return {
    enemy: {
      name: enemyData.name,
      hp: enemyData.hp,
      maxHp: enemyData.hp,
      attack: enemyData.attack,
      defense: enemyData.defense,
      xpReward: enemyData.xp || 0,
      goldReward: enemyData.goldReward || 0,
      loot: [...(enemyData.loot || [])],
      type: enemyData.type || 'aggressive',
      abilities: [...(enemyData.abilities || [])],
      advantagesApplied: [...(enemyData.advantagesApplied || [])],
      shieldUp: false,
      statusEffects: clone(enemyData.statusEffects || []),
    },
    turn: 1,
    defending: false,
    attackStreak: 0,
    gearTraits: {},
  };
}

function findEquippedTrait(player, traitId) {
  const equipment = player.equipment || {};
  for (const itemId of Object.values(equipment)) {
    const item = ITEMS[itemId];
    if (item?.trait?.id === traitId) {
      return { itemId, name: item.name || itemId, trait: item.trait };
    }
  }
  return null;
}

function applyFirstAttackTrait(state, combat, damage, events) {
  const equipped = findEquippedTrait(state.player, 'first_attack_bonus');
  if (!equipped || combat.gearTraits.firstAttackBonusUsed) return damage;
  const bonusDamage = equipped.trait.value || 0;
  combat.gearTraits.firstAttackBonusUsed = true;
  events.push({
    type: 'gear_trait',
    traitId: equipped.trait.id,
    itemId: equipped.itemId,
    name: equipped.name,
    bonusDamage,
  });
  return damage + bonusDamage;
}

function applyIncomingReductionTrait(state, combat, damage, events) {
  const equipped = findEquippedTrait(state.player, 'first_hit_reduction');
  if (!equipped || combat.gearTraits.firstHitReductionUsed || damage <= 0) return damage;
  const reducedBy = Math.min(damage, equipped.trait.value || 0);
  combat.gearTraits.firstHitReductionUsed = true;
  events.push({
    type: 'gear_trait',
    traitId: equipped.trait.id,
    itemId: equipped.itemId,
    name: equipped.name,
    reducedBy,
  });
  return Math.max(0, damage - reducedBy);
}

function getAttackPressureMultiplier(attackStreak) {
  const extraStacks = Math.max(0, (attackStreak || 0) - 1);
  return 1 + extraStacks * 0.35;
}

function getCombatPressure(combat) {
  const attackStreak = combat?.attackStreak || 0;
  const nextAttackStreak = attackStreak + 1;
  const nextAttackMultiplier = getAttackPressureMultiplier(nextAttackStreak);
  const text = attackStreak > 0
    ? `Pressure ${attackStreak}: repeated attacks make the next enemy turn hit harder. Defend clears it.`
    : 'Pressure clear: Defend after attacking to keep enemy damage controlled.';
  return {
    attackStreak,
    nextAttackMultiplier,
    text,
  };
}

function applyCombatPressure(combat, damage, events) {
  const attackStreak = combat?.attackStreak || 0;
  if (combat?.defending || attackStreak <= 1 || damage <= 0) return damage;
  const multiplier = getAttackPressureMultiplier(attackStreak);
  const pressuredDamage = Math.max(1, Math.floor(damage * multiplier));
  events.push({
    type: 'combat_pressure',
    attackStreak,
    multiplier,
    bonusDamage: pressuredDamage - damage,
  });
  return pressuredDamage;
}

function ensureCombat(state) {
  const scene = getScene(state);
  if (!scene?.combat) return null;
  if (!state.combat || state.combat.sceneId !== state.currentSceneId) {
    const enemyData = getCombatData(state, scene);
    state.combat = {
      sceneId: state.currentSceneId,
      ...makeCombatState(enemyData),
    };
  }
  if (!state.combat.gearTraits) state.combat.gearTraits = {};
  if (state.combat.attackStreak === undefined) state.combat.attackStreak = 0;
  return state.combat;
}

function getFilteredChoices(scene, player, floorConfig) {
  let choices = getAvailableChoices(scene, player);
  if (floorConfig?.excludedRooms?.length > 0) {
    choices = filterChoices(choices, new Set(floorConfig.excludedRooms));
  }
  return choices;
}

function enterScene(inputState) {
  const state = clone(inputState);
  const scenes = SCENES;
  const scene = scenes[state.currentSceneId];
  const events = [];
  if (!scene) {
    events.push({ type: 'error', message: `Unknown scene: ${state.currentSceneId}` });
    return { state, events };
  }

  if (scene.map) {
    const excluded = new Set(state.floorConfig?.excludedRooms || []);
    visitRoom(state.player, state.currentSceneId, state.player.floor || 1);
    revealConnected(state.player, scene, scenes, state.player.floor || 1, excluded);
  }

  if (!state.sceneGrants) state.sceneGrants = {};
  if (!state.sceneGrants[state.currentSceneId]) state.sceneGrants[state.currentSceneId] = {};
  const grants = state.sceneGrants[state.currentSceneId];

  if (scene.giveItem && !grants.giveItem) {
    state.player.inventory.push(scene.giveItem);
    grants.giveItem = true;
    events.push({ type: 'item_gained', itemId: scene.giveItem, source: state.currentSceneId });
  }

  if (scene.giveGold && !grants.giveGold) {
    state.player.gold += scene.giveGold;
    grants.giveGold = true;
    events.push({ type: 'gold_gained', amount: scene.giveGold, source: state.currentSceneId });
  }

  return { state, events };
}

function getView(state) {
  const scene = getScene(state);
  if (!scene) {
    return {
      mode: 'error',
      message: `Unknown scene: ${state.currentSceneId}`,
      player: clone(state.player),
    };
  }

  const view = {
    mode: scene.combat ? 'combat' : 'scene',
    scene: {
      id: scene.id,
      title: scene.title,
      text: scene.text,
      type: scene.type || 'scene',
      hasCombat: !!scene.combat,
    },
    choices: getFilteredChoices(scene, state.player, state.floorConfig).map((choice, index) => ({
      index,
      text: choice.text,
      once: !!choice.once,
      nextScene: choice.nextScene || null,
      riskLabel: getChoiceRiskLabel(choice),
      rewardLabel: getChoiceRewardLabel(choice),
      progressLabel: getChoiceProgressLabel(choice),
    })),
    player: clone(state.player),
    floor: state.player.floor || 1,
    objective: buildObjective(state.player),
    contractProgress: buildContractProgress(state.player),
    mapProgress: buildMapProgress(state),
    equipment: clone(state.player.equipment || { weapon: null, armor: null, trinket: null }),
    equipmentItems: getEquippedItems(state.player),
    inventory: [...(state.player.inventory || [])],
    items: getInventoryItems(state.player),
    runEnded: !!state.player.runEnded,
  };

  if (scene.combat) {
    const preview = clone(state);
    const combat = ensureCombat(preview);
    view.combat = {
      enemy: clone(combat.enemy),
      turn: combat.turn,
      intent: getRuntimeEnemyIntent(preview.player, combat),
      pressure: getCombatPressure(combat),
      abilities: getCombatAbilities(preview.player),
      actions: [
        { type: 'combat_attack', label: 'Attack' },
        { type: 'combat_defend', label: 'Defend' },
        { type: 'combat_flee', label: 'Flee' },
        { type: 'end_run', label: 'End Run' },
      ],
    };
  }

  return view;
}

function chooseSceneOption(inputState, index) {
  const before = enterScene(inputState).state;
  const state = clone(before);
  const scene = getScene(state);
  const events = [];

  if (!scene) return { state, events: [{ type: 'error', message: `Unknown scene: ${state.currentSceneId}` }] };
  if (scene.combat) return { state, events: [{ type: 'error', message: 'Scene choice is not available during combat.' }] };

  const choices = getFilteredChoices(scene, state.player, state.floorConfig);
  const choice = choices[index];
  if (!choice) return { state, events: [{ type: 'error', message: `Invalid choice index: ${index}` }] };

  events.push({ type: 'choice_selected', sceneId: scene.id, index, text: choice.text });

  if (choice.effect) {
    const beforePlayer = clone(state.player);
    withConsoleMuted(() => applyEffect(state.player, choice.effect));
    const message = describeChoiceEffect(choice.effect, beforePlayer, state.player);
    if (message) {
      events.push({ type: 'choice_result', message, effect: clone(choice.effect) });
    }
  }

  if (choice.once) {
    if (!state.player.usedChoices) state.player.usedChoices = {};
    if (!state.player.usedChoices[state.currentSceneId]) state.player.usedChoices[state.currentSceneId] = [];
    state.player.usedChoices[state.currentSceneId].push(choice.text);
    if (isRoomCleared(scene, state.player)) {
      state.player.clearedRooms[state.currentSceneId] = true;
      events.push({ type: 'room_cleared', sceneId: state.currentSceneId });
    }
  }

  if (choice.nextScene) {
    const from = state.currentSceneId;
    state.currentSceneId = choice.nextScene;
    events.push({ type: 'scene_changed', from, to: state.currentSceneId });
    const entered = enterScene(state);
    state.player = entered.state.player;
    state.floorConfig = entered.state.floorConfig;
    state.sceneGrants = entered.state.sceneGrants;
    events.push(...entered.events);
  }

  return { state, events };
}

function completeCurrentFloor(inputState) {
  const state = clone(inputState);
  const events = [];
  const result = completeFloor(state.player, { route: 'runtime' });
  state.floorConfig = generateFloor(state.player.floor);
  events.push({ type: 'floor_completed', ...result });

  if (state.floorConfig.placeholder) {
    const summary = endRun(state.player, {
      reason: 'floor_under_construction',
      endingReached: state.floorConfig.message,
    });
    events.push({ type: 'run_ended', summary });
  } else {
    const nextStartScene = state.floorConfig.safeRoom || 'start_room';
    state.currentSceneId = nextStartScene;
    state.sceneGrants = {};
    events.push({ type: 'scene_changed', from: 'the_end', to: nextStartScene });
    const entered = enterScene(state);
    Object.assign(state, entered.state);
    events.push(...entered.events);
  }

  return { state, events };
}

function rollRuntimeDamage(attacker, defender) {
  return Math.max(1, getEffAtk(attacker) - getEffDef(defender));
}

const RUNTIME_ENEMY_ABILITIES = {
  shiv_stab: { mult: 1.5, label: 'Shiv Stab' },
  quick_strike: { mult: 1.4, label: 'Quick Strike' },
  frenzy: { mult: 2.0, label: 'Frenzy' },
  shield_bash: { mult: 0.75, label: 'Shield Bash' },
  cleave: { mult: 1.5, label: 'Cleave' },
  battle_roar: { mult: 1.3, label: 'Battle Roar' },
  heavy_hit: { mult: 1.7, label: 'Heavy Hit' },
  enraged_strike: { mult: 2.0, label: 'Enraged Strike' },
  sweeping_attack: { effect: 'sweep', fixed: 15, label: 'Sweeping Attack' },
  armor_break: { effect: 'defenseDown', mult: 0.5, status: { type: 'defenseDown', duration: 2, value: 3 }, label: 'Armor Break' },
  poison_hit: { effect: 'applyStatus', mult: 0.8, status: { type: 'poison', duration: 3, value: 2 }, label: 'Poison Hit' },
  burning_strike: { effect: 'applyStatus', mult: 0.8, status: { type: 'burn', duration: 2, value: 3 }, label: 'Burning Strike' },
  crushing_blow: { effect: 'applyStatus', mult: 1.2, status: { type: 'defenseDown', duration: 2, value: 3 }, label: 'Crushing Blow' },
  shield_up: { effect: 'shield', label: 'Shield Up' },
};

function pickRuntimeEnemyAbility(enemy, turn = 0) {
  const abilities = enemy.abilities || [];
  const offensive = abilities.filter(id => {
    const ability = RUNTIME_ENEMY_ABILITIES[id];
    return ability && ability.effect !== 'shield' && ability.mult !== 0;
  });
  if (offensive.length > 0) return offensive[Math.max(0, turn - 1) % offensive.length];
  return abilities.find(id => RUNTIME_ENEMY_ABILITIES[id]);
}

function getIntentDanger(player, damage) {
  const maxHp = Math.max(1, player.maxHp || player.hp || 1);
  const ratio = damage / maxHp;
  if (ratio >= 0.2) return 'high';
  if (ratio >= 0.1) return 'medium';
  return 'low';
}

function getRuntimeEnemyIntent(player, combat) {
  if (!combat || !combat.enemy || combat.enemy.hp <= 0) return null;

  const abilityId = pickRuntimeEnemyAbility(combat.enemy, combat.turn || 0);
  const ability = abilityId ? RUNTIME_ENEMY_ABILITIES[abilityId] : null;
  const name = ability ? ability.label : 'Attack';
  let damage = rollRuntimeDamage(combat.enemy, player);
  let status = null;

  if (ability) {
    if (ability.effect === 'shield') {
      damage = 0;
    } else if (ability.effect === 'sweep') {
      damage = ability.fixed || 0;
    } else {
      damage = Math.max(1, Math.floor(damage * (ability.mult || 1)));
    }
    status = ability.status ? clone(ability.status) : null;
  }

  const defendDamage = damage > 0 ? Math.max(1, Math.floor(damage / 4)) : 0;
  const danger = getIntentDanger(player, damage);
  const statusText = status ? ` and ${status.type}` : '';
  const defenseText = damage > 0 ? ` Defend reduces it to about ${defendDamage}.` : '';

  return {
    abilityId: abilityId || null,
    name,
    damage,
    defendDamage,
    danger,
    status,
    text: `${name}: ${damage > 0 ? `${damage} damage` : 'no direct damage'}${statusText}.${defenseText}`,
  };
}

function applyRuntimeEnemyAbility(state, combat, abilityId, events) {
  const enemy = combat.enemy;
  const ability = RUNTIME_ENEMY_ABILITIES[abilityId] || { mult: 1, label: abilityId.replace(/_/g, ' ') };

  if (ability.effect === 'shield') {
    enemy.shieldUp = true;
    events.push({ type: 'enemy_ability', enemy: enemy.name, abilityId, name: ability.label, damage: 0 });
    return 0;
  }

  if (ability.effect === 'sweep') {
    const baseDamage = combat.defending ? Math.max(1, Math.floor((ability.fixed || 0) / 4)) : ability.fixed || 0;
    const pressuredDamage = applyCombatPressure(combat, baseDamage, events);
    const damage = applyIncomingReductionTrait(state, combat, pressuredDamage, events);
    state.player.hp = Math.max(0, state.player.hp - damage);
    events.push({ type: 'enemy_ability', enemy: enemy.name, abilityId, name: ability.label, damage });
    return damage;
  }

  const base = rollRuntimeDamage(enemy, state.player);
  const divisor = combat.defending ? 4 : 1;
  const mult = ability.mult || 1;
  const baseDamage = Math.max(1, Math.floor((base * mult) / divisor));
  const pressuredDamage = applyCombatPressure(combat, baseDamage, events);
  const damage = applyIncomingReductionTrait(state, combat, pressuredDamage, events);
  state.player.hp = Math.max(0, state.player.hp - damage);

  if (ability.status) {
    applyStatus(state.player, ability.status);
  }

  events.push({
    type: 'enemy_ability',
    enemy: enemy.name,
    abilityId,
    name: ability.label,
    damage,
    status: ability.status ? clone(ability.status) : null,
  });
  return damage;
}

function awardCombatVictory(state, scene, combat, events) {
  const enemy = combat.enemy;
  withConsoleMuted(() => gainXP(state.player, enemy.xpReward || 0));
  state.player.gold += enemy.goldReward || 0;
  const bonusGoldTrait = findEquippedTrait(state.player, 'bonus_gold');
  if (bonusGoldTrait) {
    const gold = bonusGoldTrait.trait.value || 0;
    state.player.gold += gold;
    events.push({
      type: 'gear_trait',
      traitId: bonusGoldTrait.trait.id,
      itemId: bonusGoldTrait.itemId,
      name: bonusGoldTrait.name,
      gold,
    });
  }
  if (!state.player.runStats) {
    state.player.runStats = { floorsCleared: 0, enemiesDefeated: 0, relicsFound: [], endingReached: null, rankAchieved: null };
  }
  state.player.runStats.enemiesDefeated = (state.player.runStats.enemiesDefeated || 0) + 1;

  for (const drop of enemy.loot || []) {
    state.player.inventory.push(drop);
    events.push({ type: 'item_gained', itemId: drop, source: state.currentSceneId });
  }

  events.push({
    type: 'combat_victory',
    enemy: enemy.name,
    xp: enemy.xpReward || 0,
    gold: enemy.goldReward || 0,
  });
  events.push({
    type: 'reward_summary',
    xp: enemy.xpReward || 0,
    gold: enemy.goldReward || 0,
    loot: [...(enemy.loot || [])],
    message: `Rewards: ${enemy.xpReward || 0} XP, ${enemy.goldReward || 0} gold${enemy.loot?.length ? `, ${enemy.loot.map(getItemName).join(', ')}` : ''}.`,
  });

  const from = state.currentSceneId;
  state.currentSceneId = scene.victoryScene || 'start_room';
  state.combat = null;
  events.push({ type: 'scene_changed', from, to: state.currentSceneId });
  const entered = enterScene(state);
  Object.assign(state, entered.state);
  events.push(...entered.events);
}

function resolveEnemyTurn(state, combat, events) {
  const enemy = combat.enemy;
  const abilityId = pickRuntimeEnemyAbility(enemy, combat.turn || 0);
  if (abilityId) {
    applyRuntimeEnemyAbility(state, combat, abilityId, events);
  } else {
    const divisor = combat.defending ? 4 : 1;
    const baseDamage = Math.max(1, Math.floor(rollRuntimeDamage(enemy, state.player) / divisor));
    const pressuredDamage = applyCombatPressure(combat, baseDamage, events);
    const damage = applyIncomingReductionTrait(state, combat, pressuredDamage, events);
    state.player.hp = Math.max(0, state.player.hp - damage);
    events.push({ type: 'enemy_attack', enemy: enemy.name, damage });
  }
  combat.defending = false;
  combat.turn += 1;

  if (state.player.hp <= 0) {
    state.player.hp = 0;
    state.player.runEnded = true;
    state.player.currentRunActive = false;
    events.push({ type: 'combat_defeat', enemy: enemy.name });
  }
}

function findReadyAbility(player, abilityId) {
  const ability = (player.abilities || []).find(candidate => candidate.id === abilityId);
  if (!ability) return { ok: false, reason: 'missing' };
  if ((ability.currentCooldown || 0) > 0) return { ok: false, reason: 'cooldown', ability };
  return { ok: true, ability };
}

function dispatchCombat(inputState, action) {
  const state = clone(inputState);
  const scene = getScene(state);
  const events = [];
  if (!scene?.combat) {
    return { state, events: [{ type: 'error', message: 'No combat is active.' }] };
  }

  const combat = ensureCombat(state);

  if (action.type === 'combat_flee') {
    const fleeTrait = findEquippedTrait(state.player, 'flee_bonus');
    const fleeThreshold = fleeTrait ? 0.2 : 0.4;
    const success = action.forceSuccess === true || (action.forceSuccess !== false && Math.random() > fleeThreshold);
    if (success) {
      state.player.neverFled = false;
      const from = state.currentSceneId;
      state.currentSceneId = scene.fleeScene || 'start_room';
      state.combat = null;
      if (fleeTrait) {
        events.push({ type: 'gear_trait', traitId: fleeTrait.trait.id, itemId: fleeTrait.itemId, name: fleeTrait.name });
      }
      events.push({ type: 'combat_fled', from, to: state.currentSceneId });
      const entered = enterScene(state);
      Object.assign(state, entered.state);
      events.push(...entered.events);
      return { state, events };
    }
    events.push({ type: 'flee_failed' });
    resolveEnemyTurn(state, combat, events);
    return { state, events };
  }

  if (action.type === 'combat_defend') {
    combat.defending = true;
    combat.attackStreak = 0;
    events.push({ type: 'player_defended' });
    resolveEnemyTurn(state, combat, events);
    tickAbilityCooldowns(state.player);
    return { state, events };
  }

  if (action.type === 'combat_attack') {
    combat.attackStreak = (combat.attackStreak || 0) + 1;
    const damage = applyFirstAttackTrait(state, combat, rollRuntimeDamage(state.player, combat.enemy), events);
    combat.enemy.hp = Math.max(0, combat.enemy.hp - damage);
    events.push({ type: 'player_attack', damage, enemyHp: combat.enemy.hp });

    if (combat.enemy.hp <= 0) {
      awardCombatVictory(state, scene, combat, events);
      return { state, events };
    }

    resolveEnemyTurn(state, combat, events);
    tickAbilityCooldowns(state.player);
    return { state, events };
  }

  if (action.type === 'combat_ability') {
    const abilityResult = findReadyAbility(state.player, action.abilityId);
    if (!abilityResult.ok) {
      events.push({ type: 'ability_use_failed', abilityId: action.abilityId, reason: abilityResult.reason });
      return { state, events };
    }

    const ability = abilityResult.ability;
    let damage = 0;
    let healed = 0;
    combat.attackStreak = 0;

    if (ability.type === 'damage_bonus') {
      damage = rollRuntimeDamage(state.player, combat.enemy) + (ability.value || 0);
      combat.enemy.hp = Math.max(0, combat.enemy.hp - damage);
    } else if (ability.type === 'damage_reduce') {
      combat.defending = true;
    } else if (ability.type === 'berserk') {
      const hpCost = Math.min(ability.hpCost || 0, Math.max(0, state.player.hp - 1));
      state.player.hp -= hpCost;
      damage = rollRuntimeDamage(state.player, combat.enemy) + (ability.value || 0);
      combat.enemy.hp = Math.max(0, combat.enemy.hp - damage);
    } else if (ability.type === 'heal') {
      const before = state.player.hp;
      state.player.hp = Math.min(state.player.maxHp, state.player.hp + (ability.value || 0));
      healed = state.player.hp - before;
    } else if (ability.type === 'status_attack') {
      damage = rollRuntimeDamage(state.player, combat.enemy) + (ability.damage || 0);
      combat.enemy.hp = Math.max(0, combat.enemy.hp - damage);
      if (ability.status) applyStatus(combat.enemy, ability.status);
    } else {
      events.push({ type: 'ability_use_failed', abilityId: action.abilityId, reason: 'unsupported' });
      return { state, events };
    }

    ability.currentCooldown = ability.cooldown || 0;
    events.push({
      type: 'ability_used',
      abilityId: ability.id,
      name: ability.name || ability.id,
      damage,
      healed,
      enemyHp: combat.enemy.hp,
    });

    if (combat.enemy.hp <= 0) {
      awardCombatVictory(state, scene, combat, events);
      return { state, events };
    }

    resolveEnemyTurn(state, combat, events);
    tickAbilityCooldowns(state.player, ability.id);
    return { state, events };
  }

  return { state, events: [{ type: 'error', message: `Unknown combat action: ${action.type}` }] };
}

function dispatch(state, action) {
  if (!action || !action.type) {
    return { state: clone(state), events: [{ type: 'error', message: 'Missing action type.' }] };
  }

  if (action.type === 'choose_scene_option') {
    return chooseSceneOption(state, action.index);
  }

  if (action.type === 'combat_attack' || action.type === 'combat_defend' || action.type === 'combat_flee' || action.type === 'combat_ability') {
    return dispatchCombat(state, action);
  }

  if (action.type === 'complete_floor') {
    return completeCurrentFloor(state);
  }

  if (action.type === 'use_item') {
    const next = clone(state);
    const result = useInventoryItem(next.player, action.itemId);
    next.player = result.player;
    const itemWasUsed = result.events.some(event => event.type === 'item_used');
    const scene = getScene(next);
    if (itemWasUsed && scene?.combat && next.player.hp > 0) {
      const combat = ensureCombat(next);
      combat.attackStreak = 0;
      resolveEnemyTurn(next, combat, result.events);
      tickAbilityCooldowns(next.player);
    }
    return { state: next, events: result.events };
  }

  if (action.type === 'equip_item') {
    const next = clone(state);
    const result = equipInventoryItem(next.player, action.itemId);
    next.player = result.player;
    return { state: next, events: result.events };
  }

  if (action.type === 'end_run') {
    const next = clone(state);
    const summary = endRun(next.player, { reason: 'player_ended_run', endingReached: 'Ended by player' });
    return { state: next, events: [{ type: 'run_ended', summary }] };
  }

  return { state: clone(state), events: [{ type: 'error', message: `Unknown action type: ${action.type}` }] };
}

module.exports = {
  startNewRun,
  hydrateRun,
  createSaveData,
  createDefaultMeta,
  getRunSetupOptions,
  getView,
  dispatch,
};

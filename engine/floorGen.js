'use strict';

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function chance(p) { return Math.random() < p; }

const ENEMY_VARIANTS = {
  left_path_combat: [
    { name: 'Intake Guard',   hp: 30, attack: 15, defense: 3, xp: 18, goldReward: 6,
      loot: ['guard_key', 'small_potion'], type: 'defensive',  abilities: ['shield_bash', 'bone_armor'] },
    { name: 'Reckless Guard', hp: 28, attack: 17, defense: 2, xp: 20, goldReward: 8,
      loot: ['guard_key', 'small_potion'], type: 'aggressive', abilities: ['shiv_stab', 'quick_strike'] },
    { name: 'Corrupt Guard',  hp: 32, attack: 16, defense: 3, xp: 22, goldReward: 7,
      loot: ['guard_key', 'antidote'],     type: 'trickster',  abilities: ['poison_hit', 'dodge'] },
  ],
  right_path_combat: [
    { name: 'Prisoner Mutant',  hp: 44, attack: 18, defense: 2, xp: 28, goldReward: 8,
      loot: ['small_potion', 'big_potion'], type: 'aggressive', abilities: ['quick_strike', 'frenzy'] },
    { name: 'Burning Mutant',   hp: 42, attack: 17, defense: 2, xp: 30, goldReward: 10,
      loot: ['antidote', 'small_potion'],  type: 'aggressive', abilities: ['frenzy', 'burning_strike'] },
    { name: 'Crushing Mutant',  hp: 48, attack: 19, defense: 3, xp: 32, goldReward: 9,
      loot: ['big_potion'],                type: 'aggressive', abilities: ['cleave', 'crushing_blow'] },
  ],
  deadly_room: [
    { name: 'Senior Enforcer',   hp: 64, attack: 22, defense: 6, xp: 65, goldReward: 22,
      loot: ['small_potion', 'big_potion', 'antidote', 'shock_baton'], type: 'aggressive', abilities: ['cleave', 'battle_roar', 'crushing_blow'] },
    { name: 'Armored Enforcer',  hp: 68, attack: 20, defense: 9, xp: 65, goldReward: 22,
      loot: ['small_potion', 'antidote', 'sentry_plate'], type: 'defensive',  abilities: ['shield_up', 'shield_bash', 'armor_break'] },
    { name: 'Chemical Enforcer', hp: 60, attack: 21, defense: 5, xp: 70, goldReward: 25,
      loot: ['antidote', 'big_potion', 'ranger_cloak'], type: 'aggressive', abilities: ['burning_strike', 'poison_hit', 'cleave'] },
  ],
};

// Remove choices whose nextScene is in the excludedRooms set.
function filterChoices(choices, excludedRooms) {
  if (!excludedRooms || excludedRooms.size === 0) return choices;
  return choices.filter(c => !c.nextScene || !excludedRooms.has(c.nextScene));
}

function generateFloor1Config() {
  const excludedRooms = new Set();

  // ── Side room selection: always pick 2 of 3 ──────────────────────────────
  const sidePool = ['warden_trap', 'supply_cache', 'alchemy_lab'];
  const shuffled = [...sidePool].sort(() => Math.random() - 0.5);
  const activeSideRooms = shuffled.slice(0, 2);
  excludedRooms.add(shuffled[2]);

  // Dead end only appears if warden_trap is active (60% chance)
  const deadEndIncluded = activeSideRooms.includes('warden_trap') && chance(0.6);
  if (!deadEndIncluded) {
    excludedRooms.add('dead_end_passage');
    excludedRooms.add('dead_end_loot');
  }

  // ── Right branch bonus: 60% get merchant+rival, 40% neither ─────────────
  const rightSideAvailable = chance(0.6);
  if (!rightSideAvailable) {
    excludedRooms.add('merchant_room');
    excludedRooms.add('rival_room');
  }

  // ── Lore access randomization ────────────────────────────────────────────
  // 60%: left_crack approach only  (lore_room gated behind left_crack perception check)
  // 30%: secret_room approach only (lore_room excluded)
  // 10%: both approaches work
  const loreRoll = Math.random();
  let loreAccess;
  if (loreRoll < 0.6) {
    loreAccess = 'left_crack';
  } else if (loreRoll < 0.9) {
    loreAccess = 'secret_room';
    excludedRooms.add('lore_room');
  } else {
    loreAccess = 'both';
  }

  // ── Enemy variants ───────────────────────────────────────────────────────
  const enemyVariants = {
    left_path_combat: pick(ENEMY_VARIANTS.left_path_combat),
    right_path_combat: pick(ENEMY_VARIANTS.right_path_combat),
    deadly_room: pick(ENEMY_VARIANTS.deadly_room),
  };

  return {
    floor: 1,
    rightSideAvailable,
    deadEndIncluded,
    activeSideRooms,
    loreAccess,
    excludedRooms: [...excludedRooms],
    enemyVariants,
  };
}

function generateFloor2Config() {
  return {
    floor: 2,
    excludedRooms: [],
    enemyVariants: {},
    safeRoom: 'floor2_safe_room',
  };
}

function generateFloor3Config() {
  return {
    floor: 3,
    excludedRooms: [],
    enemyVariants: {},
    safeRoom: 'floor3_market',
  };
}

function generateFloor4Config() {
  return {
    floor: 4,
    excludedRooms: [],
    enemyVariants: {},
    safeRoom: 'floor4_elevator',
  };
}

function generateFloor5Config() {
  return {
    floor: 5,
    excludedRooms: [],
    enemyVariants: {},
    safeRoom: 'floor5_service_dock',
  };
}

function generateFloor6Config() {
  return {
    floor: 6,
    excludedRooms: [],
    enemyVariants: {},
    safeRoom: 'floor6_weather_gap',
  };
}

function generateFloor(floor) {
  if (floor === 1) return generateFloor1Config();
  if (floor === 2) return generateFloor2Config();
  if (floor === 3) return generateFloor3Config();
  if (floor === 4) return generateFloor4Config();
  if (floor === 5) return generateFloor5Config();
  if (floor === 6) return generateFloor6Config();
  return {
    floor,
    placeholder: true,
    message: `Floor ${floor} under construction`,
    excludedRooms: [],
    enemyVariants: {},
  };
}

module.exports = { generateFloor, generateFloor1Config, generateFloor2Config, generateFloor3Config, generateFloor4Config, generateFloor5Config, generateFloor6Config, filterChoices, ENEMY_VARIANTS };

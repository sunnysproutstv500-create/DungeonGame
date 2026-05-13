'use strict';

// ── Chaos Event Pool ──────────────────────────────────────────────────────────
// Each event has a weight (higher = more likely). Rival encounter weight scales
// with floor via pickChaosEvent. All other events are handled inline.

const EVENT_POOL = [
  { id: 'sponsor_drop',            weight: 3 },
  { id: 'dungeon_instability',     weight: 2 },
  { id: 'earth_transmission',      weight: 3 },
  { id: 'rival_encounter',         weight: 2 },
  { id: 'cross_world_interference',weight: 1 },
];

const EARTH_MESSAGES = [
  '"We are watching. Do not fail us." — Earth Command',
  '"7.9 billion people are counting on you." — Earth Broadcast',
  '"World-4 competitor has been eliminated. You are still in." — Overseer Log',
  '"Top 2 worlds survive. You are not there yet. Fight." — Earth Signal',
  '"World-7 has been harvested. The machine works fast." — Intercepted Feed',
  '"The enslaved worlds are already producing. That cannot be us." — Resistance',
  '"Our sensors show you are still alive. Good. Stay that way." — Earth Relay',
];

const RIVAL_WORLDS = ['World-3', 'World-5', 'World-6', 'World-7', 'World-8', 'World-9'];

// ── Public: pick a chaos event id, or null if none triggers ──────────────────

function pickChaosEvent(floor) {
  // Chance scales from 15% on floor 1 up to 65% on floor 10
  const chance = Math.min(0.15 + (floor - 1) * 0.055, 0.65);
  if (Math.random() > chance) return null;

  // Build weighted pool; rival encounters become more common on higher floors
  const pool = [];
  for (const ev of EVENT_POOL) {
    const w = ev.id === 'rival_encounter'
      ? Math.min(ev.weight + Math.floor(floor / 3), 5)
      : ev.weight;
    for (let i = 0; i < w; i++) pool.push(ev.id);
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Event handlers ────────────────────────────────────────────────────────────

function triggerSponsorDrop(player) {
  console.log('\n  ╔══════════════════════════════════╗');
  console.log('  ║  CHAOS EVENT: SPONSOR DROP       ║');
  console.log('  ╚══════════════════════════════════╝');
  if (Math.random() < 0.55) {
    player.inventory.push('small_potion');
    console.log('  A dimensional sponsor has noticed your performance.');
    console.log('  A healing vial materializes before you. [+small_potion]\n');
  } else {
    const dmg = 8 + Math.floor(Math.random() * 12);
    player.hp = Math.max(1, player.hp - dmg);
    console.log('  A cursed package arrives from an anonymous sender.');
    console.log(`  It detonates on contact. You take ${dmg} dimensional damage.`);
    console.log(`  (HP: ${player.hp}/${player.maxHp})\n`);
  }
}

function triggerDungeonInstability(player) {
  console.log('\n  ╔══════════════════════════════════╗');
  console.log('  ║  CHAOS EVENT: INSTABILITY        ║');
  console.log('  ╚══════════════════════════════════╝');
  const roll = Math.random();
  if (roll < 0.35) {
    player.attack += 2;
    console.log('  Reality fractures. Dimensional energy floods your body.');
    console.log(`  ATK +2 permanently. (ATK: ${player.attack})\n`);
  } else if (roll < 0.65) {
    const dmg = 5 + Math.floor(Math.random() * 10);
    player.hp = Math.max(1, player.hp - dmg);
    console.log('  A gravity surge rips through the corridor.');
    console.log(`  You take ${dmg} unavoidable damage. (HP: ${player.hp}/${player.maxHp})\n`);
  } else {
    player.defense += 1;
    console.log('  The dungeon\'s collapse hardens your skin.');
    console.log(`  DEF +1 permanently. (DEF: ${player.defense})\n`);
  }
}

function triggerEarthTransmission(player) {
  console.log('\n  ╔══════════════════════════════════╗');
  console.log('  ║  CHAOS EVENT: EARTH TRANSMISSION ║');
  console.log('  ╚══════════════════════════════════╝');
  const msg = EARTH_MESSAGES[Math.floor(Math.random() * EARTH_MESSAGES.length)];
  console.log(`\n  ${msg}\n`);
  const heal = 8;
  player.hp = Math.min(player.maxHp, player.hp + heal);
  console.log(`  The signal steadies you. +${heal} HP. (HP: ${player.hp}/${player.maxHp})\n`);
}

function triggerCrossWorldInterference(player) {
  console.log('\n  ╔══════════════════════════════════╗');
  console.log('  ║  CHAOS EVENT: DIMENSIONAL BREACH ║');
  console.log('  ╚══════════════════════════════════╝');
  const roll = Math.random();
  if (roll < 0.5) {
    const gold = 15 + Math.floor(Math.random() * 25);
    player.gold += gold;
    console.log(`  A rift tears open then seals. Something fell through: ${gold} gold.\n`);
  } else {
    const dmg = 12;
    player.hp = Math.max(1, player.hp - dmg);
    console.log(`  Dimensional pressure spikes. You take ${dmg} damage.`);
    console.log(`  (HP: ${player.hp}/${player.maxHp})\n`);
  }
}

// ── Rival encounter: returns enemy data for runCombat ─────────────────────────

function createRivalEnemy(floor) {
  const world = RIVAL_WORLDS[Math.floor(Math.random() * RIVAL_WORLDS.length)];
  const m = 1 + (floor - 1) * 0.20;
  return {
    name: `${world} Champion`,
    hp:         Math.round(40 * m),
    attack:     Math.round(11 * m),
    defense:    Math.round(3  * m),
    xp:         Math.round(75 * m),
    goldReward: Math.round(25 * m),
    loot: ['world_shard'],
    type: floor >= 6 ? 'aggressive' : 'trickster',
    abilities: ['battle_roar', 'heavy_hit', 'cleave'],
    intro: `A rival competitor from ${world} drops into your path. They are not here to talk.`,
  };
}

module.exports = {
  pickChaosEvent,
  triggerSponsorDrop,
  triggerDungeonInstability,
  triggerEarthTransmission,
  triggerCrossWorldInterference,
  createRivalEnemy,
};

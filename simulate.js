/**
 * Full playthrough simulation — real engine, deterministic inputs.
 * Shows exactly what a player would see from start to end.
 * Uses a smart-play combat AI: Guard on cooldown, Power Strike when ready, heal when low.
 */
const { createPlayer, showStats, gainXP } = require('./engine/state');
const { loadScenes, displayScene, getAvailableChoices, applyEffect } = require('./engine/sceneRunner');
const { runCombat } = require('./engine/combat');

const ITEMS = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'data/items.json'), 'utf-8'));
const scenes = loadScenes();

// ── Smart-play combat AI ──────────────────────────────────────────────────
function makeCombatAI(player, enemy) {
  let calls = 0;
  return () => {
    calls++;
    if (calls > 200) return '5'; // failsafe flee

    const abilities = player.abilities || [];
    const guard    = abilities.find(a => a.type === 'damage_reduce');
    const strike   = abilities.find(a => a.type === 'damage_bonus');
    const heal     = abilities.find(a => a.type === 'heal');
    const berserk  = abilities.find(a => a.type === 'berserk');

    const hpPct = player.hp / player.maxHp;

    // Heal ability if hurting and off cooldown
    const healIdx = heal && heal.currentCooldown === 0 ? abilities.indexOf(heal) + 1 : -1;
    if (heal && heal.currentCooldown === 0 && hpPct < 0.45) {
      // return '4' to open ability menu, then the index
      if (calls % 2 === 0) return String(healIdx);
      return '4';
    }

    // Use a heal potion if very low
    if (hpPct < 0.30 && player.inventory.length > 0) {
      const potIdx = player.inventory.findIndex(id => ITEMS[id]?.effect === 'heal');
      if (potIdx >= 0) {
        if (calls % 2 === 0) return String(potIdx + 1);
        return '3';
      }
    }

    // Guard if high enemy ATK and off cooldown
    if (guard && guard.currentCooldown === 0 && enemy.attack >= 12) {
      const gi = abilities.indexOf(guard) + 1;
      if (calls % 2 === 0) return String(gi);
      return '4';
    }

    // Berserk
    if (berserk && berserk.currentCooldown === 0 && player.hp > berserk.hpCost + 10) {
      const bi = abilities.indexOf(berserk) + 1;
      if (calls % 2 === 0) return String(bi);
      return '4';
    }

    // Power Strike
    if (strike && strike.currentCooldown === 0) {
      const si = abilities.indexOf(strike) + 1;
      if (calls % 2 === 0) return String(si);
      return '4';
    }

    return '1'; // default: attack
  };
}

// ── Scene navigation map ──────────────────────────────────────────────────
// [sceneId]: choice index (0-based), or array for multi-visit
const CHOICE_MAP = {
  start_room:     0,              // left passage
  left_path:      1,              // wall crack first
  left_crack:     0,              // pocket coins, face goblin
  trap_room:      2,              // pick carefully + grab potion (-8 HP, +small_potion)
  // supply_cache: visit 1 → search shelves (0); visit 2 → remaining is [strongbox, leave], pick leave (1)
  supply_cache:   [0, 1],
  hall_return:    0,
  // alchemy_lab: visit 1 → drink blue (0); visit 2 → remaining is [red, leave], pick leave (1)
  alchemy_lab:    [0, 1],
  // warden_trap: visit 1 → search desk (0); visit 2 → remaining is [footlocker, leave], pick leave (1)
  warden_trap:    [0, 1],
  // merge_room: supply(1) → alchemy(2) → warden(0) → arch(3)
  merge_room:     [1, 2, 0, 3],
  peril_room:     2,              // smash chest (-15 HP, +big_potion)
  end_room:       0,
};

// ── Run simulation ─────────────────────────────────────────────────────────
const player = createPlayer('Kael');
// Apply default upgrades (simulate one run of shop: +hp, +atk)
player.maxHp  += 5;
player.hp      = player.maxHp;
player.attack += 2;

let currentSceneId = 'start_room';
const visitCount = {};

console.log('\n' + '='.repeat(60));
console.log('  TRIAL OF TEN WORLDS - Full Playthrough Simulation');
console.log('='.repeat(60));
console.log('  Player: Kael | Mode: smart-play AI\n');

let steps = 0;
while (steps++ < 80) {
  const scene = scenes[currentSceneId];
  if (!scene) {
    console.log(`\n[CRASH] Unknown scene: "${currentSceneId}"`);
    process.exit(1);
  }

  displayScene(scene, player);
  showStats(player);

  // ── Combat ──
  if (scene.combat) {
    const ai = makeCombatAI(player, scene.combat);
    const result = runCombat(player, scene.combat, ai);
    if (result === 'defeat') {
      currentSceneId = 'game_over';
      console.log('\n  [SIMULATION NOTE: Player defeated — showing game_over scene]');
    } else if (result === 'fled') {
      currentSceneId = scene.fleeScene || 'start_room';
    } else {
      currentSceneId = scene.victoryScene || 'start_room';
    }
    continue;
  }

  // ── Item / gold grants ──
  if (scene.giveItem && !player.inventory.includes(scene.giveItem)) {
    player.inventory.push(scene.giveItem);
    console.log(`\n  [Item acquired: ${scene.giveItem}]`);
  }
  if (scene.giveGold) {
    player.gold += scene.giveGold;
    console.log(`  [Gold: +${scene.giveGold}]`);
    scene.giveGold = 0;
  }

  const choices = getAvailableChoices(scene, player);

  if (!choices || choices.length === 0) {
    console.log('\n  ~ THE END ~\n');
    break;
  }

  console.log('\n  What do you do?');
  choices.forEach((c, i) => console.log(`  ${i + 1}) ${c.text}`));

  visitCount[currentSceneId] = (visitCount[currentSceneId] || 0) + 1;
  const visit = visitCount[currentSceneId];

  let ci = 0;
  if (CHOICE_MAP[currentSceneId] !== undefined) {
    const cm = CHOICE_MAP[currentSceneId];
    ci = Array.isArray(cm) ? cm[Math.min(visit - 1, cm.length - 1)] : cm;
  }
  ci = Math.min(ci, choices.length - 1);

  const chosen = choices[ci];
  console.log(`\n  > ${chosen.text}`);
  if (chosen.effect) applyEffect(player, chosen.effect);

  if (chosen.once) {
    if (!player.usedChoices) player.usedChoices = {};
    if (!player.usedChoices[currentSceneId]) player.usedChoices[currentSceneId] = [];
    player.usedChoices[currentSceneId].push(chosen.text);
  }

  if (chosen.nextScene) {
    currentSceneId = chosen.nextScene;
    if (player.hp <= 0 && currentSceneId !== 'game_over' && currentSceneId !== 'the_end') {
      player.hp = 0;
      currentSceneId = 'game_over';
    }
  }
}

console.log('\n' + '='.repeat(60));
console.log('  Simulation complete.');
console.log('='.repeat(60));

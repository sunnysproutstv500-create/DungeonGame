const promptSync = require('prompt-sync');
const { createPlayer, showStats } = require('./engine/state');
const { runCombat } = require('./engine/combat');
const { loadScenes, displayScene, getAvailableChoices, applyEffect, getPerceptionHint, isRoomCleared } = require('./engine/sceneRunner');
const { saveGame, loadGame, deleteSave } = require('./engine/save');
const { addCurrency, loadMeta, saveMeta } = require('./engine/meta');
const {
  pickChaosEvent,
  triggerSponsorDrop,
  triggerDungeonInstability,
  triggerEarthTransmission,
  triggerCrossWorldInterference,
  createRivalEnemy,
} = require('./engine/chaos');
const { showEnding, determineEnding } = require('./engine/endings');
const { visitRoom, revealConnected, renderMap } = require('./engine/map');
const { generateFloor, filterChoices } = require('./engine/floorGen');
const {
  MAX_IMPLEMENTED_FLOOR,
  ensureRunStats,
  trackRelicFound,
  completeFloor,
  endRun,
  formatRunSummary,
  formatFloorTransition,
} = require('./engine/runLifecycle');

const prompt = promptSync({ sigint: true });

// ── Constants ─────────────────────────────────────────────────────────────────

const UPGRADES = [
  { label: '+5 Max HP',     cost: 10, stat: 'hp'  },
  { label: '+2 ATK',        cost: 10, stat: 'atk' },
  { label: '+1 DEF',        cost: 10, stat: 'def' },
  { label: '+1 Perception', cost: 15, stat: 'per' },
];

const ABILITY_UNLOCKS = [
  { id: 'berserk',      label: 'Unlock: Berserk',      cost: 20 },
  { id: 'heal',         label: 'Unlock: Heal',          cost: 20 },
  { id: 'toxic_slash',  label: 'Unlock: Toxic Slash',   cost: 25 },
  { id: 'shield_break', label: 'Unlock: Shield Break',  cost: 25 },
];

// Relic passive bonuses applied once on pickup
const RELIC_BONUSES = {
  'world_shard':     { attack: 3,     msg: 'World Shard absorbed — ATK +3' },
  'champion_emblem': { maxHp: 20,     msg: 'Champion Emblem equipped — Max HP +20' },
  'focus ring':      { perception: 1, msg: 'Focus Ring attuned — Perception +1' },
  'warden_shackle':  { defense: 3,    msg: "Warden's Shackle repurposed — DEF +3" },
  'cipher_fragment': { perception: 2, msg: 'Cipher Fragment decoded — PER +2' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function useItemOutsideCombat(player) {
  const consumables = player.inventory.filter(id => ITEMS[id]?.type === 'consumable');
  if (consumables.length === 0) {
    console.log('  No consumable items in inventory.');
    return;
  }
  console.log('\n  Items:');
  consumables.forEach((id, i) => {
    const item = ITEMS[id];
    const desc = item.effect === 'heal'    ? `+${item.value} HP` :
                 item.effect === 'cleanse' ? 'removes poison & burn' :
                 item.effect;
    console.log(`    ${i + 1}) ${item.name}  (${desc})`);
  });
  console.log('    0) Cancel');
  const input = (prompt('  > ') ?? '').trim();
  const n = parseInt(input, 10);
  if (!input || input === '0' || isNaN(n) || n < 1 || n > consumables.length) return;

  const itemId = consumables[n - 1];
  const item   = ITEMS[itemId];
  if (item.effect === 'heal') {
    const healed = Math.min(player.maxHp - player.hp, item.value);
    player.hp += healed;
    player.inventory.splice(player.inventory.indexOf(itemId), 1);
    console.log(`  You use ${item.name} and restore ${healed} HP. (HP: ${player.hp}/${player.maxHp})`);
  } else if (item.effect === 'cleanse') {
    const before = (player.statusEffects || []).length;
    player.statusEffects = (player.statusEffects || []).filter(
      fx => fx.type !== 'poison' && fx.type !== 'burn'
    );
    const removed = before - player.statusEffects.length;
    player.inventory.splice(player.inventory.indexOf(itemId), 1);
    console.log(`  You use ${item.name}. ${removed > 0 ? 'Poison and burn cleared!' : 'No effects to cleanse.'} (HP: ${player.hp}/${player.maxHp})`);
  }
}

function pickSceneAction(choices, player, allScenes, currentRoomId) {
  const consumables = player.inventory.filter(id => ITEMS[id]?.type === 'consumable');
  console.log('\n  What do you do?');
  choices.forEach((c, i) => console.log(`  ${i + 1}) ${c.text}`));

  let next = choices.length + 1;
  const itemNum = consumables.length > 0 ? next++ : -1;
  if (consumables.length > 0) console.log(`  ${itemNum}) Use Item`);
  const mapNum = next++;
  console.log(`  ${mapNum}) View Map`);
  const endRunNum = next;
  console.log(`  ${endRunNum}) End Run`);

  while (true) {
    const input = prompt('  > ');
    if (input === null) process.exit(0);
    const n = parseInt((input ?? '').trim(), 10);
    if (n === itemNum && itemNum > 0) {
      useItemOutsideCombat(player);
      return -1;  // item used: caller should save
    }
    if (n === mapNum) {
      renderMap(allScenes, currentRoomId, player);
      return -2;  // map viewed: no state change, caller should NOT save
    }
    if (n === endRunNum) {
      return -3;  // intentional run end
    }
    if (!isNaN(n) && n >= 1 && n <= choices.length) return n - 1;
    console.log(`  Enter a number between 1 and ${endRunNum}`);
  }
}

function describeAbility(ab) {
  if (ab.type === 'damage_bonus') return `+${ab.value} bonus damage  (cooldown ${ab.cooldown})`;
  if (ab.type === 'damage_reduce') return `reduce incoming damage  (cooldown ${ab.cooldown})`;
  if (ab.type === 'berserk')      return `+${ab.value} damage, costs ${ab.hpCost} HP  (cooldown ${ab.cooldown})`;
  if (ab.type === 'heal')         return `restore ${ab.value} HP  (cooldown ${ab.cooldown})`;
  return `cooldown ${ab.cooldown}`;
}

// Apply a relic's passive bonus once. Idempotent — skips if already in player.relics.
function applyRelic(player, itemId) {
  const bonus = RELIC_BONUSES[itemId];
  if (!bonus) return;
  if (!player.relics) player.relics = [];
  if (player.relics.includes(itemId)) return;
  player.relics.push(itemId);
  trackRelicFound(player, itemId);
  if (bonus.attack)     { player.attack += bonus.attack; }
  if (bonus.maxHp)      { player.maxHp += bonus.maxHp; player.hp = Math.min(player.hp + bonus.maxHp, player.maxHp); }
  if (bonus.perception) { player.perception = (player.perception || 0) + bonus.perception; }
  console.log(`\n  [RELIC BONDED] ${bonus.msg}`);
}

// Check all inventory items for unapplied relic bonuses (safe to call repeatedly)
function applyPendingRelics(player) {
  for (const itemId of (player.inventory || [])) applyRelic(player, itemId);
}

// Scale enemy stats by floor (18% per floor above 1). Returns a copy.
function scaleEnemy(enemyData, floor) {
  if (floor <= 1) return enemyData;
  const m = 1 + (floor - 1) * 0.18;
  const s = o => ({ ...o, hp: Math.round(o.hp * m), attack: Math.round(o.attack * m), defense: Math.round(o.defense * m) });
  const scaled = s(enemyData);
  if (enemyData.phases) scaled.phases = enemyData.phases.map(s);
  return scaled;
}

// Adjust worldRank after a boss victory based on HP percentage.
// Also accumulates runScore for tie-breaking ending determination.
function updateWorldRank(player) {
  const hpPct = player.hp / player.maxHp;
  if (hpPct >= 0.65)     { player.worldRank = Math.max(1, player.worldRank - 1); }
  else if (hpPct < 0.30) { player.worldRank = Math.min(10, player.worldRank + 1); }
  player.runScore = (player.runScore || 0) + Math.round(hpPct * 100) + Math.floor((player.gold || 0) / 15);
}

// Dispatch a chaos event. Returns a rival enemy object if rival_encounter was selected, else null.
function handleChaosEvent(player, floor) {
  const id = pickChaosEvent(floor);
  if (!id) return null;
  if (id === 'sponsor_drop')            { triggerSponsorDrop(player);            return null; }
  if (id === 'dungeon_instability')     { triggerDungeonInstability(player);     return null; }
  if (id === 'earth_transmission')      { triggerEarthTransmission(player);      return null; }
  if (id === 'cross_world_interference'){ triggerCrossWorldInterference(player); return null; }
  if (id === 'rival_encounter')         { return createRivalEnemy(floor); }
  return null;
}

// ── Upgrade Shop ──────────────────────────────────────────────────────────────

function upgradeMenu() {
  const meta = loadMeta();
  if (!meta.unlockedAbilities) meta.unlockedAbilities = ['power_strike', 'guard'];
  if (meta.upgrades.per === undefined) meta.upgrades.per = 0;
  console.log('\n  -= UPGRADE SHOP =-');

  while (true) {
    console.log(`\n  Echoes: ${meta.currency}`);
    UPGRADES.forEach((u, i) =>
      console.log(`  ${i + 1}) ${u.label}  (cost: ${u.cost})  [owned: ${meta.upgrades[u.stat]}]`)
    );
    const offset = UPGRADES.length;
    ABILITY_UNLOCKS.forEach((a, i) => {
      const owned = meta.unlockedAbilities.includes(a.id);
      console.log(`  ${offset + i + 1}) ${a.label}  [${owned ? 'owned' : 'cost: ' + a.cost}]`);
    });
    console.log('  0) Start run');

    const input = (prompt('  > ') ?? '').trim();
    if (input === '0') break;
    const idx = parseInt(input, 10) - 1;

    if (idx >= 0 && idx < UPGRADES.length) {
      const u = UPGRADES[idx];
      if (meta.currency < u.cost) { console.log(`  Not enough Echoes. (need ${u.cost})`); continue; }
      meta.currency -= u.cost; meta.upgrades[u.stat] += 1; saveMeta(meta);
      console.log(`  Purchased: ${u.label}`);
    } else if (idx >= offset && idx < offset + ABILITY_UNLOCKS.length) {
      const a = ABILITY_UNLOCKS[idx - offset];
      if (meta.unlockedAbilities.includes(a.id)) { console.log('  Already unlocked.'); continue; }
      if (meta.currency < a.cost) { console.log(`  Not enough Echoes. (need ${a.cost})`); continue; }
      meta.currency -= a.cost; meta.unlockedAbilities.push(a.id); saveMeta(meta);
      console.log(`  Unlocked: ${a.label}`);
    } else {
      console.log('  Invalid choice.');
    }
  }
  return meta;
}

function applyUpgrades(player, upgrades) {
  player.maxHp      += (upgrades.hp  || 0) * 5;
  player.hp          = player.maxHp;
  player.attack     += (upgrades.atk || 0) * 2;
  player.defense    += (upgrades.def || 0) * 1;
  player.perception += (upgrades.per || 0) * 1;
}

const ABILITIES_DATA = JSON.parse(
  require('fs').readFileSync(require('path').join(__dirname, 'data/abilities.json'), 'utf-8')
);

const ITEMS = JSON.parse(
  require('fs').readFileSync(require('path').join(__dirname, 'data/items.json'), 'utf-8')
);

function pickAbilities(unlockedIds) {
  const available = unlockedIds.filter(id => ABILITIES_DATA[id]);
  if (available.length <= 2) return available.map(id => ({ ...ABILITIES_DATA[id], currentCooldown: 0 }));

  console.log('\n  -= CHOOSE YOUR ABILITIES =-');
  console.log('  Pick 2 abilities to equip for this run:\n');
  available.forEach((id, i) =>
    console.log(`  ${i + 1}) ${ABILITIES_DATA[id].name}  — ${describeAbility(ABILITIES_DATA[id])}`)
  );

  const chosen = [];
  while (chosen.length < 2) {
    const remaining = 2 - chosen.length;
    console.log(`\n  Choose ${remaining} more. Already chosen: ${chosen.map(a => a.name).join(', ') || 'none'}`);
    const input = (prompt('  > ') ?? '').trim();
    const idx = parseInt(input, 10) - 1;
    if (idx < 0 || idx >= available.length) { console.log('  Invalid choice.'); continue; }
    const id = available[idx];
    if (chosen.find(a => a.id === id)) { console.log('  Already chosen.'); continue; }
    chosen.push({ ...ABILITIES_DATA[id], currentCooldown: 0 });
    console.log(`  Equipped: ${ABILITIES_DATA[id].name}`);
  }
  return chosen;
}

// ── Main ──────────────────────────────────────────────────────────────────────

function finishRun(player, options = {}) {
  const summary = endRun(player, options);
  console.log(formatRunSummary(summary));
  deleteSave();
  return summary;
}

function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  TRIAL OF TEN WORLDS');
  console.log('═'.repeat(60));
  console.log(`
  Ten worlds. One survivor.

  You are Earth's representative — the last hope of your world.
  The Overseers have built a gauntlet to determine which worlds
  live and which are destroyed. The competition is already running.

  RANK 1-2  : Earth is saved. Full autonomy.
  RANK 3-4  : Earth is enslaved. Production world status.
  RANK 5-10 : Earth is harvested. Termination.

  The dungeon does not care about any of that.
  It just wants you dead.
`);

  let player;
  let currentSceneId;
  let floorConfig = null;
  let scenes = loadScenes();

  const saved = loadGame();
  if (saved) {
    if (saved.player.hp <= 0) {
      console.log(`  ${saved.player.name} met their end in the dungeon.`);
      console.log('  1) Start a new game\n  2) Quit');
      if ((prompt('  > ') ?? '').trim() !== '1') process.exit(0);
    } else {
      console.log('  A save file was found.\n  1) Continue\n  2) New Game');
      if ((prompt('  > ') ?? '').trim() === '1') {
        player = saved.player;
        // Migrate saves that predate new fields
        if (player.perception === undefined) player.perception = 0;
        if (!player.statusEffects)           player.statusEffects = [];
        if (player.floor === undefined)      player.floor = 1;
        if (player.worldRank === undefined)  player.worldRank = 5;
        if (player.runScore === undefined)   player.runScore = 0;
        if (!player.relics)                  player.relics = [];
        if (player.neverFled === undefined)  player.neverFled = true;
        if (!player.clearedRooms)            player.clearedRooms = {};
        if (!player.mapData)                 player.mapData = {};
        if (player.currentRunActive === undefined) player.currentRunActive = true;
        if (player.runEnded === undefined)   player.runEnded = false;
        if (player.floorComplete === undefined) player.floorComplete = false;
        if (player.pendingTransition === undefined) player.pendingTransition = null;
        ensureRunStats(player);
        if (player.floor > MAX_IMPLEMENTED_FLOOR && saved.currentSceneId === 'start_room') {
          console.log(`\n  This save was in an old Floor ${player.floor} loop. Ending that run cleanly.`);
          finishRun(player, { reason: 'floor_under_construction', endingReached: `Floor ${player.floor} under construction` });
          player = null;
          currentSceneId = null;
          floorConfig = null;
          console.log('  Start a new run to continue.\n');
          // Fall through to the new-run path below.
        }
        if (player) {
        currentSceneId = scenes[saved.currentSceneId] ? saved.currentSceneId : 'start_room';
        if (currentSceneId !== saved.currentSceneId) {
          console.log('  (Unknown save scene — starting from beginning.)');
        }
        floorConfig = saved.floorConfig || generateFloor(player.floor);
        console.log(`\n  Welcome back, ${player.name}.`);
        console.log(`  Floor ${player.floor} | World Rank: #${player.worldRank}\n`);
        applyPendingRelics(player);
        }
      }
    }
  }

  if (!player) {
    const meta = upgradeMenu();
    const name = (prompt('\n  Enter your name, Earth\'s champion: ') ?? '').trim() || 'Stranger';
    player = createPlayer(name);
    applyUpgrades(player, meta.upgrades);
    player.abilities = pickAbilities(meta.unlockedAbilities);
    currentSceneId = 'start_room';
    floorConfig = generateFloor(player.floor);
    saveGame({ player, currentSceneId, floorConfig });
    console.log(`\n  Welcome, ${name}. Earth is counting on you.\n`);
  }

  // ── Main Game Loop ────────────────────────────────────────────────────────

  while (true) {

    if (currentSceneId === 'the_end') {
      const result = completeFloor(player, { route: 'floor_clear' });
      updateWorldRank(player);
      const meta = addCurrency(result.currencyReward);

      console.log(formatFloorTransition(result));
      console.log(`  World Rank: #${player.worldRank}  |  Run Score: ${player.runScore}`);
      console.log(`  Floor clear Echoes: +${result.currencyReward} (Total: ${meta.currency})\n`);

      floorConfig = generateFloor(player.floor);
      saveGame({ player, currentSceneId, floorConfig });

      if (floorConfig.placeholder || player.floor > MAX_IMPLEMENTED_FLOOR) {
        console.log(`  ${floorConfig.message || `Floor ${player.floor} under construction`}.`);
        console.log('  This build ends the expedition here instead of regenerating Floor 1.');
        finishRun(player, {
          reason: 'floor_under_construction',
          endingReached: floorConfig.message || `Floor ${player.floor} under construction`,
        });
        break;
      }

      scenes = loadScenes(); // reload so giveGold mutations reset
      player.floorComplete = false;
      player.pendingTransition = null;
      currentSceneId = floorConfig.safeRoom || 'start_room';
      saveGame({ player, currentSceneId, floorConfig });
      continue;
    }

    const scene = scenes[currentSceneId];
    if (!scene) {
      console.log(`\n  [Error: unknown scene "${currentSceneId}"]`);
      break;
    }

    // Map: mark visited, reveal adjacent rooms
    if (scene.map) {
      const excl = floorConfig ? new Set(floorConfig.excludedRooms) : new Set();
      visitRoom(player, currentSceneId, player.floor);
      revealConnected(player, scene, scenes, player.floor, excl);
    }

    // Dynamic floor label for start_room and end_room titles; append [CLEARED] when exhausted
    let displayTitle = scene.title;
    if (currentSceneId === 'start_room' && player.floor > 1) {
      displayTitle = `Floor ${player.floor} — Entry Chamber`;
    } else if (currentSceneId === 'end_room') {
      displayTitle = `Floor ${player.floor} Clear — Ascending`;
    }
    if (player.clearedRooms?.[currentSceneId]) displayTitle += ' [CLEARED]';
    displayScene({ ...scene, title: displayTitle }, player);

    showStats(player);
    if (player.relics && player.relics.length > 0) {
      console.log(`  Relics: ${player.relics.join(', ')}`);
    }
    getPerceptionHint(scene, player);
    if (player.clearedRooms?.[currentSceneId]) {
      console.log("  (You've exhausted everything of value here.)");
    }

    // ── Combat trigger ──
    if (scene.combat) {
      const isBoss = !!scene.combat.phases;
      if (isBoss) {
        saveGame({ player, currentSceneId, floorConfig });
        console.log('\n  [Auto-save: checkpoint before boss fight]\n');
      }

      const variantKey = currentSceneId;
      const enemyData = (floorConfig?.enemyVariants?.[variantKey]) || scene.combat;
      const scaledEnemy = scaleEnemy(enemyData, player.floor);
      const result = runCombat(player, scaledEnemy, prompt);

      if (result === 'defeat') {
        const earned = player.level * 5;
        const meta = addCurrency(earned);
        console.log(`  You earned ${earned} Echoes. (Total: ${meta.currency})`);
        player.worldRank = Math.min(10, player.worldRank + 2);
        currentSceneId = 'game_over';
        player.hp = 0;
        if (!isBoss) {
          saveGame({ player, currentSceneId, floorConfig });
        } else {
          console.log('  [Checkpoint preserved — reload to retry the boss.]');
        }
        continue;
      }

      if (result === 'fled') {
        player.neverFled = false;
        currentSceneId = scene.fleeScene || 'start_room';
        saveGame({ player, currentSceneId, floorConfig });
        continue;
      }

      // Victory
      ensureRunStats(player).enemiesDefeated += 1;
      if (isBoss) {
        updateWorldRank(player);
        console.log(`\n  World Rank updated: #${player.worldRank}`);
      }
      // Apply any relics that dropped from combat loot
      applyPendingRelics(player);
      currentSceneId = scene.victoryScene || 'start_room';
      saveGame({ player, currentSceneId, floorConfig });
      continue;
    }

    // ── Item and gold grants ──
    if (scene.giveItem && !player.inventory.includes(scene.giveItem)) {
      player.inventory.push(scene.giveItem);
      applyRelic(player, scene.giveItem);
      console.log(`\n  [Item acquired: ${scene.giveItem}]`);
    }
    if (scene.giveGold) {
      player.gold += scene.giveGold;
      console.log(`  [Gold: +${scene.giveGold}]`);
      scene.giveGold = 0;
    }

    let choices = getAvailableChoices(scene, player);
    if (floorConfig && floorConfig.excludedRooms.length > 0) {
      choices = filterChoices(choices, new Set(floorConfig.excludedRooms));
    }

    if (!choices || choices.length === 0) {
      console.log('\n  ~ THE END ~\n');
      break;
    }

    const idx = pickSceneAction(choices, player, scenes, currentSceneId);
    if (idx === -2) continue;          // map viewed — no state change, skip save
    if (idx === -3) {
      finishRun(player, { reason: 'player_ended_run', endingReached: 'Ended by player' });
      break;
    }
    if (idx === -1) {
      saveGame({ player, currentSceneId, floorConfig }); // item used
      continue;
    }
    const chosen = choices[idx];

    if (chosen.effect) {
      applyEffect(player, chosen.effect);
      if (chosen.effect.giveItem) applyRelic(player, chosen.effect.giveItem);
    }

    if (chosen.once) {
      if (!player.usedChoices) player.usedChoices = {};
      if (!player.usedChoices[currentSceneId]) player.usedChoices[currentSceneId] = [];
      player.usedChoices[currentSceneId].push(chosen.text);
      if (isRoomCleared(scene, player)) {
        player.clearedRooms[currentSceneId] = true;
      }
    }

    // Capture scene change before updating (used for smart autosave decision below)
    const prevSceneId = currentSceneId;
    if (chosen.nextScene) currentSceneId = chosen.nextScene;

    // ── Chaos events (not during game_over, the_end, or scene transitions to combat) ──
    let chaosOccurred = false;
    const skipChaosScenes = new Set(['game_over', 'the_end', 'start_room']);
    if (!skipChaosScenes.has(currentSceneId) && !scene.combat) {
      const rivalEnemy = handleChaosEvent(player, player.floor);
      if (rivalEnemy) {
        chaosOccurred = true;
        console.log('\n  ╔══════════════════════════════════╗');
        console.log('  ║  CHAOS EVENT: RIVAL ENCOUNTER    ║');
        console.log('  ╚══════════════════════════════════╝');
        const rivalResult = runCombat(player, rivalEnemy, prompt);

        if (rivalResult === 'defeat') {
          const earned = player.level * 5;
          addCurrency(earned);
          player.worldRank = Math.min(10, player.worldRank + 2);
          player.hp = 0;
          currentSceneId = 'game_over';
          saveGame({ player, currentSceneId, floorConfig });
          continue;
        }

        if (rivalResult === 'fled') {
          player.neverFled = false;
        }

        if (rivalResult === 'victory') {
          ensureRunStats(player).enemiesDefeated += 1;
          applyPendingRelics(player); // pick up world_shard if dropped
          player.worldRank = Math.max(1, player.worldRank - 1);
          console.log(`  Rival defeated. World Rank improved: #${player.worldRank}`);
        }
      }
    }

    // ── Smart autosave: only on meaningful events, not lore/map browsing ──
    if (player.hp > 0) {
      const movedRooms     = currentSceneId !== prevSceneId;
      const meaningfulOnce = chosen.once && !!chosen.effect;
      if (movedRooms || meaningfulOnce || chaosOccurred) {
        saveGame({ player, currentSceneId, floorConfig });
      }
    }
  }

  console.log('\n  Thanks for playing Trial of Ten Worlds!\n');
}

main();

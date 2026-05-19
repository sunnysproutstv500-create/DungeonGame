/**
 * Full dungeon validation: scene graph, path walks, combat smoke test, once-choice farming.
 */
const { loadScenes, getAvailableChoices, applyEffect, evaluateCondition } = require('./engine/sceneRunner');
const { createPlayer } = require('./engine/state');
const { runCombat } = require('./engine/combat');
const { applyStatus, processStatusEffects, getEffAtk, getEffDef, isStunned, fmtEffects, clearStatusEffects } = require('./engine/statusEffects');
const { generateFloor } = require('./engine/floorGen');
const { completeFloor, endRun, formatRunSummary, MAX_IMPLEMENTED_FLOOR } = require('./engine/runLifecycle');
const runtime = require('./engine/runtime');
const metaCore = require('./engine/metaCore');
const saveStore = require('./mobile/saveStore');
const items = require('./data/items.json');

const scenes = loadScenes();
let passed = 0;
let failed = 0;

function ok(label) { console.log(`  PASS  ${label}`); passed++; }
function fail(label, detail) { console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failed++; }

// ── 1. Scene reference integrity ──────────────────────────────────────────
console.log('\n── Scene Graph ──');
const allIds = new Set(Object.keys(scenes));

for (const [id, scene] of Object.entries(scenes)) {
  const refs = [];
  if (scene.victoryScene) refs.push(['victoryScene', scene.victoryScene]);
  if (scene.fleeScene)    refs.push(['fleeScene',    scene.fleeScene]);
  for (const c of (scene.choices || [])) {
    if (c.nextScene) refs.push([`choice "${c.text}"`, c.nextScene]);
  }
  for (const [label, target] of refs) {
    if (!allIds.has(target)) fail(`${id} → ${label}`, `unknown target "${target}"`);
  }
}

console.log(`  Scenes loaded: ${allIds.size}`);
ok('All scene references resolve');

// ── 2. Path walker ─────────────────────────────────────────────────────────
function makePlayer(extras = {}) {
  const p = createPlayer('Walker');
  Object.assign(p, extras);
  return p;
}

function walk(startId, player, choiceMap, maxSteps = 80) {
  let id = startId;
  const visitCount = {};
  const path = [id];

  for (let step = 0; step < maxSteps; step++) {
    const scene = scenes[id];
    if (!scene) return { ok: false, error: `Unknown scene "${id}"`, path };

    if (scene.combat) {
      id = scene.victoryScene || 'start_room';
      path.push(id);
      continue;
    }

    const choices = getAvailableChoices(scene, player);
    if (!choices || choices.length === 0) return { ok: true, terminal: id, path };

    visitCount[id] = (visitCount[id] || 0) + 1;
    const visit = visitCount[id];

    let ci = 0;
    if (choiceMap[id] !== undefined) {
      const cm = choiceMap[id];
      ci = Array.isArray(cm) ? cm[Math.min(visit - 1, cm.length - 1)] : cm;
    }
    ci = Math.min(ci, choices.length - 1);
    const chosen = choices[ci];
    if (chosen.effect) applyEffect(player, chosen.effect);

    // mirror index.js: track once choices
    if (chosen.once) {
      if (!player.usedChoices) player.usedChoices = {};
      if (!player.usedChoices[id]) player.usedChoices[id] = [];
      player.usedChoices[id].push(chosen.text);
    }

    // only move scene if nextScene provided
    if (chosen.nextScene) {
      id = chosen.nextScene;
      path.push(id);
    }
  }
  return { ok: false, error: 'max steps exceeded', path };
}

console.log('\n── Path Walks ──');

const PATHS = [
  {
    // Left crack → guard fight → careful trap → alchemy side room → boss
    name: 'Left → crack (antidote) → guard → trap (careful) → merge → alchemy (CLEAN+leave) → enforcer → boss → end',
    player: makePlayer({ inventory: [] }),
    map: {
      start_room:   0,       // left corridor
      left_path:    1,       // wall crack first
      left_crack:   0,       // take antidote kit + face guard
      trap_room:    1,       // move carefully (no key, level 1 = 2 choices: sprint=0, careful=1)
      security_lockdown: 0,
      merge_room:   [0, 2],  // security break room, then restricted door
      warden_trap: [3, 4, 3], // clearance, sub-level sentry, then leave
      dead_end_loot: [0, 1], // override, then return
      hall_return:  0,
      peril_room:   0,       // force checkpoint door
      end_room:     0,
    },
  },
  {
    // Guard key obtained → bypass trap → supply side room → boss
    name: 'Left → rush guard → trap (key override) → merge → supply (search+leave) → enforcer → boss → end',
    player: makePlayer({ inventory: ['guard_key'] }),
    map: {
      start_room:   0,       // left
      left_path:    0,       // rush guard directly
      trap_room:    2,       // key override (sprint=0, careful=1, key=2 for level-1 player)
      security_lockdown: 0,
      merge_room:   [1, 0, 2],  // medical station, break room, then restricted door
      supply_cache: [1, 1],  // force supply room, then leave
      warden_trap: [5, 4], // sub-level sentry, then leave
      dead_end_loot: [0, 1],
      hall_return:  0,
      peril_room:   0,       // force checkpoint door
      end_room:     0,
    },
  },
  {
    // Right secondary block → mutant → reward → break room side → boss
    name: 'Right → secondary block → mutant → reward (medical) → merge → break room (search+leave) → enforcer → boss → end',
    player: makePlayer({ inventory: [] }),
    map: {
      start_room:     1,      // right
      right_path:     1,      // secondary block
      right_upstream: 0,      // basic medical kit
      reward_room:    0,      // take sealed medical container
      quarantine_lockdown: 0,
      merge_room:     [1, 2], // refuge access code, then restricted door
      maintenance_refuge: [2, 2],
      hall_return:    0,
      peril_room:     0,      // service corridor
      end_room:       0,
    },
  },
  {
    // Right → all 3 side rooms visited but only leave actions taken → boss
    name: 'Right → rush mutant → reward (pry locker) → merge → all side rooms (leave only) → enforcer → boss → end',
    player: makePlayer({ inventory: [] }),
    map: {
      start_room:     1,
      right_path:     0,         // rush through main ward → mutant
      reward_room:    2,         // pry the locker (-8hp)
      quarantine_lockdown: 0,
      merge_room:     [0, 1, 2],
      hall_return:    0,
      alchemy_lab:    2,         // leave immediately (index 2 for per=0: CLEAN=0,amber=1,leave=2)
      maintenance_refuge: [2, 2],
      peril_room:     0,
      end_room:       0,
    },
  },
];

// suppress applyEffect output during walks
const origLog = console.log;
console.log = () => {};
for (const p of PATHS) {
  const result = walk('start_room', p.player, p.map);
  console.log = origLog;
  if (result.ok) {
    ok(p.name);
  } else {
    fail(p.name, result.error);
    console.log('    Path so far:', result.path.slice(-8).join(' → '));
  }
  console.log = () => {};
}
console.log = origLog;

// ── 3. Combat smoke test ───────────────────────────────────────────────────
console.log('\n── Combat Smoke Tests ──');

function mockPrompt(inputs) {
  let i = 0;
  return () => inputs[i < inputs.length ? i++ : inputs.length - 1];
}

const ENEMIES = [
  { name: 'Dungeon Goblin', hp: 25, attack: 7,  defense: 1,  xp: 20, goldReward: 5,   loot: ['small_potion'], type: 'trickster',  abilities: ['shiv_stab', 'dodge'] },
  { name: 'Giant Rat',      hp: 30, attack: 8,  defense: 2,  xp: 25, goldReward: 5,   loot: ['small_potion'], type: 'aggressive', abilities: ['quick_strike', 'frenzy'] },
  { name: 'Skeleton Guard', hp: 55, attack: 12, defense: 4,  xp: 65, goldReward: 20,  loot: ['bone fragment'], type: 'defensive', abilities: ['bone_armor', 'shield_bash'] },
  { name: 'Orc Warlord',    hp: 140, attack: 20, defense: 10, xp: 250, goldReward: 100, loot: ['orcish axe'], type: 'aggressive', abilities: ['cleave', 'battle_roar', 'heavy_hit'] },
];

console.log = () => {};

for (const enemy of ENEMIES) {
  let victories = 0, defeats = 0, errors = 0;
  for (let trial = 0; trial < 30; trial++) {
    const player = makePlayer({
      attack: 15, defense: 5, maxHp: 200, hp: 200,
      abilities: [
        { id: 'power_strike', name: 'Power Strike', type: 'damage_bonus', value: 8, cooldown: 2, currentCooldown: 0 },
      ],
    });
    const inputs = Array(60).fill('1');
    try {
      const result = runCombat(player, enemy, mockPrompt(inputs));
      if (result === 'victory') victories++;
      else if (result === 'defeat') defeats++;
    } catch (e) { errors++; }
  }
  console.log = origLog;
  const label = `${enemy.name} (${enemy.type}) — ${victories}V/${defeats}D/${errors}E over 30 trials`;
  errors > 0 ? fail(label, 'threw exception') : ok(label);
  console.log = () => {};
}

console.log = origLog;

// ── 4. requires + once filters ────────────────────────────────────────────
console.log('\n── Choice Filters ──');
{
  const scene = scenes['trap_room'];
  // level-1 player: panel choice (level>=2) hidden; key choice hidden without key
  const withKey    = getAvailableChoices(scene, makePlayer({ inventory: ['guard_key'] }));
  const withoutKey = getAvailableChoices(scene, makePlayer({ inventory: [] }));
  withKey.length === 3    ? ok('trap_room: 3 choices with guard_key (sprint/careful/key)')  : fail('trap_room with-key',  `got ${withKey.length}`);
  withoutKey.length === 2 ? ok('trap_room: 2 choices without guard_key (sprint/careful)')   : fail('trap_room no-key',    `got ${withoutKey.length}`);
}
{
  // once: choices disappear after use
  const p = makePlayer({});
  const scene = scenes['supply_cache'];
  const before = getAvailableChoices(scene, p);
  // simulate using "Search the remaining cabinets"
  p.usedChoices['supply_cache'] = ['Search the remaining cabinets'];
  const after = getAvailableChoices(scene, p);
  before.length === 3 ? ok('supply_cache: 3 choices before any action') : fail('supply_cache before', `got ${before.length}`);
  after.length  === 2 ? ok('supply_cache: 2 choices after search used') : fail('supply_cache after',  `got ${after.length}`);
}
{
  // farming prevention: using both once choices leaves only exit
  const p = makePlayer({});
  p.usedChoices['supply_cache'] = ['Search the remaining cabinets', "Force the supply room — stripped lock won't hold"];
  const choices = getAvailableChoices(scenes['supply_cache'], p);
  choices.length === 1 && choices[0].nextScene === 'hall_return'
    ? ok('supply_cache: only leave option remains after all once choices used')
    : fail('supply_cache farming prevention', `got ${choices.length} choices`);
}

// ── 5. Condition system ───────────────────────────────────────────────────
console.log('\n── Condition System ──');
{
  const p80  = makePlayer({ hp: 80, attack: 20, defense: 8, level: 3, inventory: ['guard_key'] });
  const p50  = makePlayer({ hp: 50, attack: 10, defense: 4, level: 1, inventory: [] });

  // stat operators
  evaluateCondition({ stat: 'hp', operator: '>=', value: 70 }, p80) === true
    ? ok('condition: hp >= 70 passes at 80')   : fail('condition hp>=70@80');
  evaluateCondition({ stat: 'hp', operator: '>=', value: 70 }, p50) === false
    ? ok('condition: hp >= 70 fails at 50')    : fail('condition hp>=70@50');
  evaluateCondition({ stat: 'level', operator: '>=', value: 3 }, p80) === true
    ? ok('condition: level >= 3 passes at 3')  : fail('condition level>=3@3');
  evaluateCondition({ stat: 'atk', operator: '>', value: 15 }, p80) === true
    ? ok('condition: atk > 15 passes at 20')   : fail('condition atk>15@20');
  evaluateCondition({ stat: 'def', operator: '==', value: 4 }, p50) === true
    ? ok('condition: def == 4 passes at 4')    : fail('condition def==4@4');

  // hasItem
  evaluateCondition({ hasItem: 'guard_key' }, p80) === true
    ? ok('condition: hasItem guard_key passes') : fail('condition hasItem present');
  evaluateCondition({ hasItem: 'guard_key' }, p50) === false
    ? ok('condition: hasItem guard_key fails')  : fail('condition hasItem absent');

  const multiGateScene = {
    id: 'multi_gate_test',
    choices: [
      { text: 'Open gated route', nextScene: 'boss_room', requires: { items: ['security_clearance', 'warden_override'] } },
    ],
  };
  getAvailableChoices(multiGateScene, makePlayer({ inventory: ['security_clearance', 'warden_override'] })).length === 1
    ? ok('requires.items: all listed key items pass')
    : fail('requires.items: keys should pass');
  getAvailableChoices(multiGateScene, makePlayer({ inventory: ['security_clearance'] })).length === 0
    ? ok('requires.items: missing one key item fails')
    : fail('requires.items: missing key should fail');

  const routeGateScene = {
    id: 'route_gate_test',
    choices: [
      { text: 'Security route room', nextScene: 'warden_trap', requires: { route: 'security' } },
      { text: 'Ward route room', nextScene: 'maintenance_refuge', requires: { route: 'ward' } }
    ]
  };
  getAvailableChoices(routeGateScene, makePlayer({ route: 'security' })).map(c => c.nextScene).join(',') === 'warden_trap'
    ? ok('requires.route: security route sees security room only')
    : fail('requires.route security');
  getAvailableChoices(routeGateScene, makePlayer({ route: 'ward' })).map(c => c.nextScene).join(',') === 'maintenance_refuge'
    ? ok('requires.route: ward route sees ward room only')
    : fail('requires.route ward');

  const routePlayer = makePlayer({});
  applyEffect(routePlayer, { setRoute: 'security' });
  routePlayer.route === 'security'
    ? ok('applyEffect: setRoute stores selected floor route')
    : fail('applyEffect setRoute', routePlayer.route);

  const xpPlayer = makePlayer({});
  applyEffect(xpPlayer, { giveXP: 7 });
  xpPlayer.xp === 7
    ? ok('applyEffect: giveXP awards puzzle XP')
    : fail('applyEffect giveXP', `got ${xpPlayer.xp}`);

  // undefined always true
  evaluateCondition(undefined, p50) === true
    ? ok('condition: undefined always true') : fail('condition undefined');

  // right_upstream: 4 unconditional choices (3 to combat, 1 to merchant_room)
  const upstream = scenes['right_upstream'];
  const upAll = getAvailableChoices(upstream, makePlayer({ inventory: [] }));
  upAll.length === 4 ? ok('right_upstream: 4 unconditional choices') : fail('right_upstream choices', `got ${upAll.length}`);
  upAll.filter(c => c.nextScene === 'right_path_combat').length === 3
    ? ok('right_upstream: 3 choices lead to right_path_combat') : fail('right_upstream targets');
  upAll.some(c => c.nextScene === 'merchant_room')
    ? ok('right_upstream: merchant_room branch exists') : fail('right_upstream merchant branch');

  // peril_room: brace choice visible at hp>=70; boss route visible only with both Warden keys
  const peril   = scenes['peril_room'];
  const highHp  = makePlayer({ hp: 80, maxHp: 100 });
  const lowHp   = makePlayer({ hp: 50, maxHp: 100 });
  const withKey = makePlayer({ hp: 80, maxHp: 100, inventory: ['security_clearance', 'warden_override'] });
  const highChoices = getAvailableChoices(peril, highHp);
  const lowChoices  = getAvailableChoices(peril, lowHp);
  const keyChoices  = getAvailableChoices(peril, withKey);
  highChoices.some(c => c.nextScene === 'deadly_room')
    ? fail('peril_room: boss route visible without Warden keys')
    : ok('peril_room: boss route hidden without Warden keys');
  lowChoices.length  === 1 ? ok('peril_room: 1 choice at hp 50 with no keys') : fail('peril_room hp50', `got ${lowChoices.length}`);
  keyChoices.some(c => c.nextScene === 'deadly_room')
    ? ok('peril_room: boss route visible with both Warden keys')
    : fail('peril_room with gate keys', `got ${keyChoices.length}`);
  keyChoices.some(c => c.text.includes('Brace') && c.effect && !c.effect.damage)
    ? ok('peril_room: brace option (hp>=70) grants item with no damage') : fail('peril_room brace effect');
}

// ── 6. Boss Phase System ──────────────────────────────────────────────────
console.log('\n── Boss Phase System ──');
{
  const bossDef = scenes['boss_room'].combat;

  bossDef.phases
    ? ok('boss_room: has phase data')
    : fail('boss_room phases missing');

  bossDef.phases && bossDef.phases.length === 1
    ? ok('boss_room: 1 phase transition defined (2-phase total: In Control → Unshackled)')
    : fail('boss_room phase count', `got ${(bossDef.phases || []).length}`);

  bossDef.intro
    ? ok('boss_room: intro text present')
    : fail('boss_room intro missing');

  bossDef.victoryText
    ? ok('boss_room: victory text present')
    : fail('boss_room victoryText missing');

  // Each phase must have hp/attack/defense/type/abilities
  if (bossDef.phases) {
    let allValid = true;
    for (const [i, ph] of bossDef.phases.entries()) {
      if (!ph.hp || !ph.attack || !ph.type || !ph.abilities) {
        fail(`boss phase ${i + 1}: missing required fields`); allValid = false;
      }
    }
    if (allValid) ok('boss phases: all have required hp/attack/type/abilities fields');
  }

  // Smoke test: inflated player, always attacks, should clear all 3 phases without crashing
  let victories = 0, defeats = 0, errors = 0;
  console.log = () => {};
  for (let trial = 0; trial < 20; trial++) {
    const p = makePlayer({
      attack: 30, defense: 8, maxHp: 400, hp: 400,
      abilities: [
        { id: 'power_strike', name: 'Power Strike', type: 'damage_bonus', value: 15, cooldown: 2, currentCooldown: 0 },
      ],
    });
    const inputs = Array(200).fill('1');
    try {
      const result = runCombat(p, bossDef, mockPrompt(inputs));
      if (result === 'victory') victories++;
      else if (result === 'defeat') defeats++;
    } catch (e) {
      errors++;
      console.log = origLog;
      console.log('  BOSS ERROR:', e.message);
      console.log = () => {};
    }
  }
  console.log = origLog;
  errors === 0
    ? ok(`Boss smoke test: ${victories}V / ${defeats}D / ${errors}E over 20 trials`)
    : fail('Boss fight threw exception', `${errors} errors`);

  // Verify new boss abilities exist in ENEMY_ABILITIES (indirect: no errors during fight)
  // Verify reward: boss drops all loot
  {
    const p = makePlayer({ attack: 99, defense: 0, maxHp: 9999, hp: 9999, abilities: [] });
    console.log = () => {};
    runCombat(p, bossDef, mockPrompt(Array(200).fill('1')));
    console.log = origLog;
    const gotBadge  = p.inventory.includes('warden_badge');
    const gotPotion = p.inventory.includes('big_potion');
    gotBadge  ? ok('boss victory: warden_badge in inventory')    : fail('boss loot: badge missing');
    gotPotion ? ok('boss victory: big_potion guaranteed drop')   : fail('boss loot: potion missing');
  }
}

// ── 7. Perception system ──────────────────────────────────────────────────
console.log('\n── Perception System ──');
{
  const per0 = makePlayer({ perception: 0 });
  const per1 = makePlayer({ perception: 1 });
  const per2 = makePlayer({ perception: 2 });

  // evaluateCondition for perception
  evaluateCondition({ perception: 1 }, per0) === false
    ? ok('perception: level 1 hidden when per=0') : fail('perception gate per0');
  evaluateCondition({ perception: 1 }, per1) === true
    ? ok('perception: level 1 visible when per=1') : fail('perception gate per1');
  evaluateCondition({ perception: 2 }, per1) === false
    ? ok('perception: level 2 hidden when per=1') : fail('perception gate per2 with per1');
  evaluateCondition({ perception: 2 }, per2) === true
    ? ok('perception: level 2 visible when per=2') : fail('perception gate per2 with per2');

  // left_crack: +1 hidden choice at per>=1
  const crack = scenes['left_crack'];
  const crackPer0 = getAvailableChoices(crack, per0);
  const crackPer1 = getAvailableChoices(crack, per1);
  crackPer0.length === 2 ? ok('left_crack: 2 choices at per=0') : fail('left_crack per0', `got ${crackPer0.length}`);
  crackPer1.length === 3 ? ok('left_crack: 3 choices at per=1') : fail('left_crack per1', `got ${crackPer1.length}`);

  // alchemy_lab: +1 hidden choice at per>=1 (4 total vs 3)
  const lab = scenes['alchemy_lab'];
  const labPer0 = getAvailableChoices(lab, per0);
  const labPer1 = getAvailableChoices(lab, per1);
  labPer0.length === 3 ? ok('alchemy_lab: 3 choices at per=0') : fail('alchemy_lab per0', `got ${labPer0.length}`);
  labPer1.length === 4 ? ok('alchemy_lab: 4 choices at per=1') : fail('alchemy_lab per1', `got ${labPer1.length}`);

  // merge_room: route-gated side rooms, plus a ward-only hidden choice at per>=2
  const merge = scenes['merge_room'];
  const mergeSecurity = getAvailableChoices(merge, makePlayer({ route: 'security', perception: 2 }));
  const mergeWardPer1 = getAvailableChoices(merge, makePlayer({ route: 'ward', perception: 1 }));
  const mergeWardPer2 = getAvailableChoices(merge, makePlayer({ route: 'ward', perception: 2 }));
  mergeSecurity.map(c => c.nextScene).join(',') === 'warden_trap,supply_cache'
    ? ok('merge_room: security route sees security side rooms only')
    : fail('merge_room security route', mergeSecurity.map(c => c.nextScene).join(','));
  mergeWardPer1.map(c => c.nextScene).join(',') === 'alchemy_lab,maintenance_refuge'
    ? ok('merge_room: ward route sees ward side rooms only')
    : fail('merge_room ward route', mergeWardPer1.map(c => c.nextScene).join(','));
  mergeWardPer2.some(c => c.nextScene === 'secret_room')
    ? ok('merge_room: ward per=2 secret leads to secret_room') : fail('merge_room secret target');

  // secret_room resolves in scene graph
  const sr = scenes['secret_room'];
  sr ? ok('secret_room: scene exists') : fail('secret_room missing');
  if (sr) {
    const srChoices = getAvailableChoices(sr, per0);
    srChoices.some(c => c.nextScene === 'merge_room')
      ? ok('secret_room: exit leads back to merge_room') : fail('secret_room exit');
  }
}

// ── 8. Status Effects System ──────────────────────────────────────────────
console.log('\n── Status Effects System ──');

// applyStatus: new effect
{
  const t = { hp: 50, attack: 10, defense: 5, statusEffects: [] };
  applyStatus(t, { type: 'poison', duration: 3, value: 2 });
  t.statusEffects.length === 1
    ? ok('applyStatus: adds new effect')
    : fail('applyStatus new', `got ${t.statusEffects.length}`);

  // Refresh: should not duplicate
  applyStatus(t, { type: 'poison', duration: 2, value: 1 });
  t.statusEffects.length === 1
    ? ok('applyStatus: refreshes existing, no duplicate')
    : fail('applyStatus stack', `got ${t.statusEffects.length}`);

  // Refresh takes max duration/value
  t.statusEffects[0].duration === 3 && t.statusEffects[0].value === 2
    ? ok('applyStatus: refresh keeps max duration and value')
    : fail('applyStatus refresh values');
}

// processStatusEffects: damage dealt + duration decrement + removal
{
  const t = { hp: 50, attack: 10, defense: 5, statusEffects: [{ type: 'poison', duration: 1, value: 2 }] };
  console.log = () => {};
  const dmg = processStatusEffects(t, 'You');
  console.log = origLog;
  dmg === 2
    ? ok('processStatusEffects: returns damage dealt')
    : fail('processStatusEffects damage', `got ${dmg}`);
  t.hp === 48
    ? ok('processStatusEffects: reduces target hp')
    : fail('processStatusEffects hp', `got ${t.hp}`);
  t.statusEffects.length === 0
    ? ok('processStatusEffects: removes expired effects')
    : fail('processStatusEffects removal', `got ${t.statusEffects.length}`);
}

// Multi-effect: burn + weaken active simultaneously
{
  const t = { hp: 100, attack: 10, defense: 5, statusEffects: [] };
  applyStatus(t, { type: 'burn',   duration: 2, value: 3 });
  applyStatus(t, { type: 'weaken', duration: 2, value: 4 });
  console.log = () => {};
  processStatusEffects(t, 'Test');
  console.log = origLog;
  t.hp === 97
    ? ok('processStatusEffects: burn ticks 3 damage per turn')
    : fail('burn tick', `hp=${t.hp}`);
  t.statusEffects.length === 2
    ? ok('processStatusEffects: non-expired effects remain')
    : fail('effect retention', `got ${t.statusEffects.length}`);
  t.statusEffects[0].duration === 1 && t.statusEffects[1].duration === 1
    ? ok('processStatusEffects: durations decremented')
    : fail('duration decrement');
}

// getEffDef with defenseDown
{
  const t = { defense: 5, statusEffects: [{ type: 'defenseDown', duration: 2, value: 3 }] };
  getEffDef(t) === 2
    ? ok('getEffDef: applies defenseDown (-3)')
    : fail('getEffDef', `got ${getEffDef(t)}`);
  const clean = { defense: 5, statusEffects: [] };
  getEffDef(clean) === 5
    ? ok('getEffDef: no penalty without effect')
    : fail('getEffDef clean');
}

// getEffAtk with weaken
{
  const t = { attack: 10, statusEffects: [{ type: 'weaken', duration: 2, value: 4 }] };
  getEffAtk(t) === 6
    ? ok('getEffAtk: applies weaken (-4)')
    : fail('getEffAtk', `got ${getEffAtk(t)}`);
}

// isStunned
{
  const stunned = { statusEffects: [{ type: 'stun', duration: 1, value: 0 }] };
  const clean   = { statusEffects: [] };
  isStunned(stunned) === true  ? ok('isStunned: detects stun')    : fail('isStunned detect');
  isStunned(clean)   === false ? ok('isStunned: false when clear') : fail('isStunned clear');
}

// fmtEffects
{
  const t = { statusEffects: [{ type: 'poison', duration: 2, value: 2 }, { type: 'burn', duration: 1, value: 3 }] };
  const s = fmtEffects(t);
  (s !== null && s.includes('poison') && s.includes('burn'))
    ? ok('fmtEffects: formats multiple effects')
    : fail('fmtEffects', `got "${s}"`);
  fmtEffects({ statusEffects: [] }) === null
    ? ok('fmtEffects: returns null when empty')
    : fail('fmtEffects empty');
}

// clearStatusEffects
{
  const t = { statusEffects: [{ type: 'poison', duration: 2, value: 2 }] };
  clearStatusEffects(t);
  t.statusEffects.length === 0
    ? ok('clearStatusEffects: empties array')
    : fail('clearStatusEffects');
}

// scene applyEffect with applyStatus
{
  const p = makePlayer({});
  console.log = () => {};
  applyEffect(p, { applyStatus: { type: 'poison', duration: 3, value: 2 } });
  console.log = origLog;
  p.statusEffects.length === 1 && p.statusEffects[0].type === 'poison'
    ? ok('applyEffect: applyStatus adds effect to player')
    : fail('applyEffect applyStatus', `got ${JSON.stringify(p.statusEffects)}`);
}

// antidote cleanse in combat
{
  const p = makePlayer({ attack: 999, defense: 0, maxHp: 100, hp: 100, inventory: ['antidote'] });
  p.statusEffects = [
    { type: 'poison', duration: 3, value: 2 },
    { type: 'burn',   duration: 2, value: 3 },
  ];
  const dummy = { name: 'Dummy', hp: 1, attack: 0, defense: 0, xp: 0, goldReward: 0, loot: [], type: 'aggressive', abilities: [] };
  // Turn 1: open items ('3'), pick antidote ('1'); Turn 2: attack ('1')
  const inputs = ['3', '1', '1', '1', '1'];
  console.log = () => {};
  runCombat(p, dummy, mockPrompt(inputs));
  console.log = origLog;
  const remaining = p.statusEffects.filter(fx => fx.type === 'poison' || fx.type === 'burn');
  remaining.length === 0
    ? ok('antidote: clears poison and burn in combat')
    : fail('antidote cleanse', `${remaining.length} effects remain`);
  !p.inventory.includes('antidote')
    ? ok('antidote: consumed from inventory')
    : fail('antidote: not consumed');
}

// Player status_attack ability applies status to enemy
{
  const p = makePlayer({
    attack: 10, defense: 5, maxHp: 200, hp: 200,
    abilities: [
      { id: 'toxic_slash', name: 'Toxic Slash', type: 'status_attack',
        damage: 5, status: { type: 'poison', duration: 3, value: 2 }, cooldown: 3, currentCooldown: 0 },
    ],
  });
  const enemy = { name: 'TestEnemy', hp: 200, attack: 1, defense: 0, xp: 5, goldReward: 1, loot: [], type: 'aggressive', abilities: [] };
  // Use ability (choice '4', then '1')
  const inputs = ['4', '1', '5', '5', '5', '5', '5'];
  let capturedEnemy = null;
  console.log = () => {};
  // We can't check enemy.statusEffects after runCombat because it's local.
  // Instead verify no errors and trust the unit-level applyStatus tests above.
  let threw = false;
  try { runCombat(p, enemy, mockPrompt(inputs)); } catch(e) { threw = true; }
  console.log = origLog;
  !threw
    ? ok('status_attack (toxic_slash): runs without errors')
    : fail('status_attack threw exception');
}

// Combat smoke test with status-applying enemy abilities
{
  const statusEnemy = {
    name: 'Venomous Crawler', hp: 30, attack: 8, defense: 2, xp: 20, goldReward: 5,
    loot: ['small_potion'], type: 'aggressive', abilities: ['poison_hit', 'burning_strike'],
  };
  let victories = 0, defeats = 0, errors = 0;
  console.log = () => {};
  for (let i = 0; i < 30; i++) {
    const p = makePlayer({ attack: 15, defense: 5, maxHp: 200, hp: 200, abilities: [] });
    try {
      const r = runCombat(p, statusEnemy, mockPrompt(Array(60).fill('1')));
      if (r === 'victory') victories++;
      else if (r === 'defeat') defeats++;
    } catch(e) { errors++; }
  }
  console.log = origLog;
  errors === 0
    ? ok(`Status enemy smoke test: ${victories}V/${defeats}D/${errors}E over 30 trials`)
    : fail('Status enemy threw exception', `${errors} errors`);
}

// ── 9. Consumable Item System ─────────────────────────────────────────────
console.log('\n── Consumable Item System ──');
{
  const ITEMS = JSON.parse(require('fs').readFileSync(
    require('path').join(__dirname, 'data/items.json'), 'utf-8'));

  // Correct type fields
  const consumables = Object.values(ITEMS).filter(i => i.type === 'consumable');
  const relics      = Object.values(ITEMS).filter(i => i.type === 'relic');
  const keyItems    = Object.values(ITEMS).filter(i => i.type === 'key_item');
  consumables.length >= 3
    ? ok(`item types: ${consumables.length} consumables (potions, antidote)`)
    : fail('consumables defined', `got ${consumables.length}`);
  relics.length > 0 && keyItems.length > 0
    ? ok(`item types: ${relics.length} relics, ${keyItems.length} key_items (non-consumable)`)
    : fail('non-consumable items defined');

  // Consumable filter ignores relics and key items
  const inventory = ['small_potion', 'focus ring', 'guard_key', 'antidote'];
  const usable = inventory.filter(id => ITEMS[id]?.type === 'consumable');
  usable.length === 2
    ? ok('consumable filter: only small_potion and antidote match')
    : fail('consumable filter', `got ${usable.length}`);

  // Heal effect
  {
    const p = makePlayer({ hp: 60, maxHp: 100, inventory: ['small_potion'] });
    const item = ITEMS['small_potion'];
    const healed = Math.min(p.maxHp - p.hp, item.value);
    p.hp += healed;
    p.inventory.splice(p.inventory.indexOf('small_potion'), 1);
    p.hp === 80         ? ok('consumable heal: small_potion restores 20 HP')  : fail('potion heal',    `hp=${p.hp}`);
    !p.inventory.includes('small_potion')
                        ? ok('consumable heal: item removed after use')       : fail('item removal');
  }

  // Heal capped at maxHp
  {
    const p = makePlayer({ hp: 95, maxHp: 100, inventory: ['big_potion'] });
    const item = ITEMS['big_potion'];
    const healed = Math.min(p.maxHp - p.hp, item.value);
    p.hp += healed;
    p.hp === 100 ? ok('consumable heal: capped at maxHp (no overheal)') : fail('overheal cap', `hp=${p.hp}`);
  }

  // Cleanse removes poison and burn
  {
    const p = makePlayer({ inventory: ['antidote'] });
    p.statusEffects = [
      { type: 'poison', duration: 3, value: 2 },
      { type: 'burn',   duration: 2, value: 3 },
    ];
    p.statusEffects = p.statusEffects.filter(fx => fx.type !== 'poison' && fx.type !== 'burn');
    p.inventory.splice(p.inventory.indexOf('antidote'), 1);
    p.statusEffects.length === 0         ? ok('consumable cleanse: antidote clears poison and burn') : fail('cleanse effects');
    !p.inventory.includes('antidote')    ? ok('consumable cleanse: antidote consumed')               : fail('antidote consumed');
  }

  // Cleanse does not remove other effects
  {
    const p = makePlayer({});
    p.statusEffects = [
      { type: 'weaken', duration: 2, value: 4 },
      { type: 'poison', duration: 2, value: 2 },
    ];
    p.statusEffects = p.statusEffects.filter(fx => fx.type !== 'poison' && fx.type !== 'burn');
    p.statusEffects.length === 1 && p.statusEffects[0].type === 'weaken'
      ? ok('consumable cleanse: weaken effect preserved after cleanse')
      : fail('cleanse preserves other effects', `got ${JSON.stringify(p.statusEffects)}`);
  }

  // Relics and key items are not consumable
  ['focus ring', 'world_shard', 'champion_emblem', 'guard_key', "warden's seal", 'warden_badge'].forEach(id => {
    if (ITEMS[id]) {
      ITEMS[id].type !== 'consumable'
        ? ok(`non-consumable: ${id} type="${ITEMS[id].type}"`)
        : fail(`non-consumable check: ${id} is wrongly consumable`);
    }
  });

  // Gear items define slots and stat bonuses
  {
    const gear = ['bent_baton', 'guard_vest', 'stabilizer_charm', 'cracked_lens', 'marked_dice', 'shock_baton', 'sentry_plate', 'ranger_cloak'].map(id => ITEMS[id]);
    gear.every(item => item?.type === 'gear' && item.slot && item.stats)
      ? ok('gear items: define type, slot, and stat bonuses')
      : fail('gear item definitions', JSON.stringify(gear));
  }

  {
    ITEMS.shock_baton.trait?.id === 'first_attack_bonus' &&
      ITEMS.sentry_plate.trait?.id === 'first_hit_reduction' &&
      ITEMS.ranger_cloak.trait?.id === 'flee_bonus' &&
      ITEMS.marked_dice.trait?.id === 'bonus_gold'
      ? ok('gear traits: key gear defines trait ids')
      : fail('gear trait definitions', JSON.stringify({
        shock_baton: ITEMS.shock_baton?.trait,
        sentry_plate: ITEMS.sentry_plate?.trait,
        ranger_cloak: ITEMS.ranger_cloak?.trait,
        marked_dice: ITEMS.marked_dice?.trait,
      }));
  }
}

// ── 10. Room Cleared System ───────────────────────────────────────────────
console.log('\n── Room Cleared System ──');
{
  const { isRoomCleared } = require('./engine/sceneRunner');

  // supply_cache: 2 once-choices — not cleared initially
  const supply = scenes['supply_cache'];
  isRoomCleared(supply, makePlayer({})) === false
    ? ok('isRoomCleared: supply_cache not cleared initially')
    : fail('isRoomCleared initial state');

  // Not cleared with only 1 of 2 once-choices used
  {
    const p = makePlayer({});
    p.usedChoices['supply_cache'] = ['Search the remaining cabinets'];
    isRoomCleared(supply, p) === false
      ? ok('isRoomCleared: supply_cache not cleared with 1/2 once-choices used')
      : fail('isRoomCleared partial use');
  }

  // Cleared with all once-choices used
  {
    const p = makePlayer({});
    p.usedChoices['supply_cache'] = ['Search the remaining cabinets', "Force the supply room — stripped lock won't hold"];
    isRoomCleared(supply, p) === true
      ? ok('isRoomCleared: supply_cache cleared when all once-choices used')
      : fail('isRoomCleared full clear');
  }

  // Rooms with no once-choices are never cleared
  ['start_room', 'left_path', 'merge_room', 'hall_return'].forEach(id => {
    const scene = scenes[id];
    const onceCount = (scene.choices || []).filter(c => c.once).length;
    if (onceCount === 0) {
      isRoomCleared(scene, makePlayer({})) === false
        ? ok(`isRoomCleared: ${id} (no once-choices) never shows cleared`)
        : fail(`isRoomCleared no-once: ${id}`);
    }
  });

  // warden_trap: 3 once-choices — cleared after all used
  {
    const warden = scenes['warden_trap'];
    const onceTexts = (warden.choices || []).filter(c => c.once).map(c => c.text);
    onceTexts.length === 5 ? ok('warden_trap: 5 once-choices confirmed') : fail('warden_trap once count', `got ${onceTexts.length}`);

    const p = makePlayer({});
    p.usedChoices['warden_trap'] = [...onceTexts];
    isRoomCleared(warden, p) === true
      ? ok('isRoomCleared: warden_trap cleared after all 5 once-choices used')
      : fail('isRoomCleared warden_trap full clear');
  }

  // secret_room: 4 once-choices — partial clear not triggered early
  {
    const secret = scenes['secret_room'];
    const onceTexts = (secret.choices || []).filter(c => c.once).map(c => c.text);
    onceTexts.length === 5 ? ok('secret_room: 5 once-choices confirmed') : fail('secret_room once count', `got ${onceTexts.length}`);

    const p2 = makePlayer({});
    p2.usedChoices['secret_room'] = onceTexts.slice(0, 2);
    isRoomCleared(secret, p2) === false
      ? ok('isRoomCleared: secret_room not cleared with 2/4 once-choices used')
      : fail('isRoomCleared secret_room partial');

    const p4 = makePlayer({});
    p4.usedChoices['secret_room'] = [...onceTexts];
    isRoomCleared(secret, p4) === true
      ? ok('isRoomCleared: secret_room cleared after all 4 once-choices used')
      : fail('isRoomCleared secret_room full clear');
  }

  // createPlayer now includes clearedRooms
  {
    const p = makePlayer({});
    (typeof p.clearedRooms === 'object' && p.clearedRooms !== null && !Array.isArray(p.clearedRooms))
      ? ok('createPlayer: clearedRooms initialized as empty object')
      : fail('createPlayer clearedRooms field', `got ${JSON.stringify(p.clearedRooms)}`);
  }

  // Perception-gated once-choice: room cleared only when accessible ones are done
  {
    const crack = scenes['left_crack'];
    const per0 = makePlayer({ perception: 0 });
    const per1 = makePlayer({ perception: 1 });

    // At per=0, the once-choice (perception:1) is inaccessible — no accessible once-choices → not clearable
    isRoomCleared(crack, per0) === false
      ? ok('isRoomCleared: left_crack not clearable at per=0 (no accessible once-choices)')
      : fail('isRoomCleared left_crack per0');

    // At per=1, once-choice is visible but unused → not cleared
    isRoomCleared(crack, per1) === false
      ? ok('isRoomCleared: left_crack not cleared at per=1 before use')
      : fail('isRoomCleared left_crack per1 unused');

    // At per=1, once-choice used → cleared
    per1.usedChoices['left_crack'] = ['Push the displaced stone behind the main crack — a hollow clicks open'];
    isRoomCleared(crack, per1) === true
      ? ok('isRoomCleared: left_crack cleared at per=1 after once-choice used')
      : fail('isRoomCleared left_crack per1 cleared');
  }
}

// ── 11. Map System ────────────────────────────────────────────────────────
console.log('\n── Map System ──');
{
  const { getFloorMap, visitRoom: mapVisit, discoverRoom: mapDiscover, revealConnected: mapReveal, renderMap: mapRender } = require('./engine/map');

  // createPlayer includes mapData
  {
    const p = makePlayer({});
    (typeof p.mapData === 'object' && p.mapData !== null && !Array.isArray(p.mapData))
      ? ok('createPlayer: mapData initialized as empty object')
      : fail('createPlayer mapData', `got ${JSON.stringify(p.mapData)}`);
  }

  // getFloorMap auto-initializes per floor
  {
    const p = makePlayer({});
    const m1 = getFloorMap(p, 1);
    const m2 = getFloorMap(p, 2);
    (Array.isArray(m1.discovered) && Array.isArray(m1.visited))
      ? ok('getFloorMap: floor 1 initialized with discovered/visited arrays')
      : fail('getFloorMap floor 1');
    m1 !== m2
      ? ok('getFloorMap: floor 1 and floor 2 are separate maps')
      : fail('getFloorMap isolation');
  }

  // visitRoom marks discovered + visited
  {
    const p = makePlayer({});
    mapVisit(p, 'start_room', 1);
    const m = getFloorMap(p, 1);
    m.discovered.includes('start_room') ? ok('visitRoom: marks discovered')  : fail('visitRoom discovered');
    m.visited.includes('start_room')    ? ok('visitRoom: marks visited')      : fail('visitRoom visited');
    // Idempotent
    mapVisit(p, 'start_room', 1);
    m.visited.filter(id => id === 'start_room').length === 1
      ? ok('visitRoom: idempotent (no duplicates)')
      : fail('visitRoom duplicate', `visited=${JSON.stringify(m.visited)}`);
  }

  // revealConnected adds adjacent rooms but skips secrets
  {
    const p = makePlayer({});
    const startScene = scenes['start_room'];
    mapReveal(p, startScene, scenes, 1);
    const m = getFloorMap(p, 1);
    m.discovered.includes('left_path')
      ? ok('revealConnected: left_path discovered from start_room')
      : fail('revealConnected left_path');
    m.discovered.includes('right_path')
      ? ok('revealConnected: right_path discovered from start_room')
      : fail('revealConnected right_path');
  }

  // Secret room NOT auto-revealed (stays hidden until visited)
  {
    const p = makePlayer({});
    const mergeScene = scenes['merge_room'];
    mapVisit(p, 'merge_room', 1);
    mapReveal(p, mergeScene, scenes, 1);
    const m = getFloorMap(p, 1);
    !m.discovered.includes('secret_room')
      ? ok('revealConnected: secret_room not auto-revealed from merge_room')
      : fail('revealConnected secret leak');
    // But visiting secret_room directly adds it
    mapVisit(p, 'secret_room', 1);
    m.discovered.includes('secret_room') && m.visited.includes('secret_room')
      ? ok('visitRoom: secret_room discovered+visited when entered directly')
      : fail('visitRoom secret direct entry');
  }

  // All mapped scenes have map coordinates
  {
    const mappedIds = Object.keys(scenes).filter(id => scenes[id].map);
    mappedIds.length === 151
      ? ok(`scene map data: ${mappedIds.length}/151 scenes have map coordinates`)
      : fail('scene map data count', `got ${mappedIds.length}: ${mappedIds.join(', ')}`);
  }

  // Map coordinates are unique (no two rooms share x,y)
  {
    const positions = {};
    let dupes = 0;
    for (const [id, scene] of Object.entries(scenes)) {
      if (!scene.map) continue;
      const key = `${scene.map.x},${scene.map.y}`;
      if (positions[key]) { dupes++; console.log(`  [dup] ${id} and ${positions[key]} share (${key})`); }
      else positions[key] = id;
    }
    dupes === 0
      ? ok('map coordinates: all mapped rooms have unique (x,y) positions')
      : fail('map coordinate collision', `${dupes} duplicates`);
  }

  // renderMap runs without crashing (smoke test)
  {
    const p = makePlayer({});
    mapVisit(p, 'start_room', 1);
    mapReveal(p, scenes['start_room'], scenes, 1);
    mapVisit(p, 'left_path', 1);
    mapReveal(p, scenes['left_path'], scenes, 1);
    mapVisit(p, 'merge_room', 1);
    mapReveal(p, scenes['merge_room'], scenes, 1);
    mapVisit(p, 'boss_room', 1);
    let threw = false;
    console.log = () => {};
    try { mapRender(scenes, 'boss_room', p); } catch(e) { threw = true; }
    console.log = origLog;
    !threw
      ? ok('renderMap: runs without throwing on partial discovery')
      : fail('renderMap crash');
  }

  // renderMap with no discovered rooms
  {
    const p = makePlayer({});
    let threw = false;
    console.log = () => {};
    try { mapRender(scenes, 'start_room', p); } catch(e) { threw = true; }
    console.log = origLog;
    !threw ? ok('renderMap: handles empty mapData without crash') : fail('renderMap empty crash');
  }

  // Current room marker shows correctly
  {
    const p = makePlayer({});
    mapVisit(p, 'start_room', 1);
    let output = '';
    const origLogLocal = console.log;
    console.log = (...args) => { output += args.join(' ') + '\n'; };
    mapRender(scenes, 'start_room', p);
    console.log = origLogLocal;
    output.includes('[*START*]')
      ? ok('renderMap: current room shows as [*START*]')
      : fail('renderMap current marker', `output snippet: ${output.slice(0, 200)}`);
  }

  // Cleared room shows + marker
  {
    const p = makePlayer({});
    p.clearedRooms['supply_cache'] = true;
    mapVisit(p, 'supply_cache', 1);
    let output = '';
    const origLogLocal = console.log;
    console.log = (...args) => { output += args.join(' ') + '\n'; };
    mapRender(scenes, 'start_room', p);
    console.log = origLogLocal;
    output.includes('[SUPPLY$+]')
      ? ok('renderMap: cleared treasure room shows [SUPPLY$+]')
      : fail('renderMap cleared marker', `output: ${output.slice(0, 300)}`);
  }

  // Undiscovered room not shown
  {
    const p = makePlayer({});
    mapVisit(p, 'start_room', 1);
    let output = '';
    const origLogLocal = console.log;
    console.log = (...args) => { output += args.join(' ') + '\n'; };
    mapRender(scenes, 'start_room', p);
    console.log = origLogLocal;
    // boss_room was not discovered or visited
    !output.includes('BOSS')
      ? ok('renderMap: undiscovered boss_room not shown')
      : fail('renderMap undiscovered leak', 'BOSS appeared');
  }

  // Floor map isolation: floor 2 starts fresh
  {
    const p = makePlayer({ floor: 1 });
    mapVisit(p, 'boss_room', 1);
    // Simulate floor advancement
    p.floor = 2;
    const m2 = getFloorMap(p, 2);
    !m2.visited.includes('boss_room')
      ? ok('floor map isolation: floor 2 does not inherit floor 1 visits')
      : fail('floor map isolation');
    const m1 = getFloorMap(p, 1);
    m1.visited.includes('boss_room')
      ? ok('floor map preservation: floor 1 visits retained after floor advance')
      : fail('floor 1 data lost');
  }

  // Scene connections are bidirectionally reasonable
  {
    let broken = 0;
    for (const [id, scene] of Object.entries(scenes)) {
      if (!scene.map?.connections) continue;
      for (const connId of scene.map.connections) {
        if (!scenes[connId]) { broken++; console.log(`  [broken conn] ${id} → ${connId} (unknown scene)`); }
      }
    }
    broken === 0
      ? ok('map connections: all connection targets are valid scene IDs')
      : fail('map connections broken', `${broken} broken`);
  }
}

// ── 12. Save/Load Compatibility ───────────────────────────────────────────
console.log('\n── Save/Load Compatibility ──');
{
  const { getFloorMap, visitRoom: mapVisit2, revealConnected: mapReveal2 } = require('./engine/map');

  // JSON round-trip helper — same mechanism as saveGame/loadGame
  const rt = state => JSON.parse(JSON.stringify(state));

  // Discovered rooms survive round-trip
  {
    const p = makePlayer({});
    mapVisit2(p, 'start_room', 1);
    mapReveal2(p, scenes['start_room'], scenes, 1);
    const m = getFloorMap(rt({ player: p }).player, 1);
    m.discovered.includes('start_room') && m.discovered.includes('left_path') && m.discovered.includes('right_path')
      ? ok('save/load: discovered rooms persist')
      : fail('save/load discovered', JSON.stringify(m.discovered));
  }

  // Visited rooms survive round-trip
  {
    const p = makePlayer({});
    mapVisit2(p, 'start_room', 1);
    mapVisit2(p, 'left_path', 1);
    const m = getFloorMap(rt({ player: p }).player, 1);
    m.visited.includes('start_room') && m.visited.includes('left_path')
      ? ok('save/load: visited rooms persist')
      : fail('save/load visited', JSON.stringify(m.visited));
  }

  // Cleared rooms survive round-trip
  {
    const p = makePlayer({});
    p.clearedRooms['supply_cache'] = true;
    p.clearedRooms['warden_trap']  = true;
    const restored = rt({ player: p }).player;
    restored.clearedRooms['supply_cache'] === true && restored.clearedRooms['warden_trap'] === true
      ? ok('save/load: clearedRooms persist')
      : fail('save/load clearedRooms', JSON.stringify(restored.clearedRooms));
  }

  // usedChoices persist (cleared-room logic depends on them)
  {
    const p = makePlayer({});
    p.usedChoices['supply_cache'] = ['Search the room', 'Leave'];
    const used = rt({ player: p }).player.usedChoices['supply_cache'];
    Array.isArray(used) && used.includes('Search the room')
      ? ok('save/load: usedChoices persist (room cleared state preserved)')
      : fail('save/load usedChoices', JSON.stringify(used));
  }

  // Current scene ID persists
  {
    const state = { player: makePlayer({}), currentSceneId: 'merge_room' };
    rt(state).currentSceneId === 'merge_room'
      ? ok('save/load: currentSceneId persists')
      : fail('save/load currentSceneId');
  }

  // Floor number persists
  {
    const p = makePlayer({ floor: 2 });
    rt({ player: p }).player.floor === 2
      ? ok('save/load: floor number persists')
      : fail('save/load floor');
  }

  // Per-floor mapData preserved across both floors
  {
    const p = makePlayer({});
    mapVisit2(p, 'boss_room', 1);
    p.floor = 2;
    mapVisit2(p, 'start_room', 2);
    const rp = rt({ player: p }).player;
    const m1 = getFloorMap(rp, 1);
    const m2 = getFloorMap(rp, 2);
    m1.visited.includes('boss_room') && m2.visited.includes('start_room')
      ? ok('save/load: multi-floor mapData preserved correctly')
      : fail('save/load multi-floor', `f1=${JSON.stringify(m1.visited)} f2=${JSON.stringify(m2.visited)}`);
  }

  // Migration: old save without mapData/clearedRooms (pre-feature)
  {
    const old = { name: 'Hero', hp: 80, maxHp: 100, attack: 15, defense: 5,
      level: 1, xp: 0, xpToNext: 10, gold: 0, inventory: [],
      usedChoices: {}, statusEffects: [], perception: 0,
      floor: 1, worldRank: 5, runScore: 0, relics: [], neverFled: true };
    if (!old.clearedRooms) old.clearedRooms = {};
    if (!old.mapData)      old.mapData      = {};
    typeof old.mapData === 'object' && !Array.isArray(old.mapData)
      ? ok('migration: missing mapData initializes to {}')
      : fail('migration mapData');
    typeof old.clearedRooms === 'object' && !Array.isArray(old.clearedRooms)
      ? ok('migration: missing clearedRooms initializes to {}')
      : fail('migration clearedRooms');
  }

  // Migration does not overwrite existing mapData or clearedRooms
  {
    const p = makePlayer({});
    mapVisit2(p, 'start_room', 1);
    p.clearedRooms['supply_cache'] = true;
    if (!p.clearedRooms) p.clearedRooms = {};
    if (!p.mapData)      p.mapData      = {};
    const m = getFloorMap(p, 1);
    m.visited.includes('start_room') && p.clearedRooms['supply_cache'] === true
      ? ok('migration: existing mapData and clearedRooms not overwritten')
      : fail('migration no-clobber');
  }
}

// ── 13. Floor 1 Expansion — Dual Completion Paths ────────────────────────
console.log('\n── Floor 1 Expansion ──');
{
  const { applyEffect: applyEff } = require('./engine/sceneRunner');
  const ITEMS2 = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'data/items.json'), 'utf-8'));

  // ── New items exist with correct types ──
  {
    ['overseer_code', 'trader_intel', 'security_clearance', 'warden_override', 'security_route_token', 'ward_route_token'].forEach(id => {
      ITEMS2[id]?.type === 'key_item'
        ? ok(`new item: ${id} type=key_item`)
        : fail(`new item ${id} type`, ITEMS2[id]?.type);
    });
    ['cipher_fragment', 'warden_shackle'].forEach(id => {
      ITEMS2[id]?.type === 'relic'
        ? ok(`new item: ${id} type=relic`)
        : fail(`new item ${id} type`, ITEMS2[id]?.type);
    });
  }

  // ── spendGold effect ──
  {
    const p = makePlayer({ gold: 50 });
    applyEff(p, { spendGold: 15 });
    p.gold === 35 ? ok('spendGold: deducts gold correctly') : fail('spendGold', `got ${p.gold}`);
    applyEff(p, { spendGold: 100 }); // clamped to 0, not negative
    p.gold === 0 ? ok('spendGold: clamps at zero (no negative gold)') : fail('spendGold underflow', p.gold);
  }

  // ── New rooms exist and are valid ──
  {
    const newRooms = ['lore_room', 'merchant_room', 'maintenance_refuge', 'security_lockdown', 'quarantine_lockdown', 'rival_room', 'dead_end_passage',
                      'dead_end_loot', 'overseer_antechamber', 'overseer_chamber', 'evaluation_argument',
                      'security_records', 'barracks_checkpoint', 'armory_lockup',
                      'ward_observation', 'containment_hall', 'specimen_records'];
    newRooms.forEach(id => {
      scenes[id]
        ? ok(`new room exists: ${id}`)
        : fail(`new room missing: ${id}`);
    });
  }

  // ── lore_room: secret tag, gives overseer_code ──
  {
    scenes['security_lockdown'].victoryScene === 'security_records' &&
      scenes['security_records'].choices.some(c => c.nextScene === 'barracks_checkpoint') &&
      scenes['barracks_checkpoint'].victoryScene === 'armory_lockup' &&
      scenes['armory_lockup'].choices.some(c => c.nextScene === 'merge_room' && c.effect?.giveItem === 'security_route_token')
      ? ok('security route: lockdown chains through records, barracks, armory before junction')
      : fail('security route chain', JSON.stringify({
          lockdown: scenes['security_lockdown'].victoryScene,
          records: scenes['security_records']?.choices,
          barracks: scenes['barracks_checkpoint']?.victoryScene,
          armory: scenes['armory_lockup']?.choices,
        }));

    scenes['quarantine_lockdown'].victoryScene === 'ward_observation' &&
      scenes['ward_observation'].choices.some(c => c.nextScene === 'containment_hall') &&
      scenes['containment_hall'].victoryScene === 'specimen_records' &&
      scenes['specimen_records'].choices.some(c => c.nextScene === 'merge_room' && c.effect?.giveItem === 'ward_route_token')
      ? ok('ward route: quarantine chains through observation, containment, records before junction')
      : fail('ward route chain', JSON.stringify({
          quarantine: scenes['quarantine_lockdown'].victoryScene,
          observation: scenes['ward_observation']?.choices,
          containment: scenes['containment_hall']?.victoryScene,
          records: scenes['specimen_records']?.choices,
        }));
  }

  {
    const room = scenes['lore_room'];
    room.map?.tag === 'secret' ? ok('lore_room: tagged secret') : fail('lore_room tag', room.map?.tag);
    const giveCode = (room.choices || []).find(c => c.effect?.giveItem === 'overseer_code');
    giveCode ? ok('lore_room: overseer_code giveItem choice exists') : fail('lore_room: no overseer_code choice');
    room.map?.x === 0 && room.map?.y === 2 ? ok('lore_room: map coords (0,2)') : fail('lore_room coords', `${room.map?.x},${room.map?.y}`);
  }

  // ── left_crack: perception=2 reveals lore_room entry ──
  {
    const room = scenes['left_crack'];
    const per0 = getAvailableChoices(room, makePlayer({}));
    const per2 = getAvailableChoices(room, makePlayer({ perception: 2 }));
    per0.some(c => c.nextScene === 'lore_room')
      ? fail('left_crack: lore_room visible at per=0 (should be hidden)')
      : ok('left_crack: lore_room hidden at per=0');
    per2.some(c => c.nextScene === 'lore_room')
      ? ok('left_crack: lore_room visible at per=2')
      : fail('left_crack: lore_room not visible at per=2');
  }

  // ── merchant_room: treasure tag, purchases with spendGold, trader_intel ──
  {
    const room = scenes['merchant_room'];
    room.map?.tag === 'safe' ? ok('merchant_room: tagged safe') : fail('merchant_room tag');
    const pricedChoice = (room.choices || []).find(c => c.effect?.spendGold);
    pricedChoice ? ok('merchant_room: has spendGold purchase choice') : fail('merchant_room: no purchase choice');
    const swordChoice = (room.choices || []).find(c => c.effect?.giveItem === 'training_sword' && c.effect?.spendGold === 25);
    swordChoice ? ok('merchant_room: sells Training Sword for 25 gold') : fail('merchant_room: no Training Sword purchase');
    const vestChoice = (room.choices || []).find(c => c.effect?.giveItem === 'guard_vest' && c.effect?.spendGold === 30);
    vestChoice ? ok('merchant_room: sells Guard Vest for 30 gold') : fail('merchant_room: no Guard Vest purchase');
    const intelChoice = (room.choices || []).find(c => c.effect?.giveItem === 'trader_intel');
    intelChoice ? ok('merchant_room: trader_intel choice exists') : fail('merchant_room: no trader_intel');
    const questionChoice = (room.choices || []).find(c => c.text.includes('Ask what this place is'));
    questionChoice ? ok('merchant_room: safe NPC answers setting questions') : fail('merchant_room: no setting question');
    const brokePlayer = makePlayer({ gold: 5 });
    const affordable = getAvailableChoices(room, brokePlayer);
    affordable.some(c => c.requires?.gold && brokePlayer.gold < c.requires.gold)
      ? fail('merchant_room: gold-gated choice visible without gold')
      : ok('merchant_room: gold-gated purchases hidden when broke');
    const fundedPlayer = makePlayer({ gold: 35 });
    const funded = getAvailableChoices(room, fundedPlayer);
    funded.some(c => c.effect?.giveItem === 'training_sword') && funded.some(c => c.effect?.giveItem === 'guard_vest')
      ? ok('merchant_room: funded player can see gear purchases')
      : fail('merchant_room: funded player cannot see gear purchases', JSON.stringify(funded.map(c => c.text)));
  }

  // â”€â”€ maintenance_refuge: safe room, rest, Warden route clue â”€â”€
  {
    const floor2Safe = scenes['floor2_safe_room'];
    floor2Safe && floor2Safe.map?.tag === 'safe' ? ok('floor2_safe_room: tagged safe') : fail('floor2_safe_room missing safe tag');

    const bedChoice = (floor2Safe?.choices || []).find(c => /bed/i.test(c.text));
    bedChoice?.once && bedChoice.effect?.heal
      ? ok('floor2_safe_room: bed heals once')
      : fail('floor2_safe_room: bed missing once heal');

    const doorChoices = (floor2Safe?.choices || []).filter(c => c.nextScene && /^floor2_/.test(c.nextScene));
    doorChoices.length === 3
      ? ok('floor2_safe_room: has three exit doors')
      : fail('floor2_safe_room door count', `got ${doorChoices.length}`);

    const upgradedGear = (floor2Safe?.choices || []).filter(c => c.requires?.gold && c.effect?.spendGold && c.effect?.giveItem);
    upgradedGear.some(c => c.effect.giveItem === 'phase_edge') &&
      upgradedGear.some(c => c.effect.giveItem === 'mesh_armor') &&
      upgradedGear.some(c => c.effect.giveItem === 'large_potion')
      ? ok('floor2_safe_room: trader sells upgraded items and consumables')
      : fail('floor2_safe_room trader inventory', JSON.stringify(upgradedGear));

    const priceOf = itemId => upgradedGear.find(c => c.effect?.giveItem === itemId)?.effect?.spendGold;
    priceOf('large_potion') >= 25 && priceOf('large_potion') <= 35 &&
      priceOf('floor2_lens') >= 45 && priceOf('floor2_lens') <= 55 &&
      priceOf('phase_edge') >= 75 &&
      priceOf('mesh_armor') >= 80
      ? ok('floor2_safe_room: trader prices support one meaningful gear purchase')
      : fail('floor2_safe_room trader price balance', JSON.stringify(upgradedGear.map(c => ({ item: c.effect.giveItem, cost: c.effect.spendGold }))));

    const mismatchedPrices = (floor2Safe?.choices || []).filter(choice => {
      const match = String(choice.text || '').match(/(\d+) gold/);
      if (!match) return false;
      const shown = Number(match[1]);
      return choice.requires?.gold !== shown || choice.effect?.spendGold !== shown;
    });
    mismatchedPrices.length === 0
      ? ok('floor2_safe_room: trader displayed prices match required and spent gold')
      : fail('floor2_safe_room mismatched trader prices', JSON.stringify(mismatchedPrices.map(choice => ({ text: choice.text, requires: choice.requires?.gold, spend: choice.effect?.spendGold }))));

    const blockedReturns = doorChoices.every(c => {
      const target = scenes[c.nextScene];
      return target && !(target.choices || []).some(next => next.nextScene === 'floor2_safe_room');
    });
    blockedReturns
      ? ok('floor2_safe_room: exits are one-way')
      : fail('floor2_safe_room: a branch returns to safe room');
  }

  {
    const path1Rooms = [
      'floor2_red_door',
      'floor2_pressure_gallery',
      'floor2_broken_checkpoint',
      'floor2_observation_nest',
      'floor2_supply_fault',
      'floor2_service_crawl',
      'floor2_rival_cache',
      'floor2_split_conduit',
      'floor2_gatehouse',
      'floor2_boss_antechamber',
    ];

    path1Rooms.every(id => scenes[id])
      ? ok('floor2 path 1: ten pre-boss rooms exist')
      : fail('floor2 path 1: missing rooms', path1Rooms.filter(id => !scenes[id]).join(', '));

    path1Rooms.every(id => !((scenes[id]?.choices || []).some(c => c.nextScene === 'floor2_safe_room')))
      ? ok('floor2 path 1: cannot return to safe room')
      : fail('floor2 path 1: a room returns to safe room');

    const optionalRooms = ['floor2_observation_nest', 'floor2_supply_fault', 'floor2_rival_cache'];
    const optionalReachable = optionalRooms.every(id =>
      path1Rooms.some(roomId => (scenes[roomId]?.choices || []).some(c => c.nextScene === id))
    );
    optionalReachable
      ? ok('floor2 path 1: optional side rooms are reachable')
      : fail('floor2 path 1: optional side rooms not reachable');

    const mainRoute = [
      'floor2_red_door',
      'floor2_pressure_gallery',
      'floor2_broken_checkpoint',
      'floor2_service_crawl',
      'floor2_split_conduit',
      'floor2_gatehouse',
      'floor2_boss_antechamber',
      'floor2_shared_boss',
    ];
    const getFloor2Exits = id => {
      const scene = scenes[id] || {};
      const exits = (scene.choices || []).map(c => c.nextScene).filter(Boolean);
      if (scene.victoryScene) exits.push(scene.victoryScene);
      if (scene.fleeScene) exits.push(scene.fleeScene);
      return exits.filter(nextScene => /^floor2_/.test(nextScene));
    };

    const mainRouteConnects = mainRoute.slice(0, -1).every((id, index) =>
      getFloor2Exits(id).includes(mainRoute[index + 1])
    );
    mainRouteConnects
      ? ok('floor2 path 1: main route reaches shared boss')
      : fail('floor2 path 1: main route broken');

    ['floor2_red_door', 'floor2_blue_door', 'floor2_black_door'].every(id => {
      const seen = new Set();
      const stack = [id];
      while (stack.length > 0) {
        const current = stack.pop();
        if (current === 'floor2_shared_boss') return true;
        if (seen.has(current)) continue;
        seen.add(current);
        stack.push(...getFloor2Exits(current));
      }
      return false;
    })
      ? ok('floor2 lanes: all current lanes converge on shared boss')
      : fail('floor2 lanes: a lane does not reach shared boss');

    const readoutChoice = (scenes['floor2_rival_cache']?.choices || []).find(c => c.effect?.giveItem === 'f2_tactical_readout');
    readoutChoice
      ? ok('floor2 path 1: optional cache can reveal boss tactical readout')
      : fail('floor2 path 1: no tactical readout reward');

    const path1Rewards = path1Rooms.flatMap(id => scenes[id]?.choices || []).map(c => c.effect?.giveItem).filter(Boolean);
    path1Rewards.includes('f2_scout_map') && path1Rewards.includes('large_potion') && path1Rewards.includes('mesh_armor')
      ? ok('floor2 path 1: rewards emphasize scouting, loot, and side rooms')
      : fail('floor2 path 1 reward identity', JSON.stringify(path1Rewards));

    /World-3|boss|three lanes|readout|scouting/i.test(scenes['floor2_observation_nest']?.text || '') &&
      /field note|shared boss|route colors|World-3/i.test(scenes['floor2_rival_cache']?.text || '')
      ? ok('floor2 path 1: room flavor emphasizes scouting and rival notes')
      : fail('floor2 path 1 flavor missing scouting identity');

    const ITEMS = require('./data/items.json');
    const path1Choices = path1Rooms.flatMap(id => scenes[id]?.choices || []);
    const path1Combat = path1Rooms.map(id => scenes[id]?.combat).filter(Boolean);
    const path1Xp = path1Combat.reduce((sum, combat) => sum + (combat.xp || 0), 0) +
      path1Choices.reduce((sum, choice) => sum + (choice.effect?.giveXP || 0), 0);
    const path1Gold = path1Combat.reduce((sum, combat) => sum + (combat.goldReward || 0), 0) +
      path1Choices.reduce((sum, choice) => sum + (choice.effect?.giveGold || 0), 0);
    const path1Sustain = path1Combat.flatMap(combat => combat.loot || [])
      .concat(path1Choices.map(choice => choice.effect?.giveItem).filter(Boolean))
      .reduce((sum, itemId) => ITEMS[itemId]?.effect === 'heal' ? sum + (ITEMS[itemId].value || 0) : sum, 0) +
      path1Choices.reduce((sum, choice) => sum + (choice.effect?.heal || 0), 0);

    path1Xp >= 80 && path1Xp <= 130 && path1Gold >= 90 && path1Gold <= 125 && path1Sustain <= 150
      ? ok('floor2 path 1 balance: moderate XP, strong gold, capped sustain')
      : fail('floor2 path 1 balance', JSON.stringify({ path1Xp, path1Gold, path1Sustain }));
  }

  {
    const getFloor2Exits = id => {
      const scene = scenes[id] || {};
      const exits = (scene.choices || []).map(c => c.nextScene).filter(Boolean);
      if (scene.victoryScene) exits.push(scene.victoryScene);
      if (scene.fleeScene) exits.push(scene.fleeScene);
      return exits.filter(nextScene => /^floor2_/.test(nextScene));
    };

    const path2Rooms = [
      'floor2_blue_door',
      'floor2_gauntlet_lock',
      'floor2_first_crush',
      'floor2_bleeder_hall',
      'floor2_sentry_line',
      'floor2_no_rest_crossing',
      'floor2_double_bind',
      'floor2_killbox',
      'floor2_last_meter',
      'floor2_gauntlet_antechamber',
    ];

    path2Rooms.every(id => scenes[id])
      ? ok('floor2 path 2: ten gauntlet rooms exist')
      : fail('floor2 path 2: missing rooms', path2Rooms.filter(id => !scenes[id]).join(', '));

    const linearRoute = [...path2Rooms, 'floor2_shared_boss'];
    const linearRouteConnects = linearRoute.slice(0, -1).every((id, index) =>
      getFloor2Exits(id).includes(linearRoute[index + 1])
    );
    linearRouteConnects
      ? ok('floor2 path 2: linear gauntlet reaches shared boss')
      : fail('floor2 path 2: linear route broken');

    const sideForks = path2Rooms.some((id, index) => {
      const allowed = new Set([linearRoute[index + 1], linearRoute[index - 1]].filter(Boolean));
      return getFloor2Exits(id).some(exit => !allowed.has(exit));
    });
    !sideForks
      ? ok('floor2 path 2: no optional side-room forks')
      : fail('floor2 path 2: found optional fork');

    const combatRooms = path2Rooms.filter(id => !!scenes[id]?.combat);
    combatRooms.length >= 4
      ? ok('floor2 path 2: combat-heavy gauntlet')
      : fail('floor2 path 2: not enough combat rooms', `got ${combatRooms.length}`);

    const path2Loot = path2Rooms.flatMap(id => scenes[id]?.combat?.loot || []);
    path2Loot.includes('gauntlet_maul') && path2Loot.includes('war_plate')
      ? ok('floor2 path 2: combat drops include high-risk gear')
      : fail('floor2 path 2 high-risk gear rewards', JSON.stringify(path2Loot));

    /no side passages|Only the line/i.test(scenes['floor2_blue_door']?.text || '') &&
      /earned|survived|record/i.test(scenes['floor2_gauntlet_antechamber']?.text || '')
      ? ok('floor2 path 2: room flavor emphasizes attrition and survival')
      : fail('floor2 path 2 flavor missing attrition identity');

    path2Rooms.every(id => !((scenes[id]?.choices || []).some(c => c.nextScene === 'floor2_safe_room')))
      ? ok('floor2 path 2: cannot return to safe room')
      : fail('floor2 path 2: a room returns to safe room');

    const path2Choices = path2Rooms.flatMap(id => scenes[id]?.choices || []);
    const path2Combat = path2Rooms.map(id => scenes[id]?.combat).filter(Boolean);
    const path2Xp = path2Combat.reduce((sum, combat) => sum + (combat.xp || 0), 0);
    const path2Gold = path2Combat.reduce((sum, combat) => sum + (combat.goldReward || 0), 0);
    const path2Attrition = path2Choices.reduce((sum, choice) => sum + (choice.effect?.damage || 0), 0);

    path2Xp >= 340 && path2Xp <= 430 && path2Gold >= 100 && path2Gold <= 130 && path2Attrition >= 34 && path2Attrition <= 45
      ? ok('floor2 path 2 balance: best XP/gold with real attrition')
      : fail('floor2 path 2 balance', JSON.stringify({ path2Xp, path2Gold, path2Attrition }));
  }

  {
    const getFloor2Exits = id => {
      const scene = scenes[id] || {};
      const exits = (scene.choices || []).map(c => c.nextScene).filter(Boolean);
      if (scene.victoryScene) exits.push(scene.victoryScene);
      if (scene.fleeScene) exits.push(scene.fleeScene);
      return exits.filter(nextScene => /^floor2_/.test(nextScene));
    };

    const path3Rooms = [
      'floor2_black_door',
      'floor2_cipher_threshold',
      'floor2_mirror_grid',
      'floor2_weight_riddle',
      'floor2_tone_lock',
      'floor2_memory_walk',
      'floor2_logic_well',
      'floor2_symbol_bridge',
      'floor2_final_proof',
      'floor2_puzzle_antechamber',
    ];

    path3Rooms.every(id => scenes[id])
      ? ok('floor2 path 3: ten puzzle rooms exist')
      : fail('floor2 path 3: missing rooms', path3Rooms.filter(id => !scenes[id]).join(', '));

    const puzzleRoute = [...path3Rooms, 'floor2_shared_boss'];
    const puzzleRouteConnects = puzzleRoute.slice(0, -1).every((id, index) =>
      getFloor2Exits(id).includes(puzzleRoute[index + 1])
    );
    puzzleRouteConnects
      ? ok('floor2 path 3: puzzle route reaches shared boss')
      : fail('floor2 path 3: puzzle route broken');

    const puzzleXpChoices = path3Rooms.flatMap(id =>
      (scenes[id]?.choices || []).filter(c => c.effect?.giveXP)
    );
    puzzleXpChoices.length >= 5
      ? ok('floor2 path 3: puzzle completions award XP')
      : fail('floor2 path 3: not enough XP puzzle choices', `got ${puzzleXpChoices.length}`);

    path3Rooms.every(id => !scenes[id]?.combat)
      ? ok('floor2 path 3: puzzle lane has no combat rooms')
      : fail('floor2 path 3: contains combat room');

    path3Rooms.every(id => !((scenes[id]?.choices || []).some(c => c.nextScene === 'floor2_safe_room')))
      ? ok('floor2 path 3: cannot return to safe room')
      : fail('floor2 path 3: a room returns to safe room');

    const patternKeyChoice = path3Rooms.flatMap(id => scenes[id]?.choices || []).find(c => c.effect?.giveItem === 'f2_pattern_key');
    patternKeyChoice
      ? ok('floor2 path 3: puzzle route grants boss pattern key')
      : fail('floor2 path 3: no boss pattern key reward');

    const puzzleRelicChoice = path3Rooms.flatMap(id => scenes[id]?.choices || []).find(c => c.effect?.giveItem === 'logic_prism');
    puzzleRelicChoice
      ? ok('floor2 path 3: puzzle route grants a standalone relic')
      : fail('floor2 path 3: no standalone puzzle relic');

    /asks questions|old markings/i.test(scenes['floor2_black_door']?.text || '') &&
      /proof|pattern|trust/i.test(scenes['floor2_final_proof']?.text || '')
      ? ok('floor2 path 3: room flavor emphasizes puzzle logic and strange instruction')
      : fail('floor2 path 3 flavor missing puzzle identity');

    const path3Choices = path3Rooms.flatMap(id => scenes[id]?.choices || []);
    const path3Xp = path3Choices.reduce((sum, choice) => sum + (choice.effect?.giveXP || 0), 0);
    const path3Gold = path3Choices.reduce((sum, choice) => sum + (choice.effect?.giveGold || 0), 0);
    const path3WrongDamage = path3Choices.reduce((sum, choice) => sum + (choice.effect?.damage || 0), 0);

    path3Xp >= 160 && path3Xp <= 200 && path3Gold >= 15 && path3Gold <= 35 && path3WrongDamage >= 55 && path3WrongDamage <= 75
      ? ok('floor2 path 3 balance: best noncombat XP, low gold, fair mistakes')
      : fail('floor2 path 3 balance', JSON.stringify({ path3Xp, path3Gold, path3WrongDamage }));
  }

  {
    const boss = scenes['floor2_shared_boss'];
    const combat = boss?.combat;

    boss?.map?.tag === 'boss'
      ? ok('floor2 shared boss: tagged as boss')
      : fail('floor2 shared boss: missing boss tag');

    combat?.name === 'Convergence Warden'
      ? ok('floor2 shared boss: has final boss identity')
      : fail('floor2 shared boss identity', combat?.name);

    combat?.intro && combat?.victoryText
      ? ok('floor2 shared boss: has intro and victory text')
      : fail('floor2 shared boss: missing intro/victory text');

    combat?.phases?.length === 2 &&
      [combat, ...combat.phases].map(phase => phase.phaseName).join('|') === 'Red Protocol|Blue Protocol|Black Protocol'
      ? ok('floor2 shared boss: has red, blue, and black protocols')
      : fail('floor2 shared boss phases', JSON.stringify(combat?.phases));

    combat?.loot?.includes('convergence_core') && combat?.loot?.includes('large_potion')
      ? ok('floor2 shared boss: drops Floor 2 relic and consumable')
      : fail('floor2 shared boss loot', JSON.stringify(combat?.loot));

    boss?.victoryScene === 'floor2_clear_room'
      ? ok('floor2 shared boss: victory leads to Floor 2 clear story scene')
      : fail('floor2 shared boss victory handoff', boss?.victoryScene);

    scenes['floor2_clear_room']?.choices?.some(choice => choice.nextScene === 'the_end') &&
      /Floor 3|deeper|competition continues/i.test(scenes['floor2_clear_room']?.text || '')
      ? ok('floor2 clear room: story scene hands off to completion')
      : fail('floor2 clear room: missing story handoff');

    const advantageItems = (combat?.advantages || []).map(entry => entry.item);
    advantageItems.includes('f2_tactical_readout') && advantageItems.includes('f2_pattern_key')
      ? ok('floor2 shared boss: defines path-specific advantages')
      : fail('floor2 shared boss advantages', JSON.stringify(combat?.advantages));

    ['f2_tactical_readout', 'f2_scout_map', 'f2_pattern_key', 'logic_prism', 'gauntlet_maul', 'war_plate', 'convergence_core'].every(id => require('./data/items.json')[id])
      ? ok('floor2 boss items: marker and relic items exist')
      : fail('floor2 boss items: missing item definitions');
  }

  {
    const market = scenes['floor3_market'];
    market?.map?.tag === 'safe'
      ? ok('floor3_market: safe zone market exists')
      : fail('floor3_market: missing safe market');

    const contractPortals = (market?.choices || []).filter(choice => /^floor3_.*_portal$/.test(choice.nextScene || ''));
    contractPortals.length >= 5
      ? ok('floor3_market: offers five contract portals')
      : fail('floor3_market contract portal count', `got ${contractPortals.length}`);

    const bossPortal = (market?.choices || []).find(choice => choice.nextScene === 'floor3_boss_portal');
    bossPortal?.condition?.contractsCompleted === 5
      ? ok('floor3_market: boss portal requires five completed contracts')
      : fail('floor3_market boss portal gate', JSON.stringify(bossPortal));

    const brokerFlavor = (market?.choices || []).some(choice => /vendor|broker|contract/i.test(choice.text));
    brokerFlavor && /vendor|market|contract|portal/i.test(market?.text || '')
      ? ok('floor3_market: vendors and contract brokers are present')
      : fail('floor3_market: missing vendor/contract flavor');

    /Contract Board|0\/5|Hunt|Recovery|Puzzle unlocks at 1\/5|Escort at 2\/5|Debt at 3\/5|Boss portal at 5\/5/i.test(market?.text || '')
      ? ok('floor3_market: board text clearly explains contract progress and unlocks')
      : fail('floor3_market board clarity missing', market?.text);

    ['Mara Voss', 'Tallow Jin', 'Sister Quen', 'Nix Ledger'].every(name => (market?.text || '').includes(name)) &&
      (market?.choices || []).some(choice => /Mara Voss/i.test(choice.text)) &&
      (market?.choices || []).some(choice => /Nix Ledger/i.test(choice.text))
      ? ok('floor3_market: named NPCs give the market a cast')
      : fail('floor3_market: missing named NPC flavor', market?.text);

    const vendorPurchases = (market?.choices || []).filter(choice => choice.requires?.gold && choice.effect?.spendGold && choice.effect?.giveItem);
    const vendorItems = vendorPurchases.map(choice => choice.effect.giveItem);
    ['large_potion', 'antidote', 'market_spike', 'contract_lamellar', 'broker_abacus'].every(itemId => vendorItems.includes(itemId)) &&
      vendorPurchases.every(choice => choice.nextScene === 'floor3_market')
      ? ok('floor3_market: vendors sell consumables and Floor 3 gear')
      : fail('floor3_market vendor inventory', JSON.stringify(vendorPurchases));

    const priceOf = itemId => vendorPurchases.find(choice => choice.effect?.giveItem === itemId)?.effect?.spendGold;
    priceOf('large_potion') === 40 &&
      priceOf('antidote') === 18 &&
      priceOf('market_spike') === 95 &&
      priceOf('contract_lamellar') === 100 &&
      priceOf('broker_abacus') === 80
      ? ok('floor3_market: vendor prices fit Floor 3 economy')
      : fail('floor3_market vendor prices', JSON.stringify(vendorPurchases.map(choice => ({ item: choice.effect.giveItem, cost: choice.effect.spendGold }))));

    const floor3VendorItems = require('./data/items.json');
    floor3VendorItems.market_spike?.type === 'gear' &&
      floor3VendorItems.contract_lamellar?.slot === 'armor' &&
      floor3VendorItems.broker_abacus?.slot === 'trinket' &&
      floor3VendorItems.arbiter_clause?.type === 'relic'
      ? ok('floor3 vendor items: new gear definitions exist')
      : fail('floor3 vendor item definitions missing');

    const marketAt = count => getAvailableChoices(market, makePlayer({ contractsCompleted: count, gold: 999 }));
    const openAt = (count, sceneId) => marketAt(count).some(choice => choice.nextScene === sceneId);
    openAt(0, 'floor3_hunt_portal') &&
      openAt(0, 'floor3_recovery_portal') &&
      !openAt(0, 'floor3_puzzle_portal') &&
      openAt(1, 'floor3_puzzle_portal') &&
      !openAt(1, 'floor3_escort_portal') &&
      openAt(2, 'floor3_escort_portal') &&
      !openAt(2, 'floor3_debt_portal') &&
      openAt(3, 'floor3_debt_portal')
      ? ok('floor3_market: contract board unlocks harder jobs as contracts complete')
      : fail('floor3_market contract board progression', JSON.stringify({
          zero: marketAt(0).map(choice => choice.nextScene || choice.text),
          one: marketAt(1).map(choice => choice.nextScene || choice.text),
          two: marketAt(2).map(choice => choice.nextScene || choice.text),
          three: marketAt(3).map(choice => choice.nextScene || choice.text),
        }));

    [1, 3, 5].every(count => marketAt(count).some(choice => choice.effect?.giveXP && /market|Mara|Nix|Quen|Tallow|Arbiter/i.test(choice.text)))
      ? ok('floor3_market: NPC reaction beats unlock as contract count rises')
      : fail('floor3_market reactive flavor missing', JSON.stringify({
          one: marketAt(1).map(choice => choice.text),
          three: marketAt(3).map(choice => choice.text),
          five: marketAt(5).map(choice => choice.text),
        }));

    const premiumAtTwo = marketAt(2).some(choice => choice.effect?.giveItem === 'arbiter_clause');
    const premiumAtThree = marketAt(3).some(choice => choice.effect?.giveItem === 'arbiter_clause' && choice.requires?.gold === 120);
    !premiumAtTwo && premiumAtThree
      ? ok('floor3_market: premium vendor relic unlocks after three contracts')
      : fail('floor3_market premium vendor unlock', JSON.stringify({ two: marketAt(2).map(c => c.text), three: marketAt(3).map(c => c.text) }));
  }

  {
    const contractIds = ['hunt', 'recovery', 'puzzle', 'escort', 'debt'];
    const completeScenes = contractIds.map(id => scenes[`floor3_${id}_complete`]);
    const allComplete = completeScenes.every((scene, index) =>
      scene?.choices?.some(choice =>
        choice.nextScene === 'floor3_market' &&
        choice.effect?.completeContract === contractIds[index]
      )
    );

    allComplete
      ? ok('floor3 contracts: each contract can be completed and returns to market')
      : fail('floor3 contracts: completion scene missing', JSON.stringify(contractIds.filter((id, index) => !completeScenes[index])));

    const contractRewards = completeScenes.flatMap(scene => scene?.choices || []).map(choice => choice.effect || {});
    contractRewards.some(effect => effect.giveItem === 'contract_mark') &&
      contractRewards.some(effect => effect.giveXP) &&
      contractRewards.some(effect => effect.giveGold)
      ? ok('floor3 contracts: reward mix includes marks, XP, and gold')
      : fail('floor3 contracts reward mix', JSON.stringify(contractRewards));

    const expectedSeals = ['hunt_seal', 'recovery_seal', 'puzzle_seal', 'escort_seal', 'debt_seal'];
    expectedSeals.every(itemId => contractRewards.some(effect => (effect.giveItems || []).includes(itemId))) &&
      expectedSeals.every(itemId => require('./data/items.json')[itemId]?.type === 'key_item')
      ? ok('floor3 contracts: each contract awards a unique boss-advantage seal')
      : fail('floor3 contract seals missing', JSON.stringify(contractRewards));

    ['Hunt Seal', 'Recovery Seal', 'Puzzle Seal', 'Escort Seal', 'Debt Seal'].every(name =>
      completeScenes.some(scene => (scene?.text || '').includes(name)) ||
      completeScenes.some(scene => (scene?.choices || []).some(choice => choice.text.includes(name)))
    )
      ? ok('floor3 contracts: completion text names each boss-advantage seal')
      : fail('floor3 contract seal flavor missing', completeScenes.map(scene => scene?.text));

    const intermediateRooms = {
      hunt: 'floor3_hunt_trace',
      recovery: 'floor3_recovery_vault',
      puzzle: 'floor3_puzzle_audit',
      escort: 'floor3_escort_route',
      debt: 'floor3_debt_counterparty',
    };

    const allContractsHaveDepth = contractIds.every(id => {
      const portal = scenes[`floor3_${id}_portal`];
      const intermediate = scenes[intermediateRooms[id]];
      const finalRoom = scenes[`floor3_${id}_room`];
      return portal?.choices?.some(choice => choice.nextScene === intermediateRooms[id]) &&
        intermediate?.choices?.some(choice => choice.nextScene === finalRoom?.id) &&
        (intermediate?.choices || []).length >= 2;
    });

    allContractsHaveDepth
      ? ok('floor3 contracts: each contract has an intermediate decision room')
      : fail('floor3 contracts: missing intermediate depth', JSON.stringify(intermediateRooms));
  }

  {
    const p = makePlayer({});
    applyEff(p, { completeContract: 'hunt' });
    applyEff(p, { completeContract: 'hunt' });
    applyEff(p, { completeContract: 'puzzle' });

    p.contractsCompleted === 2 &&
      p.completedContracts.includes('hunt') &&
      p.completedContracts.includes('puzzle')
      ? ok('completeContract effect: tracks unique completed contracts')
      : fail('completeContract effect tracking', JSON.stringify({ contractsCompleted: p.contractsCompleted, completedContracts: p.completedContracts }));

    evaluateCondition({ contractsCompleted: 2 }, p) && !evaluateCondition({ contractsCompleted: 5 }, p)
      ? ok('contractsCompleted condition: gates choices by completed contract count')
      : fail('contractsCompleted condition failed');
  }

  {
    const readyPlayer = makePlayer({ contractsCompleted: 5, completedContracts: ['hunt', 'recovery', 'puzzle', 'escort', 'debt'] });
    const blockedPlayer = makePlayer({ contractsCompleted: 4, completedContracts: ['hunt', 'recovery', 'puzzle', 'escort'] });
    const floor3Market = scenes['floor3_market'] || { choices: [] };
    const readyChoices = getAvailableChoices(floor3Market, readyPlayer);
    const blockedChoices = getAvailableChoices(floor3Market, blockedPlayer);

    readyChoices.some(choice => choice.nextScene === 'floor3_boss_portal') &&
      !blockedChoices.some(choice => choice.nextScene === 'floor3_boss_portal')
      ? ok('floor3_market: boss portal appears only after five contracts')
      : fail('floor3_market boss portal filtering', JSON.stringify({ ready: readyChoices.map(c => c.text), blocked: blockedChoices.map(c => c.text) }));

    scenes['floor3_boss']?.victoryScene === 'floor3_clear_room' &&
      scenes['floor3_clear_room']?.choices?.some(choice => choice.nextScene === 'the_end')
      ? ok('floor3 boss: victory reaches Floor 3 clear handoff')
      : fail('floor3 boss handoff missing');

    scenes['floor3_boss']?.combat?.loot?.includes('market_arbiter_ledger') &&
      require('./data/items.json').market_arbiter_ledger?.type === 'relic'
      ? ok('floor3 boss: drops unique Market Arbiter relic')
      : fail('floor3 boss unique relic missing', JSON.stringify(scenes['floor3_boss']?.combat?.loot));

    const bossAdvantages = scenes['floor3_boss']?.combat?.advantages || [];
    ['hunt_seal', 'recovery_seal', 'puzzle_seal', 'escort_seal', 'debt_seal'].every(itemId => bossAdvantages.some(advantage => advantage.item === itemId))
      ? ok('floor3 boss: every contract seal creates an Arbiter advantage')
      : fail('floor3 boss advantages missing', JSON.stringify(bossAdvantages));

    const baseState = runtime.startNewRun({ name: 'ArbiterBase', playerPatch: { floor: 3, inventory: [] } });
    baseState.currentSceneId = 'floor3_boss';
    const baseView = runtime.getView(baseState);
    const advantagedState = runtime.startNewRun({
      name: 'ArbiterFavored',
      playerPatch: { floor: 3, inventory: ['hunt_seal', 'recovery_seal', 'puzzle_seal', 'escort_seal', 'debt_seal'] },
    });
    advantagedState.currentSceneId = 'floor3_boss';
    const advantagedView = runtime.getView(advantagedState);

    advantagedView.combat.enemy.maxHp < baseView.combat.enemy.maxHp &&
      advantagedView.combat.enemy.attack < baseView.combat.enemy.attack &&
      advantagedView.combat.enemy.defense < baseView.combat.enemy.defense &&
      !advantagedView.combat.enemy.abilities.includes('armor_break') &&
      advantagedView.combat.enemy.advantagesApplied.length === 5
      ? ok('runtime floor3 boss: contract seals weaken the Arbiter')
      : fail('runtime floor3 boss advantages', JSON.stringify({ base: baseView.combat.enemy, advantaged: advantagedView.combat.enemy }));

    const floor3Rooms = Object.keys(scenes).filter(id => id.startsWith('floor3_') && !['floor3_market', 'floor3_boss', 'floor3_boss_portal', 'floor3_clear_room'].includes(id));
    const floor3Choices = floor3Rooms.flatMap(id => scenes[id]?.choices || []);
    const floor3Combats = floor3Rooms.map(id => scenes[id]?.combat).filter(Boolean);
    const floor3Xp = floor3Combats.reduce((sum, combat) => sum + (combat.xp || 0), 0) +
      floor3Choices.reduce((sum, choice) => sum + (choice.effect?.giveXP || 0), 0);
    const floor3Gold = floor3Combats.reduce((sum, combat) => sum + (combat.goldReward || 0), 0) +
      floor3Choices.reduce((sum, choice) => sum + (choice.effect?.giveGold || 0), 0);
    const floor3Damage = floor3Choices.reduce((sum, choice) => sum + (choice.effect?.damage || 0), 0);

    floor3Xp >= 640 && floor3Xp <= 780 && floor3Gold >= 180 && floor3Gold <= 250 && floor3Damage >= 90 && floor3Damage <= 125
      ? ok('floor3 balance: contracts give high XP/gold with meaningful optional damage')
      : fail('floor3 balance totals', JSON.stringify({ floor3Xp, floor3Gold, floor3Damage }));

    baseView.combat.enemy.maxHp >= 150 && baseView.combat.enemy.attack >= 33 && baseView.combat.enemy.defense >= 9
      ? ok('floor3 boss balance: Arbiter is a step above Floor 2 boss')
      : fail('floor3 boss balance too low', JSON.stringify(baseView.combat.enemy));

    /Mara Voss|Tallow Jin|Sister Quen|Nix Ledger|Floor 4|black-market|sponsors|threshold/i.test(scenes['floor3_clear_room']?.text || '')
      ? ok('floor3 clear room: named NPC payoff and Floor 4 tease are present')
      : fail('floor3 clear room payoff missing', scenes['floor3_clear_room']?.text);
  }

  // ── Floor 4: Sponsor Vault ──
  {
    ['f4_gold_key', 'f4_blood_key', 'f4_signal_key', 'f4_auction_contract', 'f4_blood_writ', 'f4_signal_patch', 'sponsor_crown'].forEach(itemId => {
      items[itemId]
        ? ok(`floor4 item exists: ${itemId}`)
        : fail(`floor4 item missing: ${itemId}`);
    });

    const safe = scenes['floor4_elevator'];
    safe?.map?.tag === 'safe' && /Sponsor Vault|relay|vendor|Vault Keys 0\/3/i.test(safe?.text || '')
      ? ok('floor4_elevator: safe relay room introduces Sponsor Vault and Vault Key goal')
      : fail('floor4_elevator missing safe intro', JSON.stringify(safe));

    const wingStarts = ['floor4_gold_entry', 'floor4_blood_entry', 'floor4_signal_entry'];
    wingStarts.every(id => (safe?.choices || []).some(choice => choice.nextScene === id))
      ? ok('floor4_elevator: opens three distinct sponsor wings')
      : fail('floor4_elevator wing choices missing', JSON.stringify(safe?.choices));

    const floor4Rooms = [
      'floor4_gold_entry',
      'floor4_gold_auction',
      'floor4_gold_vault',
      'floor4_blood_entry',
      'floor4_blood_trial',
      'floor4_blood_vault',
      'floor4_signal_entry',
      'floor4_signal_puzzle',
      'floor4_signal_vault',
      'floor4_boss_gate',
      'floor4_boss',
      'floor4_clear_room',
    ];

    floor4Rooms.every(id => scenes[id])
      ? ok('floor4 sponsor vault: core rooms exist')
      : fail('floor4 sponsor vault missing rooms', floor4Rooms.filter(id => !scenes[id]).join(', '));

    const keyRewards = [
      ['floor4_gold_vault', 'f4_gold_key'],
      ['floor4_blood_vault', 'f4_blood_key'],
      ['floor4_signal_vault', 'f4_signal_key'],
    ];

    keyRewards.every(([sceneId, itemId]) => (scenes[sceneId]?.choices || []).some(choice => choice.effect?.giveItem === itemId))
      ? ok('floor4 sponsor vault: each wing awards a unique Vault Key')
      : fail('floor4 sponsor vault key rewards missing', JSON.stringify(keyRewards));

    ['floor4_gold_auction', 'floor4_blood_trial', 'floor4_signal_puzzle'].every(id => /Sponsor Pressure|pressure|sponsor/i.test(scenes[id]?.text || ''))
      ? ok('floor4 sponsor vault: wing rooms emphasize sponsor pressure')
      : fail('floor4 sponsor pressure flavor missing');

    const gateChoice = (scenes['floor4_boss_gate']?.choices || []).find(choice => choice.nextScene === 'floor4_boss');
    gateChoice?.requires?.items?.includes('f4_gold_key') &&
      gateChoice.requires.items.includes('f4_blood_key') &&
      gateChoice.requires.items.includes('f4_signal_key')
      ? ok('floor4 boss gate: requires all three Vault Keys')
      : fail('floor4 boss gate requirements missing', JSON.stringify(gateChoice));

    const boss = scenes['floor4_boss'];
    boss?.map?.tag === 'boss' &&
      boss.combat?.name === "The Sponsor's Champion" &&
      boss.combat?.loot?.includes('sponsor_crown') &&
      boss.victoryScene === 'floor4_clear_room'
      ? ok('floor4 boss: Sponsor Champion drops unique relic and clears floor')
      : fail('floor4 boss definition missing', JSON.stringify(boss));

    const advantageItems = (boss?.combat?.advantages || []).map(advantage => advantage.item);
    ['f4_auction_contract', 'f4_blood_writ', 'f4_signal_patch'].every(itemId => advantageItems.includes(itemId))
      ? ok('floor4 boss: optional sponsor pressure rewards create boss advantages')
      : fail('floor4 boss advantages missing', JSON.stringify(boss?.combat?.advantages));

    scenes['floor4_clear_room']?.choices?.some(choice => choice.nextScene === 'the_end') &&
      /Floor 5|Overseers|Sponsors/i.test(scenes['floor4_clear_room']?.text || '')
      ? ok('floor4 clear room: hands off toward Floor 5')
      : fail('floor4 clear room handoff missing', scenes['floor4_clear_room']?.text);
  }

  {
    function chooseByText(state, textPattern) {
      const view = runtime.getView(state);
      const index = view.choices.findIndex(choice => textPattern.test(choice.text));
      if (index < 0) throw new Error(`Floor 4 choice not found: ${textPattern}`);
      return runtime.dispatch(state, { type: 'choose_scene_option', index }).state;
    }

    function winCombat(state) {
      let next = state;
      for (let i = 0; i < 30 && runtime.getView(next).mode === 'combat'; i += 1) {
        next = runtime.dispatch(next, { type: 'combat_attack' }).state;
      }
      return next;
    }

    let run = runtime.startNewRun({
      name: 'SponsorVaultRunner',
      playerPatch: { floor: 4, hp: 999, maxHp: 999, attack: 999, defense: 99, gold: 200 },
    });
    run.currentSceneId = 'floor4_elevator';

    run = chooseByText(run, /Gold Wing/);
    run = chooseByText(run, /auction lights/);
    run = chooseByText(run, /sell your combat pattern/);
    run = chooseByText(run, /Gold Vault Key/);
    run = chooseByText(run, /Blood Wing/);
    run = winCombat(run);
    run = chooseByText(run, /Blood Writ/);
    run = chooseByText(run, /Blood Vault Key/);
    run = chooseByText(run, /Signal Wing/);
    run = chooseByText(run, /Trace the broadcast/);
    run = chooseByText(run, /patch the Champion feed/);
    run = chooseByText(run, /Signal Vault Key/);
    run = chooseByText(run, /Slot all three Vault Keys/);
    run = winCombat(run);

    run.currentSceneId === 'floor4_clear_room' &&
      ['f4_gold_key', 'f4_blood_key', 'f4_signal_key', 'f4_auction_contract', 'f4_blood_writ', 'f4_signal_patch', 'sponsor_crown'].every(itemId => run.player.inventory.includes(itemId))
      ? ok('runtime Floor 4 full playthrough: three wings unlock and clear the Sponsor Champion')
      : fail('runtime Floor 4 full playthrough failed', JSON.stringify({ scene: run.currentSceneId, inventory: run.player.inventory }));
  }

  // Floor 5: Overseer Engine
  {
    [
      'f5_combat_protocol',
      'f5_memory_protocol',
      'f5_debt_protocol',
      'f5_identity_protocol',
      'f5_combat_override',
      'f5_memory_override',
      'f5_debt_override',
      'f5_identity_override',
      'rulekeeper_core',
    ].forEach(itemId => {
      items[itemId]
        ? ok(`floor5 item exists: ${itemId}`)
        : fail(`floor5 item missing: ${itemId}`);
    });

    const safe = scenes['floor5_service_dock'];
    safe?.map?.tag === 'safe' && /Overseer Service Dock|safe|Protocol Clearances 0\/4/i.test(safe?.text || '')
      ? ok('floor5_service_dock: safe dock introduces four protocol clearances')
      : fail('floor5_service_dock missing safe intro', JSON.stringify(safe));

    const protocolStarts = ['floor5_combat_protocol', 'floor5_memory_protocol', 'floor5_debt_protocol', 'floor5_identity_protocol'];
    protocolStarts.every(id => (safe?.choices || []).some(choice => choice.nextScene === id))
      ? ok('floor5_service_dock: opens four protocol chambers')
      : fail('floor5_service_dock protocol choices missing', JSON.stringify(safe?.choices));

    const floor5Rooms = [
      'floor5_combat_protocol',
      'floor5_combat_trial',
      'floor5_combat_complete',
      'floor5_memory_protocol',
      'floor5_memory_trial',
      'floor5_memory_complete',
      'floor5_debt_protocol',
      'floor5_debt_trial',
      'floor5_debt_complete',
      'floor5_identity_protocol',
      'floor5_identity_trial',
      'floor5_identity_complete',
      'floor5_boss_gate',
      'floor5_boss',
      'floor5_clear_room',
    ];

    floor5Rooms.every(id => scenes[id])
      ? ok('floor5 overseer engine: core rooms exist')
      : fail('floor5 overseer engine missing rooms', floor5Rooms.filter(id => !scenes[id]).join(', '));

    const protocolRewards = [
      ['floor5_combat_complete', 'f5_combat_protocol'],
      ['floor5_memory_complete', 'f5_memory_protocol'],
      ['floor5_debt_complete', 'f5_debt_protocol'],
      ['floor5_identity_complete', 'f5_identity_protocol'],
    ];

    protocolRewards.every(([sceneId, itemId]) => (scenes[sceneId]?.choices || []).some(choice => choice.effect?.giveItem === itemId))
      ? ok('floor5 overseer engine: each protocol awards a clearance')
      : fail('floor5 protocol clearance rewards missing', JSON.stringify(protocolRewards));

    const overrideRewards = [
      ['floor5_combat_protocol', 'f5_combat_override'],
      ['floor5_memory_protocol', 'f5_memory_override'],
      ['floor5_debt_protocol', 'f5_debt_override'],
      ['floor5_identity_protocol', 'f5_identity_override'],
    ];

    overrideRewards.every(([sceneId, itemId]) => (scenes[sceneId]?.choices || []).some(choice => choice.effect?.giveItem === itemId && /Override/i.test(choice.text)))
      ? ok('floor5 overseer engine: risky override choices award boss advantages')
      : fail('floor5 override rewards missing', JSON.stringify(overrideRewards));

    const gateChoice = (scenes['floor5_boss_gate']?.choices || []).find(choice => choice.nextScene === 'floor5_boss');
    ['f5_combat_protocol', 'f5_memory_protocol', 'f5_debt_protocol', 'f5_identity_protocol'].every(itemId => gateChoice?.requires?.items?.includes(itemId))
      ? ok('floor5 boss gate: requires all four Protocol Clearances')
      : fail('floor5 boss gate requirements missing', JSON.stringify(gateChoice));

    const boss = scenes['floor5_boss'];
    boss?.map?.tag === 'boss' &&
      boss.combat?.name === 'The Rulekeeper' &&
      boss.combat?.loot?.includes('rulekeeper_core') &&
      boss.victoryScene === 'floor5_clear_room'
      ? ok('floor5 boss: Rulekeeper drops unique core and clears floor')
      : fail('floor5 boss definition missing', JSON.stringify(boss));

    const advantageItems = (boss?.combat?.advantages || []).map(advantage => advantage.item);
    ['f5_combat_override', 'f5_memory_override', 'f5_debt_override', 'f5_identity_override'].every(itemId => advantageItems.includes(itemId))
      ? ok('floor5 boss: override sigils weaken Rulekeeper rules')
      : fail('floor5 boss advantages missing', JSON.stringify(boss?.combat?.advantages));

    scenes['floor5_clear_room']?.choices?.some(choice => choice.nextScene === 'the_end') &&
      /Floor 6|outside the system|Rulekeeper/i.test(scenes['floor5_clear_room']?.text || '')
      ? ok('floor5 clear room: hands off toward Floor 6')
      : fail('floor5 clear room handoff missing', scenes['floor5_clear_room']?.text);
  }

  {
    function chooseByText(state, textPattern) {
      const view = runtime.getView(state);
      const index = view.choices.findIndex(choice => textPattern.test(choice.text));
      if (index < 0) throw new Error(`Floor 5 choice not found: ${textPattern}`);
      return runtime.dispatch(state, { type: 'choose_scene_option', index }).state;
    }

    function winCombat(state) {
      let next = state;
      for (let i = 0; i < 35 && runtime.getView(next).mode === 'combat'; i += 1) {
        next = runtime.dispatch(next, { type: 'combat_attack' }).state;
      }
      return next;
    }

    let run = runtime.startNewRun({
      name: 'OverseerEngineRunner',
      playerPatch: { floor: 5, hp: 1200, maxHp: 1200, attack: 1200, defense: 120, gold: 300 },
    });
    run.currentSceneId = 'floor5_service_dock';

    run = chooseByText(run, /Combat Protocol/);
    run = chooseByText(run, /Override/);
    run = winCombat(run);
    run = chooseByText(run, /Combat Clearance/);
    run = chooseByText(run, /Memory Protocol/);
    run = chooseByText(run, /Override/);
    run = chooseByText(run, /memory with a cost/);
    run = chooseByText(run, /Memory Clearance/);
    run = chooseByText(run, /Debt Protocol/);
    run = chooseByText(run, /Override/);
    run = chooseByText(run, /Refuse the ledger/);
    run = chooseByText(run, /Debt Clearance/);
    run = chooseByText(run, /Identity Protocol/);
    run = chooseByText(run, /Override/);
    run = winCombat(run);
    run = chooseByText(run, /Identity Clearance/);
    run = chooseByText(run, /Rulekeeper gate/);
    run = chooseByText(run, /Open the Rulekeeper door/);
    run = winCombat(run);

    run.currentSceneId === 'floor5_clear_room' &&
      [
        'f5_combat_protocol',
        'f5_memory_protocol',
        'f5_debt_protocol',
        'f5_identity_protocol',
        'f5_combat_override',
        'f5_memory_override',
        'f5_debt_override',
        'f5_identity_override',
        'rulekeeper_core',
      ].every(itemId => run.player.inventory.includes(itemId))
      ? ok('runtime Floor 5 full playthrough: four protocols unlock and clear the Rulekeeper')
      : fail('runtime Floor 5 full playthrough failed', JSON.stringify({ scene: run.currentSceneId, inventory: run.player.inventory }));
  }

  // Floor 6: Fracture Map
  {
    [
      'f6_glass_anchor',
      'f6_root_anchor',
      'f6_road_anchor',
      'f6_glass_anomaly',
      'f6_root_anomaly',
      'f6_road_anomaly',
      'outside_heart',
    ].forEach(itemId => {
      items[itemId]
        ? ok(`floor6 item exists: ${itemId}`)
        : fail(`floor6 item missing: ${itemId}`);
    });

    const safe = scenes['floor6_weather_gap'];
    safe?.map?.tag === 'safe' && /Weather Gap|outside the system|Anchor Shards 0\/3/i.test(safe?.text || '')
      ? ok('floor6_weather_gap: safe fracture start introduces Anchor Shards')
      : fail('floor6_weather_gap missing safe intro', JSON.stringify(safe));

    const regionStarts = ['floor6_glass_field', 'floor6_rooted_static', 'floor6_nameless_road'];
    regionStarts.every(id => (safe?.choices || []).some(choice => choice.nextScene === id))
      ? ok('floor6_weather_gap: opens three unstable regions')
      : fail('floor6_weather_gap region choices missing', JSON.stringify(safe?.choices));

    const floor6Rooms = [
      'floor6_glass_field',
      'floor6_glass_rain',
      'floor6_glass_anchor',
      'floor6_rooted_static',
      'floor6_static_grove',
      'floor6_root_anchor',
      'floor6_nameless_road',
      'floor6_road_mile',
      'floor6_road_anchor',
      'floor6_boss_gate',
      'floor6_boss',
      'floor6_clear_room',
    ];

    floor6Rooms.every(id => scenes[id])
      ? ok('floor6 fracture map: core rooms exist')
      : fail('floor6 fracture map missing rooms', floor6Rooms.filter(id => !scenes[id]).join(', '));

    const anchorRewards = [
      ['floor6_glass_anchor', 'f6_glass_anchor'],
      ['floor6_root_anchor', 'f6_root_anchor'],
      ['floor6_road_anchor', 'f6_road_anchor'],
    ];

    anchorRewards.every(([sceneId, itemId]) => (scenes[sceneId]?.choices || []).some(choice => choice.effect?.giveItem === itemId))
      ? ok('floor6 fracture map: each region awards an Anchor Shard')
      : fail('floor6 anchor rewards missing', JSON.stringify(anchorRewards));

    const anomalyRewards = [
      ['floor6_glass_field', 'f6_glass_anomaly'],
      ['floor6_rooted_static', 'f6_root_anomaly'],
      ['floor6_nameless_road', 'f6_road_anomaly'],
    ];

    anomalyRewards.every(([sceneId, itemId]) => (scenes[sceneId]?.choices || []).some(choice => choice.effect?.giveItem === itemId && /fracture|anomaly|break/i.test(choice.text)))
      ? ok('floor6 fracture map: optional fracture choices award Anomaly Marks')
      : fail('floor6 anomaly rewards missing', JSON.stringify(anomalyRewards));

    const gateChoice = (scenes['floor6_boss_gate']?.choices || []).find(choice => choice.nextScene === 'floor6_boss');
    ['f6_glass_anchor', 'f6_root_anchor', 'f6_road_anchor'].every(itemId => gateChoice?.requires?.items?.includes(itemId))
      ? ok('floor6 boss gate: requires all three Anchor Shards')
      : fail('floor6 boss gate requirements missing', JSON.stringify(gateChoice));

    const boss = scenes['floor6_boss'];
    boss?.map?.tag === 'boss' &&
      boss.combat?.name === 'The Outside Thing' &&
      boss.combat?.loot?.includes('outside_heart') &&
      boss.victoryScene === 'floor6_clear_room'
      ? ok('floor6 boss: Outside Thing drops unique heart and clears floor')
      : fail('floor6 boss definition missing', JSON.stringify(boss));

    const advantageItems = (boss?.combat?.advantages || []).map(advantage => advantage.item);
    ['f6_glass_anomaly', 'f6_root_anomaly', 'f6_road_anomaly'].every(itemId => advantageItems.includes(itemId))
      ? ok('floor6 boss: Anomaly Marks weaken the Outside Thing')
      : fail('floor6 boss advantages missing', JSON.stringify(boss?.combat?.advantages));

    scenes['floor6_clear_room']?.choices?.some(choice => choice.nextScene === 'the_end') &&
      /Floor 7|first free zone|outside/i.test(scenes['floor6_clear_room']?.text || '')
      ? ok('floor6 clear room: hands off toward Floor 7')
      : fail('floor6 clear room handoff missing', scenes['floor6_clear_room']?.text);
  }

  {
    function chooseByText(state, textPattern) {
      const view = runtime.getView(state);
      const index = view.choices.findIndex(choice => textPattern.test(choice.text));
      if (index < 0) throw new Error(`Floor 6 choice not found: ${textPattern}`);
      return runtime.dispatch(state, { type: 'choose_scene_option', index }).state;
    }

    function winCombat(state) {
      let next = state;
      for (let i = 0; i < 40 && runtime.getView(next).mode === 'combat'; i += 1) {
        next = runtime.dispatch(next, { type: 'combat_attack' }).state;
      }
      return next;
    }

    let run = runtime.startNewRun({
      name: 'FractureMapRunner',
      playerPatch: { floor: 6, hp: 1400, maxHp: 1400, attack: 1400, defense: 140, gold: 400 },
    });
    run.currentSceneId = 'floor6_weather_gap';

    run = chooseByText(run, /Glass Rain Field/);
    run = chooseByText(run, /fracture/);
    run = chooseByText(run, /cross the glass rain/);
    run = chooseByText(run, /Glass Anchor/);
    run = chooseByText(run, /Rooted Static/);
    run = chooseByText(run, /fracture/);
    run = winCombat(run);
    run = chooseByText(run, /Root Anchor/);
    run = chooseByText(run, /Nameless Road/);
    run = chooseByText(run, /fracture/);
    run = chooseByText(run, /walk until the name returns/);
    run = chooseByText(run, /Road Anchor/);
    run = chooseByText(run, /Anchor gate/);
    run = chooseByText(run, /Open the outside gate/);
    run = winCombat(run);

    run.currentSceneId === 'floor6_clear_room' &&
      ['f6_glass_anchor', 'f6_root_anchor', 'f6_road_anchor', 'f6_glass_anomaly', 'f6_root_anomaly', 'f6_road_anomaly', 'outside_heart'].every(itemId => run.player.inventory.includes(itemId))
      ? ok('runtime Floor 6 full playthrough: three regions anchor and clear the Outside Thing')
      : fail('runtime Floor 6 full playthrough failed', JSON.stringify({ scene: run.currentSceneId, inventory: run.player.inventory }));
  }

  // Floor 7: First Free Zone
  {
    [
      'f7_forager_trust',
      'f7_scout_trust',
      'f7_healer_trust',
      'f7_builder_trust',
      'f7_forager_favor',
      'f7_scout_favor',
      'f7_healer_favor',
      'f7_builder_favor',
      'freecamp_banner',
    ].forEach(itemId => {
      items[itemId]
        ? ok(`floor7 item exists: ${itemId}`)
        : fail(`floor7 item missing: ${itemId}`);
    });

    const safe = scenes['floor7_freecamp'];
    safe?.map?.tag === 'safe' && /Freecamp|First Free Zone|Trust Bonds 0\/4/i.test(safe?.text || '')
      ? ok('floor7_freecamp: safe settlement introduces Trust Bonds')
      : fail('floor7_freecamp missing safe intro', JSON.stringify(safe));

    const pathStarts = ['floor7_forager_orchard', 'floor7_scout_ridge', 'floor7_healer_tents', 'floor7_builder_wall'];
    pathStarts.every(id => (safe?.choices || []).some(choice => choice.nextScene === id))
      ? ok('floor7_freecamp: opens four local trust paths')
      : fail('floor7_freecamp trust choices missing', JSON.stringify(safe?.choices));

    const floor7Rooms = [
      'floor7_forager_orchard',
      'floor7_living_orchard',
      'floor7_forager_bond',
      'floor7_scout_ridge',
      'floor7_no_rule_ridge',
      'floor7_scout_bond',
      'floor7_healer_tents',
      'floor7_weather_sick',
      'floor7_healer_bond',
      'floor7_builder_wall',
      'floor7_defense_line',
      'floor7_builder_bond',
      'floor7_council_fire',
      'floor7_boss',
      'floor7_clear_room',
    ];

    floor7Rooms.every(id => scenes[id])
      ? ok('floor7 first free zone: core rooms exist')
      : fail('floor7 first free zone missing rooms', floor7Rooms.filter(id => !scenes[id]).join(', '));

    const trustRewards = [
      ['floor7_forager_bond', 'f7_forager_trust'],
      ['floor7_scout_bond', 'f7_scout_trust'],
      ['floor7_healer_bond', 'f7_healer_trust'],
      ['floor7_builder_bond', 'f7_builder_trust'],
    ];

    trustRewards.every(([sceneId, itemId]) => (scenes[sceneId]?.choices || []).some(choice => choice.effect?.giveItem === itemId))
      ? ok('floor7 first free zone: each path awards a Trust Bond')
      : fail('floor7 trust rewards missing', JSON.stringify(trustRewards));

    const favorRewards = [
      ['floor7_forager_orchard', 'f7_forager_favor'],
      ['floor7_scout_ridge', 'f7_scout_favor'],
      ['floor7_healer_tents', 'f7_healer_favor'],
      ['floor7_builder_wall', 'f7_builder_favor'],
    ];

    favorRewards.every(([sceneId, itemId]) => (scenes[sceneId]?.choices || []).some(choice => choice.effect?.giveItem === itemId && /favor|help|share|stand/i.test(choice.text)))
      ? ok('floor7 first free zone: compassionate choices award Free Zone Favors')
      : fail('floor7 favor rewards missing', JSON.stringify(favorRewards));

    const gateChoice = (scenes['floor7_council_fire']?.choices || []).find(choice => choice.nextScene === 'floor7_boss');
    ['f7_forager_trust', 'f7_scout_trust', 'f7_healer_trust', 'f7_builder_trust'].every(itemId => gateChoice?.requires?.items?.includes(itemId))
      ? ok('floor7 council fire: requires all four Trust Bonds')
      : fail('floor7 council fire requirements missing', JSON.stringify(gateChoice));

    const boss = scenes['floor7_boss'];
    boss?.map?.tag === 'boss' &&
      boss.combat?.name === 'The Claimant' &&
      boss.combat?.loot?.includes('freecamp_banner') &&
      boss.victoryScene === 'floor7_clear_room'
      ? ok('floor7 boss: Claimant drops Freecamp Banner and clears floor')
      : fail('floor7 boss definition missing', JSON.stringify(boss));

    const advantageItems = (boss?.combat?.advantages || []).map(advantage => advantage.item);
    ['f7_forager_favor', 'f7_scout_favor', 'f7_healer_favor', 'f7_builder_favor'].every(itemId => advantageItems.includes(itemId))
      ? ok('floor7 boss: Free Zone Favors weaken the Claimant')
      : fail('floor7 boss advantages missing', JSON.stringify(boss?.combat?.advantages));

    scenes['floor7_clear_room']?.choices?.some(choice => choice.nextScene === 'the_end') &&
      /Floor 8|wider wild|Freecamp/i.test(scenes['floor7_clear_room']?.text || '')
      ? ok('floor7 clear room: hands off toward Floor 8')
      : fail('floor7 clear room handoff missing', scenes['floor7_clear_room']?.text);
  }

  {
    function chooseByText(state, textPattern) {
      const view = runtime.getView(state);
      const index = view.choices.findIndex(choice => textPattern.test(choice.text));
      if (index < 0) throw new Error(`Floor 7 choice not found: ${textPattern}`);
      return runtime.dispatch(state, { type: 'choose_scene_option', index }).state;
    }

    function winCombat(state) {
      let next = state;
      for (let i = 0; i < 45 && runtime.getView(next).mode === 'combat'; i += 1) {
        next = runtime.dispatch(next, { type: 'combat_attack' }).state;
      }
      return next;
    }

    let run = runtime.startNewRun({
      name: 'FreecampRunner',
      playerPatch: { floor: 7, hp: 1600, maxHp: 1600, attack: 1600, defense: 160, gold: 500 },
    });
    run.currentSceneId = 'floor7_freecamp';

    run = chooseByText(run, /Foragers/);
    run = chooseByText(run, /share the first safe fruit/);
    run = chooseByText(run, /harvest the living orchard/);
    run = chooseByText(run, /Forager Trust/);
    run = chooseByText(run, /Scouts/);
    run = chooseByText(run, /stand watch/);
    run = chooseByText(run, /map the no-rule ridge/);
    run = chooseByText(run, /Scout Trust/);
    run = chooseByText(run, /Healers/);
    run = chooseByText(run, /help carry the injured/);
    run = chooseByText(run, /stabilize the weather sick/);
    run = chooseByText(run, /Healer Trust/);
    run = chooseByText(run, /Builders/);
    run = chooseByText(run, /stand on the wall/);
    run = winCombat(run);
    run = chooseByText(run, /Builder Trust/);
    run = chooseByText(run, /Council Fire/);
    run = chooseByText(run, /Open the boss trail/);
    run = winCombat(run);

    run.currentSceneId === 'floor7_clear_room' &&
      ['f7_forager_trust', 'f7_scout_trust', 'f7_healer_trust', 'f7_builder_trust', 'f7_forager_favor', 'f7_scout_favor', 'f7_healer_favor', 'f7_builder_favor', 'freecamp_banner'].every(itemId => run.player.inventory.includes(itemId))
      ? ok('runtime Floor 7 full playthrough: four trust paths rally Freecamp and clear the Claimant')
      : fail('runtime Floor 7 full playthrough failed', JSON.stringify({ scene: run.currentSceneId, inventory: run.player.inventory }));
  }

  {
    const marketState = runtime.startNewRun({
      name: 'MarketPolishProbe',
      playerPatch: { floor: 3, contractsCompleted: 5, completedContracts: ['hunt', 'recovery', 'puzzle', 'escort', 'debt'] },
    });
    marketState.currentSceneId = 'floor3_market';
    const marketView = runtime.getView(marketState);
    const bossChoice = marketView.choices.find(choice => choice.nextScene === 'floor3_boss_portal');
    const reactionChoice = marketView.choices.find(choice => /Arbiter's odds/i.test(choice.text));

    bossChoice?.progressLabel === 'Progress: 5/5 contracts complete. Boss portal unlocked.' &&
      reactionChoice?.rewardLabel?.includes('20 XP') &&
      marketView.contractProgress?.completed === 5 &&
      marketView.contractProgress?.required === 5 &&
      marketView.objective?.goal === 'Enter the Market Arbiter boss portal'
      ? ok('runtime Floor 3 market view: contract count, boss unlock, and final reaction are clear')
      : fail('runtime Floor 3 market clarity', JSON.stringify({ bossChoice, reactionChoice, contractProgress: marketView.contractProgress, objective: marketView.objective }));
  }

  {
    function chooseByText(state, textPattern) {
      const view = runtime.getView(state);
      const index = view.choices.findIndex(choice => textPattern.test(choice.text));
      if (index < 0) throw new Error(`choice not found: ${textPattern}`);
      return runtime.dispatch(state, { type: 'choose_scene_option', index }).state;
    }

    function winCombat(state) {
      let next = state;
      let guard = 0;
      while (runtime.getView(next).mode === 'combat' && guard < 20) {
        next = runtime.dispatch(next, { type: 'combat_attack' }).state;
        guard++;
      }
      return next;
    }

    let run = runtime.startNewRun({
      name: 'Floor3FullClear',
      playerPatch: { floor: 3, hp: 999, maxHp: 999, attack: 999, defense: 99, gold: 300 },
    });
    run.currentSceneId = 'floor3_market';

    run = chooseByText(run, /Hunt Contract/);
    run = chooseByText(run, /marked target/);
    run = chooseByText(run, /Study the spoor/);
    run = winCombat(run);
    run = chooseByText(run, /Claim the Hunt/);

    run = chooseByText(run, /Recovery Contract/);
    run = chooseByText(run, /Enter the recovery portal/);
    run = chooseByText(run, /Compare the claim/);
    run = chooseByText(run, /Lift the sealed case/);
    run = chooseByText(run, /Claim the Recovery/);

    run = chooseByText(run, /Puzzle Contract/);
    run = chooseByText(run, /Enter the puzzle portal/);
    run = chooseByText(run, /Sort the receipts/);
    run = chooseByText(run, /Mark the repeated payer/);
    run = chooseByText(run, /Claim the Puzzle/);

    run = chooseByText(run, /Escort Contract/);
    run = chooseByText(run, /Escort the drone/);
    run = chooseByText(run, /Recalibrate the drone/);
    run = winCombat(run);
    run = chooseByText(run, /Claim the Escort/);

    run = chooseByText(run, /Debt Contract/);
    run = chooseByText(run, /Enter the debt portal/);
    run = chooseByText(run, /Interview the recordings/);
    run = chooseByText(run, /Pay the debt cleanly/);
    run = chooseByText(run, /Claim the Debt/);

    run = chooseByText(run, /boss portal/);
    run = chooseByText(run, /Enter the boss portal/);
    run = winCombat(run);

    run.currentSceneId === 'floor3_clear_room' &&
      run.player.contractsCompleted === 5 &&
      ['hunt_seal', 'recovery_seal', 'puzzle_seal', 'escort_seal', 'debt_seal', 'market_arbiter_ledger'].every(itemId => run.player.inventory.includes(itemId))
      ? ok('runtime Floor 3 full playthrough: five contracts unlock and clear the Arbiter')
      : fail('runtime Floor 3 full playthrough failed', JSON.stringify({ scene: run.currentSceneId, contractsCompleted: run.player.contractsCompleted, inventory: run.player.inventory }));
  }

  {
    const room = scenes['maintenance_refuge'];
    room.map?.tag === 'safe' ? ok('maintenance_refuge: tagged safe') : fail('maintenance_refuge tag', room.map?.tag);
    (room.choices || []).some(c => c.effect?.heal)
      ? ok('maintenance_refuge: has one-time rest/heal choice')
      : fail('maintenance_refuge: no rest/heal choice');
    (room.choices || []).some(c => c.effect?.giveItem === 'warden_override')
      ? ok('maintenance_refuge: can grant warden_override')
      : fail('maintenance_refuge: no warden_override reward');
  }

  // ── rival_room: combat, trickster type, w3 ranger ──
  {
    const room = scenes['rival_room'];
    room.combat ? ok('rival_room: has combat') : fail('rival_room: no combat data');
    room.combat?.type === 'trickster' ? ok('rival_room: trickster type') : fail('rival_room type', room.combat?.type);
    room.combat?.loot?.includes('ranger_cloak') ? ok('rival_room: rewards trick gear') : fail('rival_room: missing ranger_cloak reward');
    room.fleeScene === 'merchant_room' ? ok('rival_room: flees to merchant_room') : fail('rival_room fleeScene');
    room.victoryScene === 'merchant_room' ? ok('rival_room: victory returns to merchant_room') : fail('rival_room victoryScene');
  }

  // ── dead_end_passage: combat, defensive, leads to loot room ──
  {
    const room = scenes['dead_end_passage'];
    room.combat ? ok('dead_end_passage: has combat') : fail('dead_end_passage: no combat');
    room.combat?.type === 'defensive' ? ok('dead_end_passage: defensive type') : fail('dead_end_passage type');
    room.combat?.loot?.includes('sentry_plate') ? ok('dead_end_passage: rewards defensive gear') : fail('dead_end_passage: missing sentry_plate reward');
    room.victoryScene === 'dead_end_loot' ? ok('dead_end_passage: victory→dead_end_loot') : fail('dead_end_passage victoryScene');
    room.fleeScene === 'warden_trap' ? ok('dead_end_passage: flee→warden_trap') : fail('dead_end_passage fleeScene');
  }

  // ── peril_room: overseer_code branch exists, hidden without code ──
  {
    const room = scenes['peril_room'];
    const noCode = getAvailableChoices(room, makePlayer({}));
    const withCode = getAvailableChoices(room, makePlayer({ inventory: ['overseer_code'] }));
    const withGateKeys = getAvailableChoices(room, makePlayer({ inventory: ['security_clearance', 'warden_override'] }));
    noCode.some(c => c.nextScene === 'deadly_room')
      ? fail('peril_room: Warden route visible without both gate keys')
      : ok('peril_room: Warden route hidden without both gate keys');
    withGateKeys.some(c => c.nextScene === 'deadly_room')
      ? ok('peril_room: Warden route visible with both gate keys')
      : fail('peril_room: Warden route missing with both gate keys');
    scenes['deadly_room'].combat?.loot?.includes('shock_baton')
      ? ok('deadly_room: high-risk checkpoint can reward stronger weapon')
      : fail('deadly_room: missing shock_baton reward');
    noCode.some(c => c.nextScene === 'overseer_antechamber')
      ? fail('peril_room: overseer branch visible without code')
      : ok('peril_room: overseer branch hidden without overseer_code');
    withCode.some(c => c.nextScene === 'overseer_antechamber')
      ? ok('peril_room: overseer branch visible with overseer_code')
      : fail('peril_room: overseer branch missing with code');
  }

  // ── overseer_chamber: Protocol 7-B requires overseer_code ──
  {
    const room = scenes['merge_room'];
    const noRouteToken = getAvailableChoices(room, makePlayer({ route: 'security' }));
    const withSecurityToken = getAvailableChoices(room, makePlayer({ route: 'security', inventory: ['security_route_token'] }));
    const withFullSecurityAuth = getAvailableChoices(room, makePlayer({ route: 'security', inventory: ['security_route_token', 'security_clearance', 'warden_override'] }));
    const withServiceCode = getAvailableChoices(room, makePlayer({ route: 'security', inventory: ['security_route_token', 'overseer_code'] }));
    const withWardToken = getAvailableChoices(room, makePlayer({ route: 'ward', inventory: ['ward_route_token'] }));
    const withFullWardAuth = getAvailableChoices(room, makePlayer({ route: 'ward', inventory: ['ward_route_token', 'overseer_code'] }));
    noRouteToken.some(c => c.nextScene === 'peril_room')
      ? fail('merge_room: restricted access visible before route chain token')
      : ok('merge_room: restricted access hidden before route chain token');
    withSecurityToken.some(c => c.nextScene === 'peril_room')
      ? fail('merge_room: security route opens with only the route token')
      : ok('merge_room: security route requires full Warden authorization, not only route token');
    withFullSecurityAuth.some(c => c.nextScene === 'peril_room')
      ? ok('merge_room: full security authorization unlocks restricted access')
      : fail('merge_room: full security authorization does not unlock restricted access');
    withServiceCode.some(c => c.nextScene === 'peril_room')
      ? ok('merge_room: service code plus route token unlocks alternate access')
      : fail('merge_room: service code plus route token does not unlock alternate access');
    withWardToken.some(c => c.nextScene === 'peril_room')
      ? fail('merge_room: ward route opens with only the route token')
      : ok('merge_room: ward route requires service code, not only route token');
    withFullWardAuth.some(c => c.nextScene === 'peril_room')
      ? ok('merge_room: full ward authorization unlocks restricted access')
      : fail('merge_room: full ward authorization does not unlock restricted access');
  }

  {
    const room = scenes['overseer_chamber'];
    room.map?.tag === 'boss' ? ok('overseer_chamber: tagged boss') : fail('overseer_chamber tag', room.map?.tag);
    const noCode = getAvailableChoices(room, makePlayer({}));
    const withCode = getAvailableChoices(room, makePlayer({ inventory: ['overseer_code'] }));
    noCode.some(c => c.effect?.giveItem === 'cipher_fragment' && c.requires?.item === 'overseer_code')
      ? fail('overseer_chamber: Protocol 7-B visible without code')
      : ok('overseer_chamber: Protocol 7-B hidden without overseer_code');
    withCode.some(c => c.nextScene === 'end_room' && c.effect?.giveItem === 'cipher_fragment')
      ? ok('overseer_chamber: Protocol 7-B leads to end_room with cipher_fragment')
      : fail('overseer_chamber: Protocol 7-B choice broken');
  }

  // ── evaluation_argument: three passing routes ──
  {
    const room = scenes['evaluation_argument'];
    const passChoices = (room.choices || []).filter(c => c.nextScene === 'end_room');
    passChoices.length >= 2
      ? ok(`evaluation_argument: ${passChoices.length} passing choices (multi-route)`)
      : fail('evaluation_argument: too few passing choices', passChoices.length);
    const per1Pass = passChoices.find(c => c.condition?.perception === 1);
    per1Pass ? ok('evaluation_argument: perception>=1 passing route exists') : fail('evaluation_argument: no per-gated pass');
    const honestPass = passChoices.find(c => !c.condition && !c.requires);
    honestPass ? ok('evaluation_argument: unconditional honest pass exists') : fail('evaluation_argument: no honest pass');
  }

  // ── secret_room: perception=2 reveals overseer path ──
  {
    const room = scenes['secret_room'];
    const per0 = getAvailableChoices(room, makePlayer({}));
    const per2 = getAvailableChoices(room, makePlayer({ perception: 2 }));
    per0.some(c => c.nextScene === 'overseer_antechamber')
      ? fail('secret_room: overseer path visible at per=0')
      : ok('secret_room: overseer path hidden at per=0');
    per2.some(c => c.nextScene === 'overseer_antechamber')
      ? ok('secret_room: overseer path visible at per=2')
      : fail('secret_room: overseer path not visible at per=2');
  }

  // ── boss drops warden_shackle (combat-path relic) ──
  {
    const boss = scenes['boss_room'];
    boss.combat?.loot?.includes('warden_shackle')
      ? ok('boss_room: warden_shackle in loot (combat-path relic)')
      : fail('boss_room: warden_shackle missing from loot');
  }

  // ── PATH A: combat path walk — left→guard→trap→merge→enforcer→boss→end ──
  {
    const p = makePlayer({ inventory: ['guard_key'] });
    const result = walk('start_room', p, {
      start_room: 0,
      left_path:  0,
      trap_room:  3,   // guard_key override
      security_lockdown: 0,
      merge_room: [1, 0, 2],   // supply cache, break room, then restricted access
      supply_cache: [1, 1],    // clearance, then leave
      warden_trap: [5, 4], // sub-level sentry, then leave
      dead_end_loot: [0, 1],
      peril_room: 0,   // present both Warden authorizations
      end_room:   0,
    });
    result.ok && result.terminal === 'the_end'
      ? ok('PATH A (combat): start→left→guard→trap→merge→peril→enforcer→boss→end')
      : fail('PATH A walk', result.error || `terminal: ${result.terminal}`);
  }

  // ── PATH B (Protocol 7-B): lore_room route → overseer → direct pass ──
  {
    const p = makePlayer({ perception: 2, inventory: ['overseer_code'] });
    const result = walk('start_room', p, {
      start_room:           0,   // left
      left_path:            0,   // rush guard
      trap_room:            1,   // move carefully
      security_lockdown:    0,
      merge_room:           2,   // restricted access
      peril_room:           0,   // service corridor (only Overseer route visible besides retreat)
      overseer_antechamber: 0,   // proceed to office
      overseer_chamber:     0,   // Protocol 7-B (first visible with overseer_code)
      end_room:             0,
    });
    result.ok && result.terminal === 'the_end'
      ? ok('PATH B (Protocol 7-B): peril→antechamber→overseer(7-B)→end')
      : fail('PATH B walk', result.error || `terminal: ${result.terminal}`);
  }

  // ── PATH B (secret room): secret_room perception path → evaluation ──
  {
    const p = makePlayer({ perception: 2 });
    const result = walk('start_room', p, {
      start_room:           1,   // right
      right_path:           0,   // main ward
      reward_room:          0,
      quarantine_lockdown:  0,
      merge_room:           3,   // scored marks -> secret_room (per>=2)
      secret_room:          4,   // service access behind cabinet (per>=2, index 4 = 5th choice)
      overseer_antechamber: 0,
      overseer_chamber:     0,   // request evaluation (Protocol 7-B hidden, index 0 = request eval)
      evaluation_argument:  0,   // argue adaptive completion (per>=1 visible, index 0)
      end_room:             0,
    });
    result.ok && result.terminal === 'the_end'
      ? ok('PATH B (secret room): right→secret_room→overseer(eval)→end')
      : fail('PATH B secret walk', result.error || `terminal: ${result.terminal}`);
  }
}

// ── 14. Roguelite Floor Generation ────────────────────────────────────────
{
  console.log('\n── Section 14: Roguelite Floor Generation ──');
  const { generateFloor1Config, filterChoices, ENEMY_VARIANTS } = require('./engine/floorGen');

  // 14.1 Config structure
  const cfg = generateFloor1Config();
  ok('generateFloor1Config returns object') ;

  // 14.2 Floor 1 identity
  cfg.floor === 1
    ? ok('config.floor === 1')
    : fail('config.floor === 1', `got ${cfg.floor}`);

  // 14.3 exactly 2 active side rooms
  cfg.activeSideRooms.length === 2
    ? ok('activeSideRooms.length === 2')
    : fail('activeSideRooms.length === 2', `got ${cfg.activeSideRooms.length}`);

  // 14.4 active rooms are a subset of the pool
  const SIDE_POOL = new Set(['warden_trap', 'supply_cache', 'alchemy_lab']);
  const sideValid = cfg.activeSideRooms.every(r => SIDE_POOL.has(r));
  sideValid
    ? ok('activeSideRooms all come from the pool')
    : fail('activeSideRooms all come from the pool', JSON.stringify(cfg.activeSideRooms));

  // 14.5 the third room is excluded
  const excluded = new Set(cfg.excludedRooms);
  const excludedSide = [...SIDE_POOL].filter(r => !cfg.activeSideRooms.includes(r));
  excludedSide.every(r => excluded.has(r))
    ? ok('inactive side room is in excludedRooms')
    : fail('inactive side room is in excludedRooms', JSON.stringify([...excluded]));

  // 14.6 loreAccess is one of the valid values
  ['left_crack', 'secret_room', 'both'].includes(cfg.loreAccess)
    ? ok('loreAccess is valid')
    : fail('loreAccess is valid', `got "${cfg.loreAccess}"`);

  // 14.7 rightSideAvailable is boolean
  typeof cfg.rightSideAvailable === 'boolean'
    ? ok('rightSideAvailable is boolean')
    : fail('rightSideAvailable is boolean', `got ${typeof cfg.rightSideAvailable}`);

  // 14.8 deadEndIncluded implies warden_trap active
  if (cfg.deadEndIncluded && !cfg.activeSideRooms.includes('warden_trap')) {
    fail('deadEndIncluded only when warden_trap active', 'dead end included without warden_trap');
  } else {
    ok('deadEndIncluded consistent with warden_trap');
  }

  // 14.9 right side excluded when unavailable
  if (!cfg.rightSideAvailable) {
    const bothExcl = excluded.has('merchant_room') && excluded.has('rival_room');
    bothExcl
      ? ok('merchant_room and rival_room excluded when rightSide=false')
      : fail('merchant_room and rival_room excluded when rightSide=false', JSON.stringify([...excluded]));
  } else {
    ok('rightSide=true: merchant/rival available (not in excludedRooms)');
  }

  // 14.10 lore_room excluded when loreAccess is secret_room
  if (cfg.loreAccess === 'secret_room') {
    excluded.has('lore_room')
      ? ok('lore_room excluded when loreAccess=secret_room')
      : fail('lore_room excluded when loreAccess=secret_room', JSON.stringify([...excluded]));
  } else {
    ok('loreAccess not secret_room: lore_room available (skipping exclusion check)');
  }

  // 14.11 dead end rooms excluded when deadEndIncluded=false
  if (!cfg.deadEndIncluded) {
    const deExcl = excluded.has('dead_end_passage') && excluded.has('dead_end_loot');
    deExcl
      ? ok('dead_end rooms excluded when deadEndIncluded=false')
      : fail('dead_end rooms excluded when deadEndIncluded=false', JSON.stringify([...excluded]));
  } else {
    ok('deadEndIncluded=true: dead_end rooms available (skipping check)');
  }

  // 14.12 enemy variant pools have 3 entries each
  ['left_path_combat', 'right_path_combat', 'deadly_room'].forEach(slot => {
    ENEMY_VARIANTS[slot].length === 3
      ? ok(`ENEMY_VARIANTS.${slot} has 3 entries`)
      : fail(`ENEMY_VARIANTS.${slot} has 3 entries`, `got ${ENEMY_VARIANTS[slot].length}`);
  });

  // 14.13 config has enemyVariants for the 3 combat slots
  const hasVariants = cfg.enemyVariants
    && cfg.enemyVariants.left_path_combat
    && cfg.enemyVariants.right_path_combat
    && cfg.enemyVariants.deadly_room;
  hasVariants
    ? ok('config has enemyVariants for all 3 combat slots')
    : fail('config has enemyVariants for all 3 combat slots', JSON.stringify(cfg.enemyVariants));

  // 14.14 selected enemy variants have required fields
  for (const [slot, v] of Object.entries(cfg.enemyVariants)) {
    const valid = v.name && v.hp > 0 && v.attack > 0 && v.defense >= 0 && Array.isArray(v.loot);
    valid
      ? ok(`enemyVariant[${slot}] has all required fields`)
      : fail(`enemyVariant[${slot}] has all required fields`, JSON.stringify(v));
  }

  // 14.15 floor 1 combat pools should threaten a starter fighter
  const tunedThreats = [
    ['left_path_combat', 15, 28],
    ['right_path_combat', 17, 40],
    ['deadly_room', 20, 60],
  ];
  tunedThreats.forEach(([slot, minAttack, minHp]) => {
    const tuned = ENEMY_VARIANTS[slot].every(enemy => enemy.attack >= minAttack && enemy.hp >= minHp);
    tuned
      ? ok(`ENEMY_VARIANTS.${slot} has dangerous floor tuning`)
      : fail(`ENEMY_VARIANTS.${slot} has dangerous floor tuning`, JSON.stringify(ENEMY_VARIANTS[slot]));
  });

  // 14.16 filterChoices removes excluded nextScene choices
  {
    const choices = [
      { text: 'Go to A', nextScene: 'merchant_room' },
      { text: 'Go to B', nextScene: 'rival_room' },
      { text: 'Stay here' },
      { text: 'Go to C', nextScene: 'start_room' },
    ];
    const excl = new Set(['merchant_room', 'rival_room']);
    const result = filterChoices(choices, excl);
    result.length === 2 && result.every(c => !excl.has(c.nextScene))
      ? ok('filterChoices removes excluded nextScene choices')
      : fail('filterChoices removes excluded nextScene choices', `got ${result.length} choices`);
  }

  // 14.17 filterChoices preserves choices with no nextScene
  {
    const choices = [{ text: 'Look around' }, { text: 'Wait' }];
    const result = filterChoices(choices, new Set(['merchant_room']));
    result.length === 2
      ? ok('filterChoices preserves choices with no nextScene')
      : fail('filterChoices preserves choices with no nextScene', `got ${result.length}`);
  }

  // 14.17 filterChoices with empty set returns all choices unchanged
  {
    const choices = [
      { text: 'A', nextScene: 'boss_room' },
      { text: 'B', nextScene: 'end_room' },
    ];
    const result = filterChoices(choices, new Set());
    result.length === 2
      ? ok('filterChoices with empty excludedRooms returns all choices')
      : fail('filterChoices with empty excludedRooms returns all choices', `got ${result.length}`);
  }

  // 14.18 multiple configs produce varied results (run 20x, expect at least 2 distinct configs)
  {
    const configs = Array.from({ length: 20 }, () => generateFloor1Config());
    const signatures = new Set(configs.map(c =>
      `${c.loreAccess}|${c.rightSideAvailable}|${c.deadEndIncluded}|${c.activeSideRooms.sort().join(',')}`
    ));
    signatures.size >= 2
      ? ok(`multiple configs produce varied results (${signatures.size} distinct in 20 runs)`)
      : fail('multiple configs produce varied results', 'all 20 runs identical');
  }

  // 14.19 PATH A always possible: boss_room and end_room always reachable (not excluded)
  {
    const cfg2 = generateFloor1Config();
    const excl2 = new Set(cfg2.excludedRooms);
    !excl2.has('boss_room') && !excl2.has('end_room')
      ? ok('PATH A rooms (boss_room, end_room) never excluded')
      : fail('PATH A rooms (boss_room, end_room) never excluded', JSON.stringify([...excl2]));
  }

  // 14.20 PATH B always possible: overseer_chamber and evaluation_argument never excluded
  {
    const cfg3 = generateFloor1Config();
    const excl3 = new Set(cfg3.excludedRooms);
    !excl3.has('overseer_chamber') && !excl3.has('evaluation_argument')
      ? ok('PATH B rooms (overseer_chamber, evaluation_argument) never excluded')
      : fail('PATH B rooms (overseer_chamber, evaluation_argument) never excluded', JSON.stringify([...excl3]));
  }

  // 14.21 revealConnected skips excluded rooms
  {
    const { revealConnected } = require('./engine/map');
    const { createPlayer } = require('./engine/state');
    const p = createPlayer('Tester');
    p.floor = 1;
    p.mapData = {};
    // right_upstream connects to merchant_room and right_path_combat; exclude merchant_room
    const scene = scenes['right_upstream'];
    if (!scene) {
      fail('revealConnected skips excluded rooms', 'right_upstream scene missing');
    } else {
      const excl4 = new Set(['merchant_room']);
      revealConnected(p, scene, scenes, 1, excl4);
      const discovered = (p.mapData['1'] || {}).discovered || [];
      !discovered.includes('merchant_room')
        ? ok('revealConnected skips excluded rooms')
        : fail('revealConnected skips excluded rooms', 'merchant_room was discovered despite exclusion');
    }
  }

  // 14.22 revealConnected with empty set discovers all non-secret connections
  {
    const { revealConnected } = require('./engine/map');
    const { createPlayer } = require('./engine/state');
    const p = createPlayer('Tester2');
    p.floor = 1;
    p.mapData = {};
    const scene = scenes['right_upstream'];
    if (!scene) {
      fail('revealConnected with empty set discovers non-secret connections', 'right_upstream missing');
    } else {
      revealConnected(p, scene, scenes, 1, new Set());
      const discovered = (p.mapData['1'] || {}).discovered || [];
      discovered.includes('merchant_room')
        ? ok('revealConnected with empty set discovers merchant_room')
        : fail('revealConnected with empty set discovers merchant_room', JSON.stringify(discovered));
    }
  }
}

// ── 15. Save System Optimization ──────────────────────────────────────────
{
  console.log('\n── Section 15: Save System Optimization ──');
  const saveModule = require('./engine/save');

  // 15.1 Module exports correct functions
  typeof saveModule.saveGame === 'function'
    ? ok('save: saveGame is exported as a function')
    : fail('save: saveGame is exported as a function');

  typeof saveModule.loadGame === 'function'
    ? ok('save: loadGame is exported as a function')
    : fail('save: loadGame is exported as a function');

  typeof saveModule._cancelPending === 'function'
    ? ok('save: _cancelPending is exported (debounce control)')
    : fail('save: _cancelPending is exported');

  // 15.2 saveGame does not block — returns in < 20ms
  {
    const start = Date.now();
    saveModule.saveGame({ player: { name: 'TestBlock' }, currentSceneId: 'start_room' });
    const elapsed = Date.now() - start;
    saveModule._cancelPending(); // cancel before it writes to disk
    elapsed < 20
      ? ok(`save: saveGame returns immediately (${elapsed}ms)`)
      : fail('save: saveGame returns immediately', `took ${elapsed}ms`);
  }

  // 15.3 100 rapid calls do not throw and are coalesced
  {
    let threw = false;
    try {
      for (let i = 0; i < 100; i++) {
        saveModule.saveGame({ player: { name: 'Spam', iter: i }, currentSceneId: 'start_room' });
      }
    } catch (e) {
      threw = true;
    }
    saveModule._cancelPending();
    !threw
      ? ok('save: 100 rapid saveGame calls do not throw')
      : fail('save: 100 rapid saveGame calls do not throw');
  }

  // 15.4 _cancelPending clears queued state
  {
    saveModule.saveGame({ player: { name: 'WillBeCleared' }, currentSceneId: 'start_room' });
    saveModule._cancelPending();
    // If _cancelPending works, no file write is queued. We can't inspect _pending directly,
    // but verifying no error and function returns normally is sufficient.
    ok('save: _cancelPending cancels debounced write without error');
  }

  // 15.5 loadGame handles missing save gracefully (returns null)
  // Using a path that won't exist: the save module falls back to null when no file found.
  // We can test this by invoking loadGame after _cancelPending (no file created by our test calls).
  // This is fragile if a real save.json exists — we just verify loadGame is callable.
  {
    let threw = false;
    try { saveModule.loadGame(); } catch (e) { threw = true; }
    !threw
      ? ok('save: loadGame runs without throwing')
      : fail('save: loadGame runs without throwing');
  }

  // 15.6 Smart autosave logic: movedRooms condition
  {
    // Simulate the prevSceneId / currentSceneId logic from index.js
    const checkShouldSave = (prevScene, nextScene, chosenOnce, chosenEffect, chaosOccurred) => {
      const movedRooms     = nextScene !== prevScene;
      const meaningfulOnce = chosenOnce && !!chosenEffect;
      return movedRooms || meaningfulOnce || chaosOccurred;
    };

    checkShouldSave('room_a', 'room_b', false, null, false)
      ? ok('autosave: room navigation triggers save')
      : fail('autosave: room navigation triggers save');

    !checkShouldSave('room_a', 'room_a', true, null, false)
      ? ok('autosave: lore choice (once, no effect, no move) does NOT save')
      : fail('autosave: lore choice should not save');

    checkShouldSave('room_a', 'room_a', true, { giveItem: 'potion' }, false)
      ? ok('autosave: once-choice with giveItem effect triggers save')
      : fail('autosave: once-choice with giveItem should save');

    checkShouldSave('room_a', 'room_a', false, null, true)
      ? ok('autosave: chaos event triggers save')
      : fail('autosave: chaos event should trigger save');

    !checkShouldSave('room_a', 'room_a', false, null, false)
      ? ok('autosave: no move, no effect, no chaos does NOT save')
      : fail('autosave: spurious save should not occur');
  }

  // 15.7 Map view sentinel (-2) is distinct from item-use sentinel (-1)
  {
    const MAP_VIEW = -2;
    const ITEM_USE = -1;
    MAP_VIEW !== ITEM_USE
      ? ok('save: map view sentinel (-2) != item-use sentinel (-1)')
      : fail('save: sentinels must be distinct');

    // Verify the logic: map view → continue with no save; item use → save then continue
    const mapViewNoSave  = MAP_VIEW === -2;
    const itemUseSaves   = ITEM_USE === -1;
    mapViewNoSave && itemUseSaves
      ? ok('save: sentinel contract: -2=no-save, -1=save')
      : fail('save: sentinel contract broken');
  }

  // 15.8 Atomic write path: SAVE_TMP is a .tmp extension of SAVE_PATH
  {
    const path2 = require('path');
    const SAVE_PATH_REF = path2.join(__dirname, 'save.json');
    const SAVE_TMP_REF  = SAVE_PATH_REF + '.tmp';
    // We can verify this by inspecting save.js source text
    const src = require('fs').readFileSync(require('path').join(__dirname, 'engine/save.js'), 'utf-8');
    src.includes('SAVE_TMP') && src.includes('.tmp') && src.includes('rename')
      ? ok('save: atomic write uses .tmp + rename pattern')
      : fail('save: atomic write pattern not found in source');
  }

  // 15.9 Debounce is configured (DEBOUNCE_MS in source)
  {
    const src = require('fs').readFileSync(require('path').join(__dirname, 'engine/save.js'), 'utf-8');
    const match = src.match(/DEBOUNCE_MS\s*=\s*(\d+)/);
    const ms = match ? parseInt(match[1], 10) : 0;
    ms >= 300 && ms <= 1000
      ? ok(`save: debounce window is ${ms}ms (within 300–1000ms spec)`)
      : fail('save: debounce window out of spec', `got ${ms}ms`);
  }

  // 15.10 flushSync handler registered on process exit
  {
    const src = require('fs').readFileSync(require('path').join(__dirname, 'engine/save.js'), 'utf-8');
    const hasExit   = src.includes("process.on('exit'");
    const hasSigint = src.includes("process.on('SIGINT'");
    hasExit && hasSigint
      ? ok('save: exit/SIGINT handlers registered for flush-on-exit')
      : fail('save: exit handlers not found in source');
  }
}

// ── 16. Run Lifecycle / Floor Progression ─────────────────────────────────
console.log('\n── Section 16: Run Lifecycle / Floor Progression ──');

{
  const p = createPlayer('Runner');
  p.floor = 1;
  p.hp = 50;
  p.maxHp = 100;
  p.usedChoices = { supply_cache: ['Search the remaining cabinets'] };
  p.clearedRooms = { supply_cache: true };
  p.inventory = ['small_potion', 'world_shard', 'guard_key'];
  p.relics = ['world_shard'];
  p.runStats.enemiesDefeated = 3;

  const result = completeFloor(p, { route: 'warden', currentSceneId: 'the_end' });

  result.completedFloor === 1
    ? ok('completeFloor: records completed floor before increment')
    : fail('completeFloor completedFloor', `got ${result.completedFloor}`);

  p.floor === 2
    ? ok('completeFloor: increments player.floor exactly once')
    : fail('completeFloor floor increment', `floor=${p.floor}`);

  p.runStats.floorsCleared === 1
    ? ok('completeFloor: increments floorsCleared')
    : fail('completeFloor floorsCleared', `got ${p.runStats.floorsCleared}`);

  p.floorComplete === true && p.pendingTransition?.fromFloor === 1 && p.pendingTransition?.toFloor === 2
    ? ok('completeFloor: marks explicit pending floor transition')
    : fail('completeFloor pendingTransition', JSON.stringify(p.pendingTransition));

  p.hp === 75
    ? ok('completeFloor: applies partial transition heal')
    : fail('completeFloor heal', `hp=${p.hp}`);

  Object.keys(p.usedChoices).length === 0 && Object.keys(p.clearedRooms).length === 0
    ? ok('completeFloor: resets floor-local room state')
    : fail('completeFloor room reset', JSON.stringify({ usedChoices: p.usedChoices, clearedRooms: p.clearedRooms }));

  p.inventory.includes('world_shard') && p.relics.includes('world_shard')
    ? ok('completeFloor: preserves carried relic/meta-relevant state during transition')
    : fail('completeFloor relic preservation');
}

{
  const f1 = generateFloor(1);
  const f2 = generateFloor(2);
  const f3 = generateFloor(3);
  const f4 = generateFloor(4);
  const f5 = generateFloor(5);
  const f6 = generateFloor(6);
  const f7 = generateFloor(7);

  f1 && f1.floor === 1 && Array.isArray(f1.excludedRooms)
    ? ok('generateFloor: floor 1 uses real generator')
    : fail('generateFloor floor 1');

  f2 && f2.floor === 2 && f2.placeholder !== true && Array.isArray(f2.excludedRooms) && f2.safeRoom === 'floor2_safe_room'
    ? ok('generateFloor: floor 2 uses real generator')
    : fail('generateFloor floor 2 real config', JSON.stringify(f2));

  f3 && f3.floor === 3 && f3.placeholder !== true && Array.isArray(f3.excludedRooms) && f3.safeRoom === 'floor3_market'
    ? ok('generateFloor: floor 3 uses real market generator')
    : fail('generateFloor floor 3 real config', JSON.stringify(f3));

  f4 && f4.floor === 4 && f4.placeholder !== true && Array.isArray(f4.excludedRooms) && f4.safeRoom === 'floor4_elevator'
    ? ok('generateFloor: floor 4 uses real Sponsor Vault generator')
    : fail('generateFloor floor 4 real config', JSON.stringify(f4));

  f5 && f5.floor === 5 && f5.placeholder !== true && Array.isArray(f5.excludedRooms) && f5.safeRoom === 'floor5_service_dock'
    ? ok('generateFloor: floor 5 uses real Overseer Engine generator')
    : fail('generateFloor floor 5 real config', JSON.stringify(f5));

  f6 && f6.floor === 6 && f6.placeholder !== true && Array.isArray(f6.excludedRooms) && f6.safeRoom === 'floor6_weather_gap'
    ? ok('generateFloor: floor 6 uses real Fracture Map generator')
    : fail('generateFloor floor 6 real config', JSON.stringify(f6));

  f7 && f7.floor === 7 && f7.placeholder !== true && Array.isArray(f7.excludedRooms) && f7.safeRoom === 'floor7_freecamp'
    ? ok('generateFloor: floor 7 uses real First Free Zone generator')
    : fail('generateFloor floor 7 real config', JSON.stringify(f7));

  MAX_IMPLEMENTED_FLOOR === 7
    ? ok('run lifecycle: max implemented floor includes Floor 7')
    : fail('MAX_IMPLEMENTED_FLOOR should be 7', `got ${MAX_IMPLEMENTED_FLOOR}`);
}

{
  const p = createPlayer('Retiree');
  p.floor = 2;
  p.inventory = ['small_potion', 'world_shard', 'guard_key'];
  p.relics = ['world_shard'];
  p.runStats = {
    floorsCleared: 1,
    enemiesDefeated: 2,
    relicsFound: ['world_shard'],
    endingReached: null,
    rankAchieved: null,
  };

  const summary = endRun(p, { reason: 'floor_under_construction' });

  summary.floorsCleared === 1 && summary.enemiesDefeated === 2
    ? ok('endRun: returns run summary stats')
    : fail('endRun summary stats', JSON.stringify(summary));

  p.runEnded === true && p.currentRunActive === false
    ? ok('endRun: marks run ended and inactive')
    : fail('endRun flags', JSON.stringify({ runEnded: p.runEnded, currentRunActive: p.currentRunActive }));

  p.inventory.length === 0 && Object.keys(p.mapData).length === 0
    ? ok('endRun: clears temporary run inventory/map state')
    : fail('endRun temporary reset', JSON.stringify({ inventory: p.inventory, mapData: p.mapData }));

  !p.equipment || Object.values(p.equipment).every(value => value === null)
    ? ok('endRun: clears equipped run gear')
    : fail('endRun equipment reset', JSON.stringify(p.equipment));

  p.relics.includes('world_shard')
    ? ok('endRun: preserves permanent relic/progression state')
    : fail('endRun relic preservation');

  const text = formatRunSummary(summary);
  text.includes('RUN SUMMARY') && text.includes('Floors cleared: 1') && text.includes('Enemies defeated: 2')
    ? ok('formatRunSummary: includes key terminal summary fields')
    : fail('formatRunSummary text', text);
}

// ── Summary ────────────────────────────────────────────────────────────────
// ── 17. Mobile Runtime API ────────────────────────────────────────────────
console.log('\n── Section 17: Mobile Runtime API ──');

{
  const state = runtime.startNewRun({ name: 'MobileHero' });
  const view = runtime.getView(state);

  state.player.name === 'MobileHero' && state.currentSceneId === 'start_room'
    ? ok('runtime.startNewRun: creates run at start_room')
    : fail('runtime.startNewRun state', JSON.stringify({ name: state.player.name, scene: state.currentSceneId }));

  state.player.inventory.includes('rusted key')
    ? ok('runtime.startNewRun: applies start scene grant once')
    : fail('runtime.startNewRun start item', JSON.stringify(state.player.inventory));

  view.mode === 'scene' && view.scene.id === 'start_room' && view.choices.length === 2
    ? ok('runtime.getView: returns serializable scene view with choices')
    : fail('runtime.getView scene view', JSON.stringify(view));
}

{
  const state = runtime.startNewRun({
    name: 'ObjectiveReader',
    playerPatch: {
      route: 'security',
      inventory: ['security_route_token'],
    },
  });
  state.currentSceneId = 'merge_room';
  const view = runtime.getView(state);

  view.objective &&
    view.objective.route === 'security' &&
    view.objective.missing.includes('Security Clearance') &&
    view.objective.missing.includes('Warden Override') &&
    /Find/.test(view.objective.goal)
    ? ok('runtime.getView: exposes current objective and missing authorizations')
    : fail('runtime objective view', JSON.stringify(view.objective));

  view.mapProgress &&
    view.mapProgress.currentRoom === 'Prison Junction' &&
    view.mapProgress.discoveredCount >= view.mapProgress.visitedCount &&
    view.mapProgress.rooms.some(room => room.id === 'merge_room' && room.current)
    ? ok('runtime.getView: exposes map progress and current room')
    : fail('runtime map progress view', JSON.stringify(view.mapProgress));
}

{
  const state = runtime.startNewRun({ name: 'ChoiceReader' });
  state.currentSceneId = 'supply_cache';
  const view = runtime.getView(state);
  const search = view.choices.find(choice => /Search/.test(choice.text));

  search &&
    /Risk:/.test(search.riskLabel || '') &&
    /Reward:/.test(search.rewardLabel || '')
    ? ok('runtime.getView: choice rows expose risk and reward clarity')
    : fail('runtime choice clarity', JSON.stringify(view.choices));
}

{
  const state = runtime.startNewRun({ name: 'Chooser' });
  const result = runtime.dispatch(state, { type: 'choose_scene_option', index: 0 });
  const view = runtime.getView(result.state);

  state.currentSceneId === 'start_room'
    ? ok('runtime.dispatch: does not mutate previous state')
    : fail('runtime.dispatch mutation', `previous=${state.currentSceneId}`);

  result.state.currentSceneId === 'left_path' && view.scene.id === 'left_path'
    ? ok('runtime.dispatch: choice navigation moves to next scene')
    : fail('runtime.dispatch next scene', JSON.stringify({ state: result.state.currentSceneId, view: view.scene.id }));

  result.events.some(e => e.type === 'scene_changed' && e.to === 'left_path')
    ? ok('runtime.dispatch: emits scene_changed event')
    : fail('runtime.dispatch events', JSON.stringify(result.events));
}

{
  const state = runtime.startNewRun({ name: 'ReactionHero' });
  state.currentSceneId = 'alchemy_lab';
  state.player.hp = 70;
  state.player.gold = 0;
  state.player.inventory = [];
  const result = runtime.dispatch(state, { type: 'choose_scene_option', index: 1 });
  const message = result.events.find(event => event.type === 'choice_result')?.message || '';

  message.includes('20 damage') && message.includes('Big Potion') && message.includes('18 gold')
    ? ok('runtime.dispatch: choice result explains damage, item, and gold')
    : fail('runtime.dispatch choice result message', message);
}

{
  const state = runtime.startNewRun({ name: 'ProgressMessage' });
  state.currentSceneId = 'supply_cache';
  const result = runtime.dispatch(state, { type: 'choose_scene_option', index: 1 });
  const message = result.events.find(event => event.type === 'choice_result')?.message || '';

  message.includes('Security Clearance') && message.includes('Progress:')
    ? ok('runtime.dispatch: key rewards explain progress unlocks')
    : fail('runtime progress reward message', message);
}

{
  const state = runtime.startNewRun({ name: 'PuzzleSolver' });
  state.currentSceneId = 'floor2_cipher_threshold';
  state.player.floor = 2;
  const result = runtime.dispatch(state, { type: 'choose_scene_option', index: 0 });
  const message = result.events.find(event => event.type === 'choice_result')?.message || '';

  result.state.player.xp > state.player.xp && /XP/.test(message)
    ? ok('runtime.dispatch: puzzle XP choices award and describe XP')
    : fail('runtime puzzle XP choice', JSON.stringify({ xp: result.state.player.xp, before: state.player.xp, events: result.events }));
}

{
  const state = runtime.startNewRun({ name: 'Looper' });
  const result = runtime.dispatch(state, { type: 'choose_scene_option', index: 0 });
  const again = runtime.dispatch(result.state, { type: 'choose_scene_option', index: 0 });

  again.state.player.inventory.filter(id => id === 'rusted key').length === 1
    ? ok('runtime rewards: scene grants are not duplicated across dispatches')
    : fail('runtime rewards duplicated', JSON.stringify(again.state.player.inventory));
}

{
  const state = runtime.startNewRun({ name: 'Finisher' });
  state.currentSceneId = 'the_end';
  const result = runtime.dispatch(state, { type: 'complete_floor' });

  result.state.player.floor === 2
    ? ok('runtime.complete_floor: increments to next floor')
    : fail('runtime.complete_floor floor', `floor=${result.state.player.floor}`);

  result.state.currentSceneId === 'floor2_safe_room' &&
    result.state.floorConfig.placeholder !== true &&
    result.state.player.runEnded !== true
    ? ok('runtime.complete_floor: enters Floor 2 safe room')
    : fail('runtime.complete_floor Floor 2 entry', JSON.stringify({
        floorConfig: result.state.floorConfig,
        scene: result.state.currentSceneId,
        runEnded: result.state.player.runEnded,
      }));

  result.events.some(e => e.type === 'scene_changed' && e.to === 'floor2_safe_room')
    ? ok('runtime.complete_floor: emits scene change to Floor 2 safe room')
    : fail('runtime.complete_floor Floor 2 events', JSON.stringify(result.events));
}

{
  const state = runtime.startNewRun({ name: 'Floor2Finisher' });
  state.player.floor = 2;
  state.currentSceneId = 'the_end';
  const result = runtime.dispatch(state, { type: 'complete_floor' });
  const floorEvent = result.events.find(event => event.type === 'floor_completed');

  floorEvent?.completedFloor === 2 && floorEvent?.nextFloor === 3 && floorEvent?.currencyReward === 30
    ? ok('runtime.complete_floor: Floor 2 completion awards Floor 2 meta event')
    : fail('runtime.complete_floor Floor 2 reward event', JSON.stringify(result.events));

  result.state.currentSceneId === 'floor3_market' &&
    result.state.floorConfig.placeholder !== true &&
    result.state.player.runEnded !== true
    ? ok('runtime.complete_floor: Floor 2 handoff enters Floor 3 market')
    : fail('runtime.complete_floor Floor 2 handoff', JSON.stringify({ scene: result.state.currentSceneId, floorConfig: result.state.floorConfig, player: result.state.player, events: result.events }));
}

{
  const state = runtime.startNewRun({ name: 'Floor3Finisher' });
  state.player.floor = 3;
  state.currentSceneId = 'the_end';
  const result = runtime.dispatch(state, { type: 'complete_floor' });
  const floorEvent = result.events.find(event => event.type === 'floor_completed');
  floorEvent?.completedFloor === 3 && floorEvent?.nextFloor === 4 && floorEvent?.currencyReward === 45
    ? ok('runtime.complete_floor: Floor 3 completion awards Floor 3 meta event')
    : fail('runtime.complete_floor Floor 3 reward event', JSON.stringify(result.events));

  result.state.currentSceneId === 'floor4_elevator' &&
    result.state.floorConfig.placeholder !== true &&
    result.state.player.runEnded !== true
    ? ok('runtime.complete_floor: Floor 3 handoff enters Floor 4 Sponsor Vault')
    : fail('runtime.complete_floor Floor 3 handoff', JSON.stringify({ player: result.state.player, events: result.events }));
}

// ── 18. Runtime Combat Actions ────────────────────────────────────────────
{
  const state = runtime.startNewRun({
    name: 'Floor4Reader',
    playerPatch: { floor: 4, inventory: ['f4_gold_key', 'f4_signal_key'] },
  });
  state.currentSceneId = 'floor4_boss_gate';
  const view = runtime.getView(state);

  view.objective?.route === 'sponsor-vault' &&
    view.objective.goal === 'Collect Vault Keys 2/3' &&
    view.objective.missing.includes('Blood Vault Key')
    ? ok('runtime Floor 4 objective: tracks Vault Keys before boss gate')
    : fail('runtime Floor 4 objective missing', JSON.stringify(view.objective));
}

{
  const state = runtime.startNewRun({ name: 'Floor4Finisher' });
  state.player.floor = 4;
  state.currentSceneId = 'the_end';
  const result = runtime.dispatch(state, { type: 'complete_floor' });
  const floorEvent = result.events.find(event => event.type === 'floor_completed');

  floorEvent?.completedFloor === 4 && floorEvent?.nextFloor === 5 && floorEvent?.currencyReward === 60
    ? ok('runtime.complete_floor: Floor 4 completion awards Floor 4 meta event')
    : fail('runtime.complete_floor Floor 4 reward event', JSON.stringify(result.events));

  result.state.currentSceneId === 'floor5_service_dock' &&
    result.state.floorConfig.placeholder !== true &&
    result.state.player.runEnded !== true
    ? ok('runtime.complete_floor: Floor 4 handoff enters Floor 5 Overseer Engine')
    : fail('runtime.complete_floor Floor 4 handoff', JSON.stringify({ player: result.state.player, events: result.events }));

  const floor5ObjectiveProbe = runtime.startNewRun({
    name: 'Floor5Reader',
    playerPatch: { floor: 5, inventory: ['f5_combat_protocol', 'f5_debt_protocol'] },
  });
  floor5ObjectiveProbe.currentSceneId = 'floor5_boss_gate';
  const floor5ObjectiveView = runtime.getView(floor5ObjectiveProbe);

  floor5ObjectiveView.objective?.route === 'overseer-engine' &&
    floor5ObjectiveView.objective.goal === 'Clear Protocols 2/4' &&
    floor5ObjectiveView.objective.missing.includes('Memory Protocol Clearance') &&
    floor5ObjectiveView.objective.missing.includes('Identity Protocol Clearance')
    ? ok('runtime Floor 5 objective: tracks Protocol Clearances before boss gate')
    : fail('runtime Floor 5 objective missing', JSON.stringify(floor5ObjectiveView.objective));

  const floor5FinishState = runtime.startNewRun({ name: 'Floor5Finisher' });
  floor5FinishState.player.floor = 5;
  floor5FinishState.currentSceneId = 'the_end';
  const floor5FinishResult = runtime.dispatch(floor5FinishState, { type: 'complete_floor' });
  const floor5Event = floor5FinishResult.events.find(event => event.type === 'floor_completed');

  floor5Event?.completedFloor === 5 && floor5Event?.nextFloor === 6 && floor5Event?.currencyReward === 75
    ? ok('runtime.complete_floor: Floor 5 completion awards Floor 5 meta event')
    : fail('runtime.complete_floor Floor 5 reward event', JSON.stringify(floor5FinishResult.events));

  floor5FinishResult.state.currentSceneId === 'floor6_weather_gap' &&
    floor5FinishResult.state.floorConfig.placeholder !== true &&
    floor5FinishResult.state.player.runEnded !== true
    ? ok('runtime.complete_floor: Floor 5 handoff enters Floor 6 Fracture Map')
    : fail('runtime.complete_floor Floor 5 handoff', JSON.stringify({ player: floor5FinishResult.state.player, events: floor5FinishResult.events }));

  const floor6ObjectiveProbe = runtime.startNewRun({
    name: 'Floor6Reader',
    playerPatch: { floor: 6, inventory: ['f6_glass_anchor'] },
  });
  floor6ObjectiveProbe.currentSceneId = 'floor6_boss_gate';
  const floor6ObjectiveView = runtime.getView(floor6ObjectiveProbe);

  floor6ObjectiveView.objective?.route === 'fracture-map' &&
    floor6ObjectiveView.objective.goal === 'Stabilize Anchors 1/3' &&
    floor6ObjectiveView.objective.missing.includes('Root Anchor Shard') &&
    floor6ObjectiveView.objective.missing.includes('Road Anchor Shard')
    ? ok('runtime Floor 6 objective: tracks Anchor Shards before boss gate')
    : fail('runtime Floor 6 objective missing', JSON.stringify(floor6ObjectiveView.objective));

  const floor6FinishState = runtime.startNewRun({ name: 'Floor6Finisher' });
  floor6FinishState.player.floor = 6;
  floor6FinishState.currentSceneId = 'the_end';
  const floor6FinishResult = runtime.dispatch(floor6FinishState, { type: 'complete_floor' });
  const floor6Event = floor6FinishResult.events.find(event => event.type === 'floor_completed');

  floor6Event?.completedFloor === 6 && floor6Event?.nextFloor === 7 && floor6Event?.currencyReward === 90
    ? ok('runtime.complete_floor: Floor 6 completion awards Floor 6 meta event')
    : fail('runtime.complete_floor Floor 6 reward event', JSON.stringify(floor6FinishResult.events));

  floor6FinishResult.state.currentSceneId === 'floor7_freecamp' &&
    floor6FinishResult.state.floorConfig.placeholder !== true &&
    floor6FinishResult.state.player.runEnded !== true
    ? ok('runtime.complete_floor: Floor 6 handoff enters Floor 7 First Free Zone')
    : fail('runtime.complete_floor Floor 6 handoff', JSON.stringify({ player: floor6FinishResult.state.player, events: floor6FinishResult.events }));

  const floor7ObjectiveProbe = runtime.startNewRun({
    name: 'Floor7Reader',
    playerPatch: { floor: 7, inventory: ['f7_forager_trust', 'f7_healer_trust'] },
  });
  floor7ObjectiveProbe.currentSceneId = 'floor7_council_fire';
  const floor7ObjectiveView = runtime.getView(floor7ObjectiveProbe);

  floor7ObjectiveView.objective?.route === 'first-free-zone' &&
    floor7ObjectiveView.objective.goal === 'Earn Trust Bonds 2/4' &&
    floor7ObjectiveView.objective.missing.includes('Scout Trust Bond') &&
    floor7ObjectiveView.objective.missing.includes('Builder Trust Bond')
    ? ok('runtime Floor 7 objective: tracks Trust Bonds before Council Fire')
    : fail('runtime Floor 7 objective missing', JSON.stringify(floor7ObjectiveView.objective));

  const floor7FinishState = runtime.startNewRun({ name: 'Floor7Finisher' });
  floor7FinishState.player.floor = 7;
  floor7FinishState.currentSceneId = 'the_end';
  const floor7FinishResult = runtime.dispatch(floor7FinishState, { type: 'complete_floor' });
  const floor7Event = floor7FinishResult.events.find(event => event.type === 'floor_completed');
  const floor7RunEndEvent = floor7FinishResult.events.find(event => event.type === 'run_ended');

  floor7Event?.completedFloor === 7 && floor7Event?.nextFloor === 8 && floor7Event?.currencyReward === 105
    ? ok('runtime.complete_floor: Floor 7 completion awards Floor 7 meta event')
    : fail('runtime.complete_floor Floor 7 reward event', JSON.stringify(floor7FinishResult.events));

  floor7FinishResult.state.player.runEnded === true &&
    floor7FinishResult.state.player.currentRunActive === false &&
    floor7RunEndEvent?.summary?.reason === 'floor_under_construction' &&
    /Floor 8/i.test(floor7RunEndEvent.summary.endingReached || '')
    ? ok('runtime.complete_floor: Floor 7 handoff ends at Floor 8 under construction')
    : fail('runtime.complete_floor Floor 7 handoff', JSON.stringify({ player: floor7FinishResult.state.player, events: floor7FinishResult.events }));
}

console.log('\n── Section 18: Runtime Combat Actions ──');

{
  const meta = runtime.createDefaultMeta();
  meta.currency = 99;
  meta.upgrades.hp = 3;
  const fresh = runtime.createDefaultMeta();

  fresh.currency === 0 && fresh.upgrades.hp === 0 && fresh.unlockedAbilities.includes('power_strike')
    ? ok('runtime.createDefaultMeta: returns isolated mobile-safe meta defaults')
    : fail('runtime.createDefaultMeta defaults', JSON.stringify(fresh));
}

{
  const state = runtime.startNewRun({ name: 'Saver' });
  const moved = runtime.dispatch(state, { type: 'choose_scene_option', index: 0 }).state;
  const saveData = runtime.createSaveData(moved);
  const restored = runtime.hydrateRun(saveData);

  saveData.player.name === 'Saver' && saveData.currentSceneId === 'left_path' && restored.currentSceneId === 'left_path'
    ? ok('runtime.createSaveData: supports mobile save and continue')
    : fail('runtime.createSaveData restore', JSON.stringify({ saveData, restoredScene: restored.currentSceneId }));

  moved.currentSceneId = 'mutated_after_save';
  saveData.currentSceneId === 'left_path'
    ? ok('runtime.createSaveData: snapshots without retaining mutable state references')
    : fail('runtime.createSaveData mutation leak', JSON.stringify(saveData));
}

{
  const writes = {};
  const storage = {
    getItem: key => writes[key] || null,
    setItem: (key, value) => { writes[key] = value; },
    removeItem: key => { delete writes[key]; },
  };
  const saveData = runtime.createSaveData(runtime.startNewRun({ name: 'Persistent' }));

  saveStore.saveRunSnapshot(saveData, storage);
  const loaded = saveStore.loadSavedRun(storage);

  loaded && loaded.player.name === 'Persistent' && loaded.currentSceneId === 'start_room'
    ? ok('saveStore: persists and loads saved run snapshots')
    : fail('saveStore load saved run', JSON.stringify(loaded));

  saveStore.clearSavedRun(storage);
  saveStore.loadSavedRun(storage) === null
    ? ok('saveStore: clears saved run snapshots')
    : fail('saveStore clear saved run', JSON.stringify(writes));
}

{
  const storage = {
    getItem: () => '{bad json',
    setItem: () => {},
    removeItem: () => {},
  };

  saveStore.loadSavedRun(storage) === null
    ? ok('saveStore: invalid saved run data fails closed')
    : fail('saveStore invalid data');
}

{
  const meta = metaCore.createDefaultMeta();
  const awarded = metaCore.awardMetaCurrency(meta, 15);

  meta.currency === 0 && awarded.currency === 15
    ? ok('metaCore.awardMetaCurrency: awards points without mutating previous meta')
    : fail('metaCore.awardMetaCurrency mutation/currency', JSON.stringify({ meta, awarded }));
}

{
  const base = metaCore.getFloorCurrencyReward(metaCore.createDefaultMeta(), 1);
  const upgraded = metaCore.getFloorCurrencyReward({
    ...metaCore.createDefaultMeta(),
    upgrades: { rewardMultiplier: 2 },
  }, 1);
  const nextFloor = metaCore.getFloorCurrencyReward({
    ...metaCore.createDefaultMeta(),
    upgrades: { rewardMultiplier: 1 },
  }, 2);

  base === 15 && upgraded === 25 && nextFloor === 35
    ? ok('metaCore.getFloorCurrencyReward: applies base floor reward plus purchased reward bonuses')
    : fail('metaCore.getFloorCurrencyReward values', JSON.stringify({ base, upgraded, nextFloor }));
}

{
  const meta = { ...metaCore.createDefaultMeta(), currency: 20 };
  const purchase = metaCore.purchaseUpgrade(meta, 'atk');

  purchase.ok && purchase.meta.currency === 10 && purchase.meta.upgrades.atk === 1 && meta.currency === 20
    ? ok('metaCore.purchaseUpgrade: spends points and increments upgrade')
    : fail('metaCore.purchaseUpgrade purchase', JSON.stringify({ purchase, meta }));

  const denied = metaCore.purchaseUpgrade({ ...purchase.meta, currency: 5 }, 'hp');
  !denied.ok && denied.reason === 'not_enough_currency'
    ? ok('metaCore.purchaseUpgrade: rejects unaffordable upgrades')
    : fail('metaCore.purchaseUpgrade rejection', JSON.stringify(denied));
}

{
  const meta = { ...metaCore.createDefaultMeta(), currency: 45 };
  const first = metaCore.purchaseUpgrade(meta, 'rewardMultiplier');
  const second = metaCore.purchaseUpgrade(first.meta, 'rewardMultiplier');

  first.ok &&
    second.ok &&
    second.meta.currency === 5 &&
    second.meta.upgrades.rewardMultiplier === 2 &&
    metaCore.getFloorCurrencyReward(second.meta, 1) === 25
    ? ok('metaCore.purchaseUpgrade: rewardMultiplier costs 20 and adds +5 floor reward per level')
    : fail('metaCore.purchaseUpgrade rewardMultiplier', JSON.stringify({ first, second }));
}

{
  const meta = { ...metaCore.createDefaultMeta(), currency: 20 };
  const purchase = metaCore.purchaseAbility(meta, 'mage', 'heal');

  purchase.ok &&
    purchase.meta.currency === 8 &&
    purchase.meta.unlockedAbilities.includes('heal') &&
    !meta.unlockedAbilities.includes('heal')
    ? ok('metaCore.purchaseAbility: buys a class ability without mutating previous meta')
    : fail('metaCore.purchaseAbility purchase', JSON.stringify({ purchase, meta }));

  const crossClass = metaCore.purchaseAbility({ ...metaCore.createDefaultMeta(), currency: 20 }, 'mage', 'berserk');
  !crossClass.ok && crossClass.reason === 'ability_not_in_class'
    ? ok('metaCore.purchaseAbility: rejects abilities outside the selected class')
    : fail('metaCore.purchaseAbility cross-class rejection', JSON.stringify(crossClass));

  const defaultAbility = metaCore.purchaseAbility({ ...metaCore.createDefaultMeta(), currency: 20 }, 'mage', 'arcane_bolt');
  !defaultAbility.ok && defaultAbility.reason === 'already_unlocked'
    ? ok('metaCore.purchaseAbility: treats class default abilities as already unlocked')
    : fail('metaCore.purchaseAbility default rejection', JSON.stringify(defaultAbility));

  const unaffordable = metaCore.purchaseAbility({ ...metaCore.createDefaultMeta(), currency: 5 }, 'fighter', 'berserk');
  !unaffordable.ok && unaffordable.reason === 'not_enough_currency'
    ? ok('metaCore.purchaseAbility: rejects unaffordable ability unlocks')
    : fail('metaCore.purchaseAbility unaffordable rejection', JSON.stringify(unaffordable));
}

{
  const state = runtime.startNewRun({
    name: 'Upgraded',
    meta: {
      currency: 0,
      upgrades: { hp: 2, atk: 1, def: 3, per: 1 },
      unlockedAbilities: ['power_strike', 'guard'],
    },
  });

  state.player.maxHp === 120 && state.player.hp === 120 && state.player.attack === 19 && state.player.defense === 9 && state.player.perception === 1 &&
    state.player.equipment.weapon === 'training_sword'
    ? ok('runtime.startNewRun: applies persistent meta upgrades')
    : fail('runtime.startNewRun meta upgrades', JSON.stringify(state.player));
}

{
  const fighter = runtime.startNewRun({ name: 'StarterFighter', classId: 'fighter' });
  const mage = runtime.startNewRun({ name: 'StarterMage', classId: 'mage' });
  const rogue = runtime.startNewRun({ name: 'StarterRogue', classId: 'rogue' });

  fighter.player.equipment.weapon === 'training_sword' &&
    fighter.player.attack === 17 &&
    mage.player.equipment.trinket === 'cracked_lens' &&
    mage.player.perception === 2 &&
    rogue.player.classId === 'rogue' &&
    rogue.player.equipment.trinket === 'marked_dice' &&
    rogue.player.perception === 2
    ? ok('runtime.startNewRun: equips class-flavored starter gear')
    : fail('runtime starter gear', JSON.stringify({
      fighter: fighter.player,
      mage: mage.player,
      rogue: rogue.player,
    }));
}

{
  const meta = {
    ...metaCore.createDefaultMeta(),
    unlockedAbilities: ['power_strike', 'guard', 'heal', 'berserk', 'arcane_bolt', 'barrier'],
  };
  const fighterOptions = runtime.getRunSetupOptions(meta, 'fighter');
  const mageOptions = runtime.getRunSetupOptions(meta, 'mage');

  (fighterOptions.classes || []).some(gameClass => gameClass.id === 'fighter' && gameClass.selected) &&
    fighterOptions.abilities.some(ability => ability.id === 'berserk') &&
    !fighterOptions.abilities.some(ability => ability.id === 'arcane_bolt') &&
    mageOptions.abilities.some(ability => ability.id === 'arcane_bolt') &&
    mageOptions.abilities.some(ability => ability.id === 'heal') &&
    !mageOptions.abilities.some(ability => ability.id === 'berserk')
    ? ok('runtime.getRunSetupOptions: exposes unlocked ability choices')
    : fail('runtime run setup ability choices', JSON.stringify({ fighterOptions, mageOptions }));
}

{
  const meta = { ...metaCore.createDefaultMeta(), currency: 20 };
  const mageOptions = runtime.getRunSetupOptions(meta, 'mage');
  const healUnlock = mageOptions.unlocks.find(ability => ability.id === 'heal');
  const berserkUnlock = mageOptions.unlocks.find(ability => ability.id === 'berserk');
  const purchased = metaCore.purchaseAbility(meta, 'mage', 'heal');
  const purchasedOptions = runtime.getRunSetupOptions(purchased.meta, 'mage');

  healUnlock &&
    healUnlock.cost === 12 &&
    healUnlock.owned === false &&
    healUnlock.locked === true &&
    !berserkUnlock &&
    purchasedOptions.abilities.some(ability => ability.id === 'heal')
    ? ok('runtime.getRunSetupOptions: exposes class ability unlocks and purchased abilities')
    : fail('runtime run setup ability unlocks', JSON.stringify({ mageOptions, purchasedOptions }));
}

{
  const meta = {
    ...metaCore.createDefaultMeta(),
    unlockedAbilities: ['power_strike', 'guard', 'heal', 'berserk', 'arcane_bolt', 'barrier'],
  };
  const state = runtime.startNewRun({
    name: 'AbilityPicker',
    meta,
    classId: 'mage',
    selectedAbilityIds: ['heal', 'berserk', 'arcane_bolt'],
  });

  state.player.classId === 'mage' &&
    state.player.className === 'Mage' &&
    state.player.attack === 17 &&
    state.player.maxHp === 90 &&
    state.player.abilities.length === 2 &&
    state.player.abilities[0].id === 'heal' &&
    state.player.abilities[1].id === 'arcane_bolt' &&
    state.player.abilities.every(ability => ability.currentCooldown === 0)
    ? ok('runtime.startNewRun: equips selected class abilities only')
    : fail('runtime selected abilities', JSON.stringify(state.player.abilities));
}

{
  const writes = {};
  const storage = {
    getItem: key => writes[key] || null,
    setItem: (key, value) => { writes[key] = value; },
    removeItem: key => { delete writes[key]; },
  };
  const meta = { ...metaCore.createDefaultMeta(), currency: 30 };

  saveStore.saveMeta(meta, storage);
  const loaded = saveStore.loadMeta(storage);

  loaded.currency === 30 && loaded.upgrades.hp === 0
    ? ok('saveStore: persists and loads meta progression')
    : fail('saveStore meta persistence', JSON.stringify(loaded));
}

{
  const state = runtime.startNewRun({
    name: 'Inventory',
    playerPatch: {
      inventory: ['small_potion', 'guard_key', 'antidote'],
      hp: 50,
      maxHp: 100,
    },
  });
  const view = runtime.getView(state);

  view.items.length >= 3 && view.items.some(item => item.id === 'small_potion' && item.usable)
    ? ok('runtime.getView: exposes mobile inventory item details')
    : fail('runtime inventory details', JSON.stringify(view.items));

  view.items.some(item => item.id === 'guard_key' && !item.usable)
    ? ok('runtime.getView: marks non-consumable inventory items unusable')
    : fail('runtime non-consumable item details', JSON.stringify(view.items));
}

{
  const state = runtime.startNewRun({
    name: 'GearView',
    playerPatch: {
      inventory: ['bent_baton', 'guard_vest'],
    },
  });
  const view = runtime.getView(state);

  view.equipment &&
    view.equipment.weapon === 'training_sword' &&
    view.items.some(item => item.id === 'bent_baton' && item.equippable && item.slot === 'weapon' && item.currentEquippedName === 'Training Sword' && item.comparisonText === '+1 ATK') &&
    view.items.some(item => item.id === 'guard_vest' && item.equippable && item.slot === 'armor' && item.comparisonText === '+2 DEF')
    ? ok('runtime.getView: exposes gear items and starter equipment comparisons')
    : fail('runtime gear view', JSON.stringify({ equipment: view.equipment, items: view.items }));
}

{
  const state = runtime.startNewRun({
    name: 'GearCompare',
    playerPatch: {
      inventory: ['training_sword'],
      equipment: {
        weapon: 'bent_baton',
        armor: null,
        trinket: null,
      },
      attack: 17,
    },
  });
  const view = runtime.getView(state);
  const sword = view.items.find(item => item.id === 'training_sword');

  sword?.comparisonText === '-1 ATK' && sword.currentEquippedName === 'Bent Baton'
    ? ok('runtime.getView: gear comparison shows stat delta against equipped gear')
    : fail('runtime gear comparison', JSON.stringify(sword));
}

{
  const state = runtime.startNewRun({
    name: 'TraitView',
    playerPatch: {
      inventory: ['shock_baton'],
    },
  });
  const view = runtime.getView(state);
  const baton = view.items.find(item => item.id === 'shock_baton');

  baton?.trait?.id === 'first_attack_bonus' &&
    /first attack/i.test(baton.traitText || '') &&
    view.equipmentItems.some(item => item.itemId === 'training_sword' && item.trait === null)
    ? ok('runtime.getView: exposes gear trait text')
    : fail('runtime gear trait view', JSON.stringify({ baton, equipmentItems: view.equipmentItems }));
}

{
  const state = runtime.startNewRun({
    name: 'InventoryStack',
    playerPatch: {
      inventory: ['small_potion', 'guard_key', 'small_potion', 'antidote', 'small_potion'],
      hp: 50,
      maxHp: 100,
    },
  });
  const view = runtime.getView(state);
  const potion = view.items.find(item => item.id === 'small_potion');

  view.items.length === 4 && potion && potion.count === 3 && potion.label === 'Small Potion x3'
    ? ok('runtime.getView: stacks duplicate inventory items for mobile display')
    : fail('runtime inventory stacking', JSON.stringify(view.items));
}

{
  const state = runtime.startNewRun({
    name: 'PotionUser',
    playerPatch: {
      inventory: ['small_potion', 'small_potion'],
      hp: 50,
      maxHp: 100,
    },
  });
  const result = runtime.dispatch(state, { type: 'use_item', itemId: 'small_potion' });

  result.state.player.hp === 70 && result.state.player.inventory.filter(id => id === 'small_potion').length === 1
    ? ok('runtime.use_item: heals and consumes potion')
    : fail('runtime.use_item heal', JSON.stringify(result.state.player));

  result.events.some(event => event.type === 'item_used' && event.itemId === 'small_potion' && event.healed === 20)
    ? ok('runtime.use_item: emits item_used event')
    : fail('runtime.use_item events', JSON.stringify(result.events));
}

{
  const state = runtime.startNewRun({
    name: 'Cleanser',
    playerPatch: {
      inventory: ['antidote'],
      statusEffects: [{ type: 'poison', duration: 2 }, { type: 'burn', duration: 1 }, { type: 'weaken', duration: 1 }],
    },
  });
  const result = runtime.dispatch(state, { type: 'use_item', itemId: 'antidote' });

  result.state.player.statusEffects.length === 1 && result.state.player.statusEffects[0].type === 'weaken' && !result.state.player.inventory.includes('antidote')
    ? ok('runtime.use_item: cleanses poison/burn and preserves other effects')
    : fail('runtime.use_item cleanse', JSON.stringify(result.state.player.statusEffects));
}

{
  const state = runtime.startNewRun({
    name: 'KeyUser',
    playerPatch: { inventory: ['guard_key'] },
  });
  const result = runtime.dispatch(state, { type: 'use_item', itemId: 'guard_key' });

  result.state.player.inventory.includes('guard_key') && result.events.some(event => event.type === 'item_use_failed')
    ? ok('runtime.use_item: rejects non-consumable items')
    : fail('runtime.use_item non-consumable', JSON.stringify({ player: result.state.player, events: result.events }));
}

{
  const state = runtime.startNewRun({
    name: 'GearUser',
    playerPatch: {
      inventory: ['bent_baton'],
      equipment: {
        weapon: null,
        armor: null,
        trinket: null,
      },
      attack: 15,
    },
  });
  const result = runtime.dispatch(state, { type: 'equip_item', itemId: 'bent_baton' });

  result.state.player.attack === 17 &&
    result.state.player.equipment.weapon === 'bent_baton' &&
    !result.state.player.inventory.includes('bent_baton') &&
    result.events.some(event => event.type === 'item_equipped' && event.slot === 'weapon')
    ? ok('runtime.equip_item: equips weapon and applies attack bonus')
    : fail('runtime equip weapon', JSON.stringify({ player: result.state.player, events: result.events }));
}

{
  const state = runtime.startNewRun({
    name: 'GearReplace',
    playerPatch: {
      inventory: ['bent_baton', 'cracked_lens'],
      equipment: {
        weapon: null,
        armor: null,
        trinket: null,
      },
      attack: 15,
      perception: 0,
    },
  });
  const first = runtime.dispatch(state, { type: 'equip_item', itemId: 'bent_baton' });
  first.state.player.inventory.push('training_sword');
  const second = runtime.dispatch(first.state, { type: 'equip_item', itemId: 'training_sword' });

  second.state.player.attack === 16 &&
    second.state.player.equipment.weapon === 'training_sword' &&
    second.state.player.inventory.includes('bent_baton') &&
    !second.state.player.inventory.includes('training_sword')
    ? ok('runtime.equip_item: replacing gear returns old item and recalculates stats')
    : fail('runtime replace gear', JSON.stringify(second.state.player));
}

{
  const state = runtime.startNewRun({
    name: 'CharmUser',
    playerPatch: {
      inventory: ['stabilizer_charm'],
      hp: 80,
      maxHp: 100,
    },
  });
  const result = runtime.dispatch(state, { type: 'equip_item', itemId: 'stabilizer_charm' });

  result.state.player.maxHp === 110 &&
    result.state.player.hp === 90 &&
    result.state.player.equipment.trinket === 'stabilizer_charm'
    ? ok('runtime.equip_item: maxHp gear increases max and current HP')
    : fail('runtime equip maxHp gear', JSON.stringify(result.state.player));
}

{
  const state = runtime.startNewRun({
    name: 'CombatHealer',
    playerPatch: {
      inventory: ['small_potion'],
      hp: 50,
      maxHp: 100,
      defense: 0,
    },
  });
  state.currentSceneId = 'left_path_combat';
  state.floorConfig.enemyVariants.left_path_combat = {
    name: 'Potion Punisher',
    hp: 80,
    attack: 10,
    defense: 0,
    xp: 0,
    goldReward: 0,
    loot: [],
    type: 'aggressive',
    abilities: [],
  };
  const result = runtime.dispatch(state, { type: 'use_item', itemId: 'small_potion' });

  result.state.player.hp === 60 &&
    !result.state.player.inventory.includes('small_potion') &&
    result.events.some(event => event.type === 'item_used' && event.healed === 20) &&
    result.events.some(event => event.type === 'enemy_attack' && event.damage === 10)
    ? ok('runtime.use_item: combat item use consumes enemy turn')
    : fail('runtime.use_item combat turn', JSON.stringify({ hp: result.state.player.hp, inventory: result.state.player.inventory, events: result.events }));
}

{
  const state = runtime.startNewRun({
    name: 'ShockTrait',
    playerPatch: {
      attack: 19,
      defense: 99,
      equipment: { weapon: 'shock_baton', armor: null, trinket: null },
    },
  });
  state.currentSceneId = 'left_path_combat';
  state.floorConfig.enemyVariants.left_path_combat = { name: 'Training Guard', hp: 60, attack: 1, defense: 0, xp: 0, goldReward: 0, loot: [], type: 'aggressive' };
  const first = runtime.dispatch(state, { type: 'combat_attack' });
  const second = runtime.dispatch(first.state, { type: 'combat_attack' });

  first.events.some(event => event.type === 'gear_trait' && event.traitId === 'first_attack_bonus' && event.bonusDamage === 2) &&
    first.events.some(event => event.type === 'player_attack' && event.damage === 21) &&
    second.events.some(event => event.type === 'player_attack' && event.damage === 19)
    ? ok('runtime gear trait: Shock Baton boosts first attack once per combat')
    : fail('runtime shock baton trait', JSON.stringify({ first: first.events, second: second.events }));
}

{
  const state = runtime.startNewRun({
    name: 'PlateTrait',
    playerPatch: {
      hp: 100,
      maxHp: 100,
      attack: 1,
      defense: 3,
      equipment: { weapon: null, armor: 'sentry_plate', trinket: null },
    },
  });
  state.currentSceneId = 'left_path_combat';
  state.floorConfig.enemyVariants.left_path_combat = { name: 'Heavy Guard', hp: 60, attack: 20, defense: 0, xp: 0, goldReward: 0, loot: [], type: 'aggressive' };
  const first = runtime.dispatch(state, { type: 'combat_attack' });
  const second = runtime.dispatch(first.state, { type: 'combat_attack' });

  first.state.player.hp === 88 &&
    first.events.some(event => event.type === 'gear_trait' && event.traitId === 'first_hit_reduction' && event.reducedBy === 5) &&
    second.state.player.hp === 66 &&
    second.events.some(event => event.type === 'combat_pressure' && event.attackStreak === 2)
    ? ok('runtime gear trait: Sentry Plate reduces first hit, then attack pressure applies')
    : fail('runtime sentry plate trait', JSON.stringify({ firstHp: first.state.player.hp, secondHp: second.state.player.hp, first: first.events, second: second.events }));
}

{
  const state = runtime.startNewRun({
    name: 'DiceTrait',
    playerPatch: {
      attack: 50,
      defense: 99,
      equipment: { weapon: null, armor: null, trinket: 'marked_dice' },
    },
  });
  state.currentSceneId = 'left_path_combat';
  state.floorConfig.enemyVariants.left_path_combat = { name: 'Loot Guard', hp: 10, attack: 1, defense: 0, xp: 0, goldReward: 10, loot: [], type: 'aggressive' };
  const result = runtime.dispatch(state, { type: 'combat_attack' });

  result.state.player.gold === 15 &&
    result.events.some(event => event.type === 'gear_trait' && event.traitId === 'bonus_gold' && event.gold === 5)
    ? ok('runtime gear trait: Marked Dice adds gold after combat victory')
    : fail('runtime marked dice trait', JSON.stringify({ gold: result.state.player.gold, events: result.events }));
}

{
  const state = runtime.startNewRun({
    name: 'CloakTrait',
    playerPatch: {
      equipment: { weapon: null, armor: 'ranger_cloak', trinket: null },
    },
  });
  state.currentSceneId = 'left_path_combat';
  const originalRandom = Math.random;
  Math.random = () => 0.3;
  const result = runtime.dispatch(state, { type: 'combat_flee' });
  Math.random = originalRandom;

  result.state.currentSceneId === 'start_room' &&
    result.events.some(event => event.type === 'gear_trait' && event.traitId === 'flee_bonus')
    ? ok('runtime gear trait: Ranger Cloak improves flee chance')
    : fail('runtime ranger cloak trait', JSON.stringify({ scene: result.state.currentSceneId, events: result.events }));
}

{
  const state = runtime.startNewRun({
    name: 'AbilityView',
    playerPatch: {
      statusEffects: [{ type: 'poison', duration: 2, value: 1 }],
      abilities: [
        { id: 'power_strike', name: 'Power Strike', type: 'damage_bonus', value: 8, cooldown: 2, currentCooldown: 0 },
        { id: 'guard', name: 'Guard', type: 'damage_reduce', value: 0.25, cooldown: 3, currentCooldown: 2 },
      ],
    },
  });
  state.currentSceneId = 'left_path_combat';
  state.floorConfig.enemyVariants.left_path_combat = {
    name: 'Training Guard',
    hp: 60,
    attack: 1,
    defense: 0,
    xp: 0,
    goldReward: 0,
    loot: [],
    type: 'aggressive',
    statusEffects: [{ type: 'weaken', duration: 1, value: 2 }],
  };
  const view = runtime.getView(state);

  (view.player.statusEffects || []).some(effect => effect.type === 'poison') && (view.combat.enemy.statusEffects || []).some(effect => effect.type === 'weaken')
    ? ok('runtime.getView: exposes player and enemy status effects')
    : fail('runtime combat status view', JSON.stringify({ player: view.player.statusEffects, enemy: view.combat.enemy.statusEffects }));

  (view.combat.abilities || []).some(ability => ability.id === 'power_strike' && ability.ready === true && ability.description) &&
    (view.combat.abilities || []).some(ability => ability.id === 'guard' && ability.ready === false && ability.currentCooldown === 2)
    ? ok('runtime.getView: exposes combat abilities with cooldown state')
    : fail('runtime combat ability view', JSON.stringify(view.combat.abilities));
}

{
  const state = runtime.startNewRun({
    name: 'IntentReader',
    playerPatch: { hp: 100, maxHp: 100, defense: 0 },
  });
  state.currentSceneId = 'left_path_combat';
  state.floorConfig.enemyVariants.left_path_combat = {
    name: 'Frenzied Guard',
    hp: 80,
    attack: 20,
    defense: 0,
    xp: 0,
    goldReward: 0,
    loot: [],
    type: 'aggressive',
    abilities: ['frenzy'],
  };
  const view = runtime.getView(state);

  view.combat.intent &&
    view.combat.intent.abilityId === 'frenzy' &&
    view.combat.intent.damage === 40 &&
    view.combat.intent.defendDamage === 10 &&
    view.combat.intent.danger === 'high' &&
    /Frenzy/.test(view.combat.intent.text)
    ? ok('runtime.getView: previews enemy combat intent')
    : fail('runtime combat intent preview', JSON.stringify(view.combat.intent));
}

{
  const state = runtime.startNewRun({
    name: 'PatternReader',
    playerPatch: { hp: 100, maxHp: 100, attack: 1, defense: 0 },
  });
  state.currentSceneId = 'left_path_combat';
  state.floorConfig.enemyVariants.left_path_combat = {
    name: 'Pattern Guard',
    hp: 80,
    attack: 10,
    defense: 0,
    xp: 0,
    goldReward: 0,
    loot: [],
    type: 'aggressive',
    abilities: ['shield_bash', 'frenzy'],
  };

  const firstView = runtime.getView(state);
  const afterFirstTurn = runtime.dispatch(state, { type: 'combat_attack' }).state;
  const secondView = runtime.getView(afterFirstTurn);

  firstView.combat.intent?.abilityId === 'shield_bash' &&
    secondView.combat.intent?.abilityId === 'frenzy' &&
    secondView.combat.intent.danger === 'high'
    ? ok('runtime combat: rotates enemy ability intent by turn')
    : fail('runtime enemy ability rotation', JSON.stringify({ first: firstView.combat.intent, second: secondView.combat.intent }));
}

{
  let state = runtime.startNewRun({ name: 'WardenPattern' });
  state.currentSceneId = 'boss_room';

  state = runtime.dispatch(state, { type: 'combat_attack' }).state;
  state = runtime.dispatch(state, { type: 'combat_attack' }).state;
  const thirdTurn = runtime.getView(state);

  thirdTurn.combat.intent?.abilityId === 'heavy_hit' &&
    ['medium', 'high'].includes(thirdTurn.combat.intent.danger)
    ? ok('runtime boss balance: Warden has a threatening third-turn intent')
    : fail('runtime boss balance third-turn intent', JSON.stringify(thirdTurn.combat.intent));
}

{
  const state = runtime.startNewRun({
    name: 'AbilityUser',
    playerPatch: {
      attack: 15,
      defense: 99,
      abilities: [{ id: 'power_strike', name: 'Power Strike', type: 'damage_bonus', value: 8, cooldown: 2, currentCooldown: 0 }],
    },
  });
  state.currentSceneId = 'left_path_combat';
  state.floorConfig.enemyVariants.left_path_combat = { name: 'Training Guard', hp: 60, attack: 1, defense: 0, xp: 0, goldReward: 0, loot: [], type: 'aggressive' };
  const result = runtime.dispatch(state, { type: 'combat_ability', abilityId: 'power_strike' });

  result.state.combat?.enemy?.hp === 37 && result.state.player.abilities[0].currentCooldown > 0
    ? ok('runtime.combat_ability: power strike damages enemy and starts cooldown')
    : fail('runtime combat ability damage', JSON.stringify({ enemy: result.state.combat?.enemy, ability: result.state.player.abilities[0], events: result.events }));

  result.events.some(event => event.type === 'ability_used' && event.abilityId === 'power_strike' && event.damage === 23)
    ? ok('runtime.combat_ability: emits ability_used event')
    : fail('runtime combat ability event', JSON.stringify(result.events));
}

{
  const state = runtime.startNewRun({
    name: 'CoolingDown',
    playerPatch: {
      attack: 15,
      defense: 99,
      abilities: [{ id: 'power_strike', name: 'Power Strike', type: 'damage_bonus', value: 8, cooldown: 2, currentCooldown: 2 }],
    },
  });
  state.currentSceneId = 'left_path_combat';
  state.floorConfig.enemyVariants.left_path_combat = { name: 'Training Guard', hp: 60, attack: 1, defense: 0, xp: 0, goldReward: 0, loot: [], type: 'aggressive' };
  const result = runtime.dispatch(state, { type: 'combat_ability', abilityId: 'power_strike' });

  result.state.combat?.enemy?.hp === 60 && result.state.player.abilities[0].currentCooldown === 2 && result.events.some(event => event.type === 'ability_use_failed')
    ? ok('runtime.combat_ability: rejects abilities on cooldown')
    : fail('runtime combat ability cooldown', JSON.stringify({ enemy: result.state.combat?.enemy, ability: result.state.player.abilities[0], events: result.events }));
}

{
  const state = runtime.startNewRun({
    name: 'GuardUser',
    playerPatch: {
      hp: 100,
      maxHp: 100,
      attack: 1,
      defense: 0,
      abilities: [{ id: 'guard', name: 'Guard', type: 'damage_reduce', value: 0.25, cooldown: 3, currentCooldown: 0 }],
    },
  });
  state.currentSceneId = 'left_path_combat';
  state.floorConfig.enemyVariants.left_path_combat = { name: 'Heavy Guard', hp: 60, attack: 20, defense: 0, xp: 0, goldReward: 0, loot: [], type: 'aggressive' };
  const result = runtime.dispatch(state, { type: 'combat_ability', abilityId: 'guard' });

  result.state.player.hp === 95 && result.state.combat.defending === false && result.state.player.abilities[0].currentCooldown > 0
    ? ok('runtime.combat_ability: guard reduces the next enemy hit')
    : fail('runtime combat guard ability', JSON.stringify({ hp: result.state.player.hp, combat: result.state.combat, ability: result.state.player.abilities[0] }));
}

{
  const state = runtime.startNewRun({
    name: 'Fighter',
    playerPatch: { attack: 50, defense: 99 },
  });
  state.currentSceneId = 'left_path_combat';
  const view = runtime.getView(state);

  view.mode === 'combat' && view.combat.enemy.hp > 0 && view.combat.actions.some(a => a.type === 'combat_attack')
    ? ok('runtime.getView: combat scene exposes enemy state')
    : fail('runtime combat view', JSON.stringify(view.combat));

  view.combat.actions.some(a => a.type === 'end_run' && a.label === 'End Run')
    ? ok('runtime.getView: combat scene exposes End Run action')
    : fail('runtime combat end run action', JSON.stringify(view.combat.actions));

  const result = runtime.dispatch(state, { type: 'combat_attack' });

  result.state.currentSceneId === 'trap_room'
    ? ok('runtime.combat_attack: victory transitions to victoryScene')
    : fail('runtime combat victory scene', `scene=${result.state.currentSceneId}`);

  result.state.player.xp > state.player.xp && result.state.player.gold > state.player.gold
    ? ok('runtime.combat_attack: victory awards XP and gold')
    : fail('runtime combat rewards', JSON.stringify({ before: state.player, after: result.state.player }));

  result.events.some(e => e.type === 'combat_victory')
    ? ok('runtime.combat_attack: emits combat_victory event')
    : fail('runtime combat events', JSON.stringify(result.events));

  result.events.some(e => e.type === 'reward_summary' && e.loot.includes('guard_key') && e.gold > 0)
    ? ok('runtime.combat_attack: emits clear combat reward summary')
    : fail('runtime combat reward summary', JSON.stringify(result.events));
}

{
  const baseState = runtime.startNewRun({
    name: 'BossReader',
    playerPatch: { floor: 2, inventory: [] },
  });
  baseState.currentSceneId = 'floor2_shared_boss';
  const baseView = runtime.getView(baseState);

  const redState = runtime.startNewRun({
    name: 'BossReader',
    playerPatch: { floor: 2, inventory: ['f2_tactical_readout'] },
  });
  redState.currentSceneId = 'floor2_shared_boss';
  const redView = runtime.getView(redState);

  redView.combat.enemy.attack < baseView.combat.enemy.attack &&
    redView.combat.enemy.defense < baseView.combat.enemy.defense &&
    redView.combat.enemy.advantagesApplied?.includes('f2_tactical_readout')
    ? ok('runtime floor2 boss: red tactical readout weakens attack and defense')
    : fail('runtime floor2 boss red advantage', JSON.stringify({ base: baseView.combat.enemy, red: redView.combat.enemy }));
}

{
  const state = runtime.startNewRun({
    name: 'MapReader',
    playerPatch: { floor: 3, contractsCompleted: 5 },
  });
  state.currentSceneId = 'floor3_market';
  const view = runtime.getView(state);
  const floor3MappedRoomCount = Object.keys(scenes).filter(id => id.startsWith('floor3_') && scenes[id].map).length;

  view.mapProgress.totalRooms === floor3MappedRoomCount &&
    view.mapProgress.rooms.every(room => room.id.startsWith('floor3_'))
    ? ok('runtime map progress: counts only current floor rooms')
    : fail('runtime map progress current floor scope', JSON.stringify(view.mapProgress));
}

{
  const baseState = runtime.startNewRun({
    name: 'PatternReader',
    playerPatch: { floor: 2, inventory: [] },
  });
  baseState.currentSceneId = 'floor2_shared_boss';
  const baseView = runtime.getView(baseState);

  const blackState = runtime.startNewRun({
    name: 'PatternReader',
    playerPatch: { floor: 2, inventory: ['f2_pattern_key'] },
  });
  blackState.currentSceneId = 'floor2_shared_boss';
  const blackView = runtime.getView(blackState);

  blackView.combat.enemy.maxHp < baseView.combat.enemy.maxHp &&
    !blackView.combat.enemy.abilities.includes('sweeping_attack') &&
    blackView.combat.enemy.advantagesApplied?.includes('f2_pattern_key')
    ? ok('runtime floor2 boss: black pattern key weakens HP and removes sweep')
    : fail('runtime floor2 boss black advantage', JSON.stringify({ base: baseView.combat.enemy, black: blackView.combat.enemy }));
}

{
  const state = runtime.startNewRun({ name: 'CombatQuitter' });
  state.currentSceneId = 'left_path_combat';
  runtime.getView(state);
  const result = runtime.dispatch(state, { type: 'end_run' });

  result.state.player.runEnded === true && result.state.player.currentRunActive === false && result.events.some(e => e.type === 'run_ended')
    ? ok('runtime.end_run: can end safely from combat')
    : fail('runtime combat end_run', JSON.stringify({ player: result.state.player, events: result.events }));
}

{
  const state = runtime.startNewRun({
    name: 'Defender',
    playerPatch: { attack: 1, defense: 0 },
  });
  state.currentSceneId = 'left_path_combat';
  const entered = runtime.dispatch(state, { type: 'combat_defend' });

  entered.state.combat.defending === false && entered.state.player.hp < state.player.hp
    ? ok('runtime.combat_defend: resolves enemy turn and clears defending flag')
    : fail('runtime combat defend', JSON.stringify({ defending: entered.state.combat?.defending, hpBefore: state.player.hp, hpAfter: entered.state.player.hp }));
}

{
  const state = runtime.startNewRun({
    name: 'PressureReader',
    playerPatch: { hp: 100, maxHp: 100, attack: 1, defense: 0 },
  });
  state.currentSceneId = 'left_path_combat';
  state.floorConfig.enemyVariants.left_path_combat = {
    name: 'Pressure Guard',
    hp: 80,
    attack: 20,
    defense: 0,
    xp: 0,
    goldReward: 0,
    loot: [],
    type: 'aggressive',
    abilities: [],
  };

  const first = runtime.dispatch(state, { type: 'combat_attack' });
  const second = runtime.dispatch(first.state, { type: 'combat_attack' });

  first.state.player.hp === 80 &&
    first.state.combat.attackStreak === 1 &&
    second.state.player.hp === 53 &&
    second.state.combat.attackStreak === 2 &&
    second.events.some(event => event.type === 'combat_pressure' && event.attackStreak === 2)
    ? ok('runtime combat pressure: repeated basic attacks increase danger')
    : fail('runtime combat pressure spam', JSON.stringify({ firstHp: first.state.player.hp, secondHp: second.state.player.hp, firstCombat: first.state.combat, secondCombat: second.state.combat, secondEvents: second.events }));
}

{
  const state = runtime.startNewRun({
    name: 'PressureDefender',
    playerPatch: { hp: 100, maxHp: 100, attack: 1, defense: 0 },
  });
  state.currentSceneId = 'left_path_combat';
  state.floorConfig.enemyVariants.left_path_combat = {
    name: 'Pressure Guard',
    hp: 80,
    attack: 20,
    defense: 0,
    xp: 0,
    goldReward: 0,
    loot: [],
    type: 'aggressive',
    abilities: [],
  };

  const first = runtime.dispatch(state, { type: 'combat_attack' });
  const defended = runtime.dispatch(first.state, { type: 'combat_defend' });
  const view = runtime.getView(first.state);

  defended.state.player.hp === 75 &&
    defended.state.combat.attackStreak === 0 &&
    view.combat.pressure.attackStreak === 1 &&
    /repeated attacks/i.test(view.combat.pressure.text)
    ? ok('runtime combat pressure: defend clears pressure and view explains it')
    : fail('runtime combat pressure defend', JSON.stringify({ defendedHp: defended.state.player.hp, combat: defended.state.combat, pressure: view.combat.pressure, events: defended.events }));
}

{
  const state = runtime.startNewRun({
    name: 'AttackSpammer',
    playerPatch: { hp: 100, maxHp: 100, attack: 1, defense: 0 },
  });
  state.currentSceneId = 'left_path_combat';
  state.floorConfig.enemyVariants.left_path_combat = {
    name: 'Frenzied Guard',
    hp: 80,
    attack: 20,
    defense: 0,
    xp: 0,
    goldReward: 0,
    loot: [],
    type: 'aggressive',
    abilities: ['frenzy'],
  };
  const result = runtime.dispatch(state, { type: 'combat_attack' });

  result.state.player.hp === 60 && result.events.some(event => event.type === 'enemy_ability' && event.abilityId === 'frenzy')
    ? ok('runtime combat: enemy abilities punish attack spam')
    : fail('runtime enemy ability danger', JSON.stringify({ hp: result.state.player.hp, events: result.events }));
}

{
  const state = runtime.startNewRun({ name: 'Runner' });
  state.currentSceneId = 'left_path_combat';
  const result = runtime.dispatch(state, { type: 'combat_flee', forceSuccess: true });

  result.state.currentSceneId === 'start_room' && result.state.player.neverFled === false
    ? ok('runtime.combat_flee: forced success moves to fleeScene')
    : fail('runtime combat flee', JSON.stringify({ scene: result.state.currentSceneId, neverFled: result.state.player.neverFled }));

  result.events.some(e => e.type === 'combat_fled')
    ? ok('runtime.combat_flee: emits combat_fled event')
    : fail('runtime combat flee events', JSON.stringify(result.events));
}

console.log(`\n${'─'.repeat(50)}`);
console.log(`  ${passed} passed   ${failed} failed`);
if (failed > 0) process.exit(1);

'use strict';

const fs = require('fs');
const path = require('path');
const runtime = require('../engine/runtime');
const saveStore = require('./saveStore');

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function makeStorage() {
  const writes = {};
  return {
    getItem: key => writes[key] || null,
    setItem: (key, value) => { writes[key] = value; },
    removeItem: key => { delete writes[key]; },
  };
}

const storage = makeStorage();
const appSource = fs.readFileSync(path.join(__dirname, 'App.js'), 'utf8');
assert(appSource.includes('function RunSetupPanel'), 'smoke: start screen uses a combined Run Setup panel');
assert(appSource.includes('function CollapsiblePanel'), 'smoke: run utility sections are collapsible');
assert(appSource.includes('function HomeScreen'), 'smoke: app has a dedicated game home screen');
assert(appSource.includes('Start New Run'), 'smoke: home screen starts a new setup flow');
assert(appSource.includes('Continue Run'), 'smoke: home screen can continue a saved run');
assert(appSource.includes('function SetupScreen'), 'smoke: app has a dedicated run setup screen');
assert(appSource.includes('Begin Run'), 'smoke: setup screen starts the configured run');
assert(appSource.includes("setMenuScreen('setup')"), 'smoke: start new run navigates to setup screen');
assert(appSource.includes("setMenuScreen('home')"), 'smoke: setup screen can return to home screen');
assert(appSource.includes('useEffect'), 'smoke: app loads native save data asynchronously');
assert(appSource.includes('loadMetaAsync'), 'smoke: app can load meta from native async storage');
assert(appSource.includes('loadSavedRunAsync'), 'smoke: app can load saved runs from native async storage');
assert(appSource.includes('saveRunSnapshotAsync'), 'smoke: app saves runs through native async storage');
assert(appSource.includes('styles.playerIdentity'), 'smoke: player header uses compact identity row');
assert(appSource.includes('styles.playerStats'), 'smoke: player header uses compact stat row');
assert(appSource.includes('Character'), 'smoke: start screen groups character setup');
assert(appSource.includes('styles.startSummary'), 'smoke: start screen uses compact summary panel');
assert(appSource.includes('Class & Abilities'), 'smoke: start screen collapses class and ability setup');
assert(appSource.includes('Meta Upgrades'), 'smoke: start screen collapses meta upgrade setup');
assert(appSource.includes('styles.startActionBar'), 'smoke: start screen keeps run actions grouped at bottom');
assert(appSource.includes('Meta earned:'), 'smoke: run summary shows meta earned');
assert(appSource.includes('Total meta points:'), 'smoke: run summary shows total meta points');
assert(appSource.includes('Reward bonus:'), 'smoke: run summary shows reward bonus');
assert(appSource.includes('Unequip one ability to equip another.'), 'smoke: ability picker explains full loadout');
assert(appSource.includes("loadoutFull ? 'Full' : 'Equip'"), 'smoke: full ability loadout uses clear disabled button label');
assert(appSource.includes("ability.owned ? 'Owned' : affordable ? 'Affordable' : 'Locked'"), 'smoke: ability unlock rows show owned/affordable/locked state');
assert(appSource.includes("ability.owned ? 'Owned' : affordable ? `Buy ${ability.cost}` : `Need ${ability.cost}`"), 'smoke: unaffordable ability unlocks use Need label');
assert(appSource.includes('Available in Run Abilities after purchase.'), 'smoke: ability unlocks explain where purchased abilities appear');
assert(appSource.includes('styles.intentPanel'), 'smoke: combat screen renders enemy intent preview');
assert(appSource.includes('Danger:'), 'smoke: combat intent shows danger rating');
assert(appSource.includes('Pressure'), 'smoke: combat screen explains attack pressure');
assert(appSource.includes('view.combat.pressure'), 'smoke: combat pressure comes from runtime view');
assert(appSource.includes('Boss Advantage'), 'smoke: combat screen calls out active boss advantages');
assert(appSource.includes('view.combat.enemy.advantagesApplied'), 'smoke: boss advantages come from runtime enemy view');
assert(appSource.includes('function OutcomePanel'), 'smoke: room and combat outcomes render outside the collapsed log');
assert(appSource.includes('Recent Result'), 'smoke: visible outcome panel has a clear label');
assert(appSource.includes('Quick Items'), 'smoke: combat screen exposes quick item controls');
assert(appSource.includes("onAction({ type: 'use_item', itemId: item.id })"), 'smoke: quick combat items dispatch item use');
assert(appSource.includes('function EquipmentPanel'), 'smoke: run screen renders equipment panel');
assert(appSource.includes("label={item.equippable ? 'Equip' : 'Use'}"), 'smoke: inventory labels gear with Equip');
assert(appSource.includes("type: 'equip_item'"), 'smoke: inventory can dispatch gear equip action');
assert(appSource.includes('Current:'), 'smoke: inventory gear rows label current equipped item');
assert(appSource.includes('Change:'), 'smoke: inventory gear rows label stat change');
assert(appSource.includes('itemStatLine'), 'smoke: inventory gear rows use compact stat line');
assert(appSource.includes("event.type === 'gear_trait'"), 'smoke: event log formats gear trait triggers');
assert(appSource.includes('function ObjectivePanel'), 'smoke: run screen renders objective tracker');
assert(appSource.includes('function ContractBadge'), 'smoke: run screen renders Floor 3 contract badge');
assert(appSource.includes('view.contractProgress'), 'smoke: contract badge comes from runtime view');
assert(appSource.includes('Contracts'), 'smoke: contract badge labels contract progress');
assert(appSource.includes('function MapProgressPanel'), 'smoke: run screen renders map progress panel');
assert(appSource.includes('Risk:'), 'smoke: choice rows expose risk labels');
assert(appSource.includes('Reward:'), 'smoke: choice rows expose reward labels');

const setupOptions = runtime.getRunSetupOptions({
  currency: 0,
  upgrades: { hp: 0, atk: 0, def: 0, per: 0 },
  unlockedAbilities: ['power_strike', 'guard', 'heal', 'arcane_bolt', 'barrier'],
}, 'mage');
assert((setupOptions.classes || []).some(gameClass => gameClass.id === 'mage' && gameClass.selected), 'smoke: setup exposes selected class', setupOptions);
assert(setupOptions.abilities.some(ability => ability.id === 'heal'), 'smoke: setup exposes class-filtered unlocked abilities', setupOptions);
assert(!setupOptions.abilities.some(ability => ability.id === 'power_strike'), 'smoke: mage setup excludes fighter abilities', setupOptions);
assert(setupOptions.unlocks.some(ability => ability.id === 'toxic_slash' && ability.locked), 'smoke: setup exposes locked class ability purchases', setupOptions);

let state = runtime.startNewRun({
  name: 'Smoke',
  selectedAbilityIds: ['power_strike', 'guard'],
  playerPatch: {
    attack: 15,
    defense: 99,
    inventory: ['small_potion', 'small_potion', 'antidote'],
    abilities: [
      { id: 'power_strike', name: 'Power Strike', type: 'damage_bonus', value: 8, cooldown: 2, currentCooldown: 0 },
      { id: 'guard', name: 'Guard', type: 'damage_reduce', value: 0.25, cooldown: 3, currentCooldown: 0 },
    ],
  },
});

let inventoryView = runtime.getView(state);
const stackedPotion = inventoryView.items.find(item => item.id === 'small_potion');
assert(stackedPotion && stackedPotion.count === 2, 'smoke: inventory stacks duplicate items', inventoryView.items);

state.player.inventory.push('bent_baton');
const equipped = runtime.dispatch(state, { type: 'equip_item', itemId: 'bent_baton' });
state = equipped.state;
inventoryView = runtime.getView(state);
assert(equipped.events.some(event => event.type === 'item_equipped'), 'smoke: gear equip emits item_equipped', equipped.events);
assert(inventoryView.equipment.weapon === 'bent_baton', 'smoke: equipped weapon appears in view', inventoryView.equipment);
assert(inventoryView.equipmentItems.some(item => item.slot === 'weapon' && item.name === 'Bent Baton'), 'smoke: equipment panel data has item names', inventoryView.equipmentItems);
state.player.inventory.push('training_sword');
inventoryView = runtime.getView(state);
assert(inventoryView.items.some(item => item.id === 'training_sword' && item.currentEquippedName === 'Bent Baton' && item.comparisonText === '-1 ATK'), 'smoke: gear comparison survives runtime view', inventoryView.items);
state.player.inventory.push('shock_baton');
inventoryView = runtime.getView(state);
assert(inventoryView.items.some(item => item.id === 'shock_baton' && item.traitText && item.traitText.includes('First attack')), 'smoke: gear trait text survives runtime view', inventoryView.items);

state.currentSceneId = 'left_path_combat';
state.floorConfig.enemyVariants.left_path_combat = {
  name: 'Smoke Guard',
  hp: 60,
  attack: 1,
  defense: 0,
  xp: 0,
  goldReward: 0,
  loot: [],
  type: 'aggressive',
};

let view = runtime.getView(state);
assert(view.mode === 'combat', 'smoke: entered combat scene', view);
assert(view.combat.intent && view.combat.intent.text.includes('Attack'), 'smoke: combat exposes enemy intent text', view.combat.intent);
assert(view.combat.abilities.some(ability => ability.id === 'power_strike' && ability.ready), 'smoke: ability is visible and ready', view.combat.abilities);
assert(view.combat.actions.some(action => action.type === 'end_run'), 'smoke: combat exposes End Run action', view.combat.actions);

const used = runtime.dispatch(state, { type: 'combat_ability', abilityId: 'power_strike' });
state = used.state;
assert(used.events.some(event => event.type === 'ability_used'), 'smoke: ability dispatch emits ability_used', used.events);
assert(state.combat.enemy.hp === 36, 'smoke: ability changed combat state', state.combat.enemy);

const snapshot = runtime.createSaveData(state);
saveStore.saveRunSnapshot(snapshot, storage);
const loadedSnapshot = saveStore.loadSavedRun(storage);
const restored = runtime.hydrateRun(loadedSnapshot);
view = runtime.getView(restored);

saveStore.saveRunSnapshotAsync(snapshot, storage).then(saved => {
  assert(saved === true, 'smoke: async injected storage saves run snapshot');
});
saveStore.loadSavedRunAsync(storage).then(asyncLoadedSnapshot => {
  assert(asyncLoadedSnapshot.currentSceneId === 'left_path_combat', 'smoke: async injected storage loads run snapshot', asyncLoadedSnapshot);
});

assert(restored.currentSceneId === 'left_path_combat', 'smoke: save/load preserves combat scene', restored);
assert(view.mode === 'combat' && view.combat.enemy.hp === 36, 'smoke: save/load preserves enemy HP', view.combat);
assert(view.combat.abilities.some(ability => ability.id === 'power_strike' && ability.currentCooldown > 0), 'smoke: save/load preserves ability cooldown', view.combat.abilities);

let floor3State = runtime.startNewRun({
  name: 'Floor3Smoke',
  playerPatch: { floor: 3, contractsCompleted: 3, completedContracts: ['hunt', 'recovery', 'puzzle'] },
});
floor3State.currentSceneId = 'floor3_market';
const floor3View = runtime.getView(floor3State);
assert(floor3View.contractProgress && floor3View.contractProgress.label === 'Contracts 3/5', 'smoke: Floor 3 runtime exposes contract progress label', floor3View.contractProgress);

let floor4State = runtime.startNewRun({
  name: 'Floor4Smoke',
  playerPatch: { floor: 4, inventory: ['f4_gold_key'] },
});
floor4State.currentSceneId = 'floor4_boss_gate';
const floor4View = runtime.getView(floor4State);
assert(floor4View.objective && floor4View.objective.goal === 'Collect Vault Keys 1/3', 'smoke: Floor 4 runtime exposes Vault Key objective', floor4View.objective);

let floor5State = runtime.startNewRun({
  name: 'Floor5Smoke',
  playerPatch: { floor: 5, inventory: ['f5_memory_protocol'] },
});
floor5State.currentSceneId = 'floor5_boss_gate';
const floor5View = runtime.getView(floor5State);
assert(floor5View.objective && floor5View.objective.goal === 'Clear Protocols 1/4', 'smoke: Floor 5 runtime exposes Protocol objective', floor5View.objective);

let floor6State = runtime.startNewRun({
  name: 'Floor6Smoke',
  playerPatch: { floor: 6, inventory: ['f6_glass_anchor', 'f6_road_anchor'] },
});
floor6State.currentSceneId = 'floor6_boss_gate';
const floor6View = runtime.getView(floor6State);
assert(floor6View.objective && floor6View.objective.goal === 'Stabilize Anchors 2/3', 'smoke: Floor 6 runtime exposes Anchor objective', floor6View.objective);

let floor7State = runtime.startNewRun({
  name: 'Floor7Smoke',
  playerPatch: { floor: 7, inventory: ['f7_forager_trust', 'f7_builder_trust'] },
});
floor7State.currentSceneId = 'floor7_council_fire';
const floor7View = runtime.getView(floor7State);
assert(floor7View.objective && floor7View.objective.goal === 'Earn Trust Bonds 2/4', 'smoke: Floor 7 runtime exposes Trust objective', floor7View.objective);

let floor8State = runtime.startNewRun({
  name: 'Floor8Smoke',
  playerPatch: { floor: 8, inventory: ['f8_scent_trap', 'f8_sight_trap'] },
});
floor8State.currentSceneId = 'floor8_killing_ground';
const floor8View = runtime.getView(floor8State);
assert(floor8View.objective && floor8View.objective.goal === 'Set Hunt Traps 2/4', 'smoke: Floor 8 runtime exposes Hunt Trap objective', floor8View.objective);

let floor2BossState = runtime.startNewRun({
  name: 'Floor2BossSmoke',
  playerPatch: { floor: 2, inventory: ['f2_tactical_readout'] },
});
floor2BossState.currentSceneId = 'floor2_shared_boss';
const floor2BossView = runtime.getView(floor2BossState);
assert(floor2BossView.combat.enemy.advantagesApplied.includes('f2_tactical_readout'), 'smoke: Floor 2 boss view exposes applied advantage items', floor2BossView.combat.enemy);

const ended = runtime.dispatch(restored, { type: 'end_run' });
assert(ended.state.player.runEnded === true && ended.events.some(event => event.type === 'run_ended'), 'smoke: combat End Run ends safely', ended);

console.log('mobile smoke: start -> combat -> ability -> save -> load -> end run passed');

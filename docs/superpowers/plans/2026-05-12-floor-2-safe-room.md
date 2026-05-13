# Floor 2 Safe Room Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Floor 2 placeholder with a safe room containing a bed, upgraded trader, and three one-way exit doors.

**Architecture:** Reuse the existing scene JSON, choice filtering, `spendGold`, `giveItem`, `heal`, and `once` mechanics. Add Floor 2 scenes directly to `data/scenes.json`, let `generateFloor(2)` return a real config, and update CLI/runtime transition logic so Floor 2 starts at a dedicated `floor2_safe_room` scene.

**Tech Stack:** Node.js CommonJS, JSON scene data, existing CLI/runtime state dispatch, `test_full.js` validation.

---

## File Structure

- Modify `engine/floorGen.js`: add `generateFloor2Config()` and route `generateFloor(2)` to it.
- Modify `engine/runLifecycle.js`: set `MAX_IMPLEMENTED_FLOOR` to `2`.
- Modify `engine/runtime.js`: when a floor transition reaches Floor 2, enter `floor2_safe_room` instead of `start_room`; stop ending the run for Floor 2.
- Modify `index.js`: same CLI transition behavior for Floor 2.
- Modify `data/items.json`: add upgraded Floor 2 trader inventory.
- Modify `data/scenes.json`: add `floor2_safe_room` and three one-way Floor 2 branch starts.
- Modify `test_full.js`: add failing assertions first, then update expected Floor 2 behavior from placeholder to implemented.

### Task 1: Floor 2 Generator And Transition Tests

**Files:**
- Modify: `test_full.js`
- Modify: `engine/floorGen.js`
- Modify: `engine/runLifecycle.js`

- [ ] **Step 1: Write failing tests**

Add assertions near the existing floor-generation tests:

```js
const f2 = generateFloor(2);
f2 && f2.floor === 2 && f2.placeholder !== true && Array.isArray(f2.excludedRooms)
  ? ok('generateFloor: floor 2 uses real generator')
  : fail('generateFloor floor 2 real config', JSON.stringify(f2));

MAX_IMPLEMENTED_FLOOR === 2
  ? ok('run lifecycle: max implemented floor includes Floor 2')
  : fail('MAX_IMPLEMENTED_FLOOR should be 2', `got ${MAX_IMPLEMENTED_FLOOR}`);
```

- [ ] **Step 2: Run test and verify failure**

Run: `node test_full.js`

Expected: failures for Floor 2 still being placeholder and `MAX_IMPLEMENTED_FLOOR` still being `1`.

- [ ] **Step 3: Implement Floor 2 config**

In `engine/floorGen.js`, add:

```js
function generateFloor2Config() {
  return {
    floor: 2,
    excludedRooms: [],
    enemyVariants: {},
    safeRoom: 'floor2_safe_room',
  };
}
```

Change `generateFloor` to:

```js
function generateFloor(floor) {
  if (floor === 1) return generateFloor1Config();
  if (floor === 2) return generateFloor2Config();
  return {
    floor,
    placeholder: true,
    message: `Floor ${floor} under construction`,
    excludedRooms: [],
    enemyVariants: {},
  };
}
```

Export `generateFloor2Config`.

In `engine/runLifecycle.js`, change:

```js
const MAX_IMPLEMENTED_FLOOR = 2;
```

- [ ] **Step 4: Run tests**

Run: `node test_full.js`

Expected: Floor 2 generator tests pass; scene tests may fail until Task 2 adds scenes.

### Task 2: Floor 2 Safe Room And Items

**Files:**
- Modify: `data/items.json`
- Modify: `data/scenes.json`
- Modify: `test_full.js`

- [ ] **Step 1: Write failing scene tests**

Add assertions near the existing merchant-room tests:

```js
{
  const room = scenes['floor2_safe_room'];
  room && room.map?.tag === 'safe' ? ok('floor2_safe_room: tagged safe') : fail('floor2_safe_room missing safe tag');

  const bedChoice = (room?.choices || []).find(c => /bed/i.test(c.text));
  bedChoice?.once && bedChoice.effect?.heal
    ? ok('floor2_safe_room: bed heals once')
    : fail('floor2_safe_room: bed missing once heal');

  const doorChoices = (room?.choices || []).filter(c => c.nextScene && /^floor2_/.test(c.nextScene));
  doorChoices.length === 3
    ? ok('floor2_safe_room: has three exit doors')
    : fail('floor2_safe_room door count', `got ${doorChoices.length}`);

  const upgradedGear = (room?.choices || []).filter(c => c.requires?.gold && c.effect?.spendGold && c.effect?.giveItem);
  upgradedGear.some(c => c.effect.giveItem === 'phase_edge') &&
    upgradedGear.some(c => c.effect.giveItem === 'mesh_armor') &&
    upgradedGear.some(c => c.effect.giveItem === 'large_potion')
    ? ok('floor2_safe_room: trader sells upgraded items and consumables')
    : fail('floor2_safe_room trader inventory', JSON.stringify(upgradedGear));

  const blockedReturns = doorChoices.every(c => {
    const target = scenes[c.nextScene];
    return target && !(target.choices || []).some(next => next.nextScene === 'floor2_safe_room');
  });
  blockedReturns
    ? ok('floor2_safe_room: exits are one-way')
    : fail('floor2_safe_room: a branch returns to safe room');
}
```

- [ ] **Step 2: Run test and verify failure**

Run: `node test_full.js`

Expected: `floor2_safe_room` tests fail because scenes/items do not exist yet.

- [ ] **Step 3: Add upgraded items**

Add to `data/items.json`:

```json
"large_potion": {
  "id": "large_potion",
  "name": "Large Potion",
  "type": "consumable",
  "effect": "heal",
  "value": 65
},
"phase_edge": {
  "id": "phase_edge",
  "name": "Phase Edge",
  "type": "gear",
  "slot": "weapon",
  "stats": {
    "attack": 6
  },
  "trait": {
    "id": "first_attack_bonus",
    "value": 4,
    "text": "First attack each combat deals +4 damage."
  },
  "effect": "none",
  "value": 0
},
"mesh_armor": {
  "id": "mesh_armor",
  "name": "Mesh Armor",
  "type": "gear",
  "slot": "armor",
  "stats": {
    "defense": 5
  },
  "trait": {
    "id": "first_hit_reduction",
    "value": 8,
    "text": "Reduce the first incoming hit each combat by 8."
  },
  "effect": "none",
  "value": 0
},
"floor2_lens": {
  "id": "floor2_lens",
  "name": "Calibrated Lens",
  "type": "gear",
  "slot": "trinket",
  "stats": {
    "perception": 2
  },
  "effect": "none",
  "value": 0
}
```

- [ ] **Step 4: Add Floor 2 scenes**

Add these scene ids to `data/scenes.json`:

```json
"floor2_safe_room": {
  "id": "floor2_safe_room",
  "map": {
    "x": 4,
    "y": 0,
    "name": "SAFE",
    "tag": "safe",
    "connections": [
      "floor2_red_door",
      "floor2_blue_door",
      "floor2_black_door"
    ]
  },
  "type": "safe",
  "title": "Floor 2 - Transit Safe Room",
  "text": "The elevator opens into a room that feels deliberately untouched. Clean cot. Working sink. A trader behind a reinforced counter. Three sealed doors wait on the far wall: red, blue, and black. The lock panel beside them has one warning: EXIT SELECTION FINAL.",
  "choices": [
    {
      "text": "Rest on the bed before choosing a door",
      "effect": {
        "heal": 35
      },
      "once": true
    },
    {
      "text": "Buy Large Potion - 35 gold",
      "requires": {
        "gold": 35
      },
      "effect": {
        "giveItem": "large_potion",
        "spendGold": 35
      },
      "once": true
    },
    {
      "text": "Buy Phase Edge - 70 gold",
      "requires": {
        "gold": 70
      },
      "effect": {
        "giveItem": "phase_edge",
        "spendGold": 70
      },
      "once": true
    },
    {
      "text": "Buy Mesh Armor - 75 gold",
      "requires": {
        "gold": 75
      },
      "effect": {
        "giveItem": "mesh_armor",
        "spendGold": 75
      },
      "once": true
    },
    {
      "text": "Buy Calibrated Lens - 60 gold",
      "requires": {
        "gold": 60
      },
      "effect": {
        "giveItem": "floor2_lens",
        "spendGold": 60
      },
      "once": true
    },
    {
      "text": "Leave through the red door",
      "nextScene": "floor2_red_door"
    },
    {
      "text": "Leave through the blue door",
      "nextScene": "floor2_blue_door"
    },
    {
      "text": "Leave through the black door",
      "nextScene": "floor2_black_door"
    }
  ]
}
```

Add three forward-only target rooms with no choices back to `floor2_safe_room`.

- [ ] **Step 5: Run tests**

Run: `node test_full.js`

Expected: new safe room tests pass; transition tests may fail until Task 3.

### Task 3: Runtime And CLI Floor 2 Entry

**Files:**
- Modify: `engine/runtime.js`
- Modify: `index.js`
- Modify: `test_full.js`

- [ ] **Step 1: Write failing transition tests**

Replace the runtime placeholder assertion with:

```js
result.state.player.floor === 2 &&
  result.state.currentSceneId === 'floor2_safe_room' &&
  result.state.floorConfig.placeholder !== true &&
  result.state.player.runEnded !== true
  ? ok('runtime.complete_floor: enters Floor 2 safe room')
  : fail('runtime.complete_floor Floor 2 entry', JSON.stringify({
      floor: result.state.player.floor,
      scene: result.state.currentSceneId,
      placeholder: result.state.floorConfig.placeholder,
      runEnded: result.state.player.runEnded,
    }));
```

- [ ] **Step 2: Run test and verify failure**

Run: `node test_full.js`

Expected: runtime still enters `start_room` or old placeholder-ending behavior.

- [ ] **Step 3: Update runtime transition**

In `engine/runtime.js`, in `completeCurrentFloor`, after generating the next floor config, use:

```js
const nextStartScene = state.floorConfig.safeRoom || 'start_room';
```

Then set:

```js
state.currentSceneId = nextStartScene;
```

when the next floor is not placeholder.

- [ ] **Step 4: Update CLI transition**

In `index.js`, after `floorConfig = generateFloor(player.floor);`, keep the placeholder end behavior only for true placeholders or floors beyond `MAX_IMPLEMENTED_FLOOR`. When continuing, set:

```js
currentSceneId = floorConfig.safeRoom || 'start_room';
```

- [ ] **Step 5: Run tests**

Run: `node test_full.js`

Expected: all tests pass.

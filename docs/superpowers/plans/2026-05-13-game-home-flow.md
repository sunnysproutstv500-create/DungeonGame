# Game Home Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a professional game-style home page that only offers continuing or starting a run, with all setup choices moved to a second screen.

**Architecture:** Keep the existing React Native single-file app structure. Add a title menu component and a setup-screen state in `mobile/App.js`, then reuse the existing setup panels from the old start screen for the second page.

**Tech Stack:** Expo 52, React 18, React Native, Node smoke test.

---

## File Structure

- Modify: `mobile/App.js` for the title menu, setup page split, navigation state, and styles.
- Modify: `mobile/test_mobile_smoke.js` for source-level assertions covering the new two-screen flow.

### Task 1: Add Failing Smoke Assertions

**Files:**
- Modify: `mobile/test_mobile_smoke.js`

- [ ] **Step 1: Add assertions for the two-screen home flow**

Add assertions near the existing start-screen assertions:

```js
assert(appSource.includes('function HomeScreen'), 'smoke: app has a dedicated game home screen');
assert(appSource.includes('Start New Run'), 'smoke: home screen starts a new setup flow');
assert(appSource.includes('Continue Run'), 'smoke: home screen can continue a saved run');
assert(appSource.includes('function SetupScreen'), 'smoke: app has a dedicated run setup screen');
assert(appSource.includes('Begin Run'), 'smoke: setup screen starts the configured run');
assert(appSource.includes("setMenuScreen('setup')"), 'smoke: start new run navigates to setup screen');
assert(appSource.includes("setMenuScreen('home')"), 'smoke: setup screen can return to home screen');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd run smoke`

Expected: FAIL with `smoke: app has a dedicated game home screen`.

### Task 2: Implement Home And Setup Screens

**Files:**
- Modify: `mobile/App.js`

- [ ] **Step 1: Rename the old setup-heavy `StartScreen` to `SetupScreen`**

Change the function name and props so it receives `onBack`. Replace the old `Start Run` label with `Begin Run`, and add a top secondary `Back` action.

- [ ] **Step 2: Add `HomeScreen`**

Create a new component before `SetupScreen`:

```js
function HomeScreen({ meta, savedRun, onStartNew, onContinue }) {
  return (
    <View style={styles.homeScreen}>
      <View style={styles.homeHero}>
        <Text style={styles.homeEyebrow}>LitRPG Expedition</Text>
        <Text style={styles.homeTitle}>Dungeon Depths</Text>
        <Text style={styles.homeSubtitle}>Descend, adapt, and bring something back.</Text>
      </View>
      <View style={styles.homeStatusRow}>
        <View style={styles.homeStatusChip}>
          <Text style={styles.homeStatusLabel}>Meta Points</Text>
          <Text style={styles.homeStatusValue}>{meta.currency}</Text>
        </View>
        <View style={styles.homeStatusChip}>
          <Text style={styles.homeStatusLabel}>Saved Run</Text>
          <Text style={styles.homeStatusValue}>{savedRun ? savedRun.player.name : 'None'}</Text>
        </View>
      </View>
      <View style={styles.homeActions}>
        <ActionButton label="Continue Run" onPress={onContinue} disabled={!savedRun} />
        <ActionButton label="Start New Run" onPress={onStartNew} tone="secondary" />
      </View>
    </View>
  );
}
```

- [ ] **Step 3: Add root menu state**

In `App`, add:

```js
const [menuScreen, setMenuScreen] = useState('home');
```

When `!gameState`, render `HomeScreen` for `menuScreen === 'home'`, otherwise render `SetupScreen`.

- [ ] **Step 4: Add styles**

Add dark, professional home styles and setup header styles to `StyleSheet.create`, keeping border radii at 8 or less and preserving readable text sizes.

- [ ] **Step 5: Run smoke test**

Run: `npm.cmd run smoke`

Expected: PASS with `mobile smoke: start -> combat -> ability -> save -> load -> end run passed`.

### Task 3: Verify Web Preview

**Files:**
- No source changes expected.

- [ ] **Step 1: Export or start web preview**

Run: `npm.cmd run export:web`

Expected: Expo web export completes without errors.

- [ ] **Step 2: Optional local screenshot check**

If a local preview server is already running or can be started safely, open the app at `http://127.0.0.1:8090/` and verify the first viewport shows the title menu with `Continue Run` and `Start New Run`.

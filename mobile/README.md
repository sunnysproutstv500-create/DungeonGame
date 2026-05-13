# Dungeon Depths Mobile

Expo shell for the text-based LitRPG runtime.

## Commands

```powershell
npm.cmd install
npm.cmd run web
```

If Expo cannot reach its online services, use:

```powershell
npm.cmd run web:offline
```

This serves the web preview on `http://localhost:8090`.

To verify the web bundle:

```powershell
npm.cmd run export:web
```

To run the mobile save-flow smoke test:

```powershell
npm.cmd run smoke
```

To serve the exported bundle:

```powershell
npm.cmd run preview:web
```

The app imports the shared engine runtime from `../engine/runtime.js`.

Current mobile flow:
- pre-run setup with character name and meta points
- persistent meta points
- buy HP/ATK/DEF/PER upgrades
- choose a class before starting a run
- choose up to two unlocked abilities before starting a run
- start run
- apply purchased upgrades to new runs
- inventory panel with usable consumables
- combat ability buttons with cooldown state
- player/enemy combat status display
- in-memory save run / continue saved run
- clear save
- return to menu after run end

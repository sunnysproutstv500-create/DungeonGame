# Game Home Flow Design

## Goal

Make the mobile/web app feel more like a professional game by replacing the current setup-heavy first screen with a clean title menu, then moving run customization to a second setup screen.

## User Flow

The first screen is the game home page. It presents `Dungeon Depths` as a polished title screen with only two primary player decisions:

- Continue an existing saved run when one exists.
- Start a new run.

The second screen is the setup page for a new run. It contains the choices that currently crowd the home page:

- Character name.
- Class selection.
- Run ability selection.
- Meta upgrades.
- Ability unlocks.
- Final `Begin Run` action.
- Back action to return to the title menu.

## Visual Direction

Use a premium mobile game style with light LitRPG system flavor. The home page should feel atmospheric and intentional, with a darker game-like background, strong title hierarchy, readable action buttons, and compact status chips for saved-run and meta-point context. The setup page can remain more functional, but should inherit the same polished colors, spacing, and button treatment.

## Architecture

Keep the implementation inside `mobile/App.js`, following the app's existing single-file React Native pattern. Add a small menu/setup screen state in the root `App` component so `Start New Run` moves from the home page to the setup page instead of immediately starting gameplay. Reuse existing setup panels and runtime actions where possible.

## Behavior

- When no run is active, the app starts on the title menu.
- `Continue Run` loads the saved run and is disabled when no save exists.
- `Start New Run` opens the setup page.
- `Begin Run` starts gameplay using the selected name, class, and abilities.
- `Back` returns from setup to the title menu without clearing selections.
- Clearing a saved run is available from the setup page with the rest of the management controls.

## Testing

Update the mobile smoke test to assert the two-screen flow is represented in the source:

- The app has a title/home screen component.
- The title/home screen includes `Continue Run` and `Start New Run`.
- The setup screen includes `Begin Run` and `Back`.
- Existing setup, combat, inventory, and save/load assertions continue to pass.

# Floor 2 Safe Room Design

## Summary

Floor 2 begins with a safe room instead of the current placeholder stop. The room gives the player a brief recovery and preparation point after clearing Floor 1, then forces a one-way commitment through one of three doors.

## Player Experience

The first Floor 2 scene is a safe room with a bed, a trader, and three exit doors. The bed can be used once to recover HP. The trader sells stronger Floor 2 items and consumables with existing gold-gated choice behavior. Once the player leaves through any door, the safe room cannot be reentered.

## Content Scope

Add a Floor 2 safe room and three initial branch rooms:

- Door 1: a combat-leaning route.
- Door 2: a hazard or resource route.
- Door 3: a strange/lore route.

Each branch can be a small first-room stub that proves the choice works and gives Floor 2 a real start without requiring the whole floor to be completed in this slice.

## Data And Flow

Floor 2 generation should stop returning a placeholder. Floor 2 should start at the existing `start_room` id, but runtime and CLI display should use Floor 2-specific scene content by making `start_room` represent the Floor 2 safe room when `player.floor === 2`.

The safe room exits should point forward to Floor 2 room ids. Those room choices should not point back to `start_room`, and their map connections should also avoid a return connection. This preserves the "cannot reenter" rule through scene graph structure.

## Trader Inventory

Use existing `requires.gold`, `effect.spendGold`, and `effect.giveItem` mechanics. Add upgraded items to `data/items.json` as needed. Candidate inventory:

- Stronger healing consumable.
- Stronger weapon than Floor 1's `shock_baton`.
- Stronger armor than Floor 1's `sentry_plate`.
- One utility consumable or perception/trinket option.

Purchases should be `once` where appropriate to avoid repeated gear farming. Consumables can either be limited or repeatable depending on current engine behavior; this slice will use limited purchases for predictable balance.

## Testing

Update `test_full.js` to verify:

- Floor 2 is implemented instead of placeholder.
- The Floor 2 first room is tagged safe.
- The bed is once-only and heals.
- The trader has gold-gated upgraded purchases.
- Three door choices exist.
- Door targets do not provide a return path to the safe room.
- Runtime floor completion advances to Floor 2 without ending the run.

# Floor 2 Boss Design

## Goal

Turn `floor2_shared_boss` from a placeholder fight into the capstone for all three Floor 2 lanes.

## Design

The boss is the Convergence Warden, an Overseer engine guardian that cycles through three protocols matching the lane identities:

- Red Protocol: tactical pressure and guard-breaking attacks.
- Blue Protocol: direct gauntlet aggression.
- Black Protocol: pattern-based sweeping attacks.

All three lanes still end at the same boss. The paths stay different by changing how prepared the player is when they arrive:

- Path 1 can find a tactical readout in an optional side cache. Carrying it into the boss weakens the base boss attack and defense.
- Path 2 remains the attrition lane. It does not grant a special boss bypass; its advantage is combat loot and player preparation.
- Path 3 grants a pattern key from puzzle completion. Carrying it into the boss weakens the boss HP and removes the most punishing pattern ability.

## Rewards

Victory grants strong Floor 2 completion rewards: XP, gold, a convergence relic, and a large potion. The victory text should clearly mark Floor 2 as completed and the boss as a shared endpoint rather than a lane-specific enemy.

## Testing

Tests should cover the boss data shape, lane marker items, reward item definitions, and runtime combat modifier behavior.

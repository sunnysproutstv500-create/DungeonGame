# Floor 2 Path 1 Design

## Summary

Floor 2 Path 1 expands the red-door lane into an exploratory route with small forks and optional side rooms before the shared Floor 2 boss. This lane should feel different from the future Path 2 gauntlet and the future Path 3 route.

## Lane Identity

Path 1 is the exploration/resource lane. It rewards scouting, perception, and calculated detours. It should include optional rooms with loot, lore, and risk, while still allowing a player to stay on the main route and reach the boss.

Future lane identities:

- Path 2 should become the direct gauntlet: more linear, combat-heavy, and attritional.
- Path 3 should become a distinct third style, not another combat gauntlet or another small-fork exploration path.

## Room Layout

Path 1 contains ten rooms before the shared boss:

1. `floor2_red_door` - lane entry, safe room is locked behind the player.
2. `floor2_pressure_gallery` - required hazard introduction.
3. `floor2_broken_checkpoint` - required checkpoint with a combat or bypass feel.
4. `floor2_observation_nest` - optional side room for lore/perception reward.
5. `floor2_supply_fault` - optional side room with consumables or gold and a trap risk.
6. `floor2_service_crawl` - required forward route with a resource check.
7. `floor2_rival_cache` - optional side room with upgraded loot or a warning.
8. `floor2_split_conduit` - required fork: safer longer route or dangerous shortcut.
9. `floor2_gatehouse` - required pre-boss combat/checkpoint room.
10. `floor2_boss_antechamber` - final preparation room.

After the antechamber, Path 1 enters `floor2_shared_boss`.

## One-Way Safe Room Rule

No Path 1 room should provide a choice back to `floor2_safe_room`. Path 1 rooms can branch and reconnect within the lane, but the safe room remains impossible to reenter once the player leaves.

## Boss Convergence

All Floor 2 lanes should eventually converge on `floor2_shared_boss`. Path 1 reaches it now through `floor2_boss_antechamber`; Path 2 and Path 3 can be expanded later while preserving that shared endpoint.

## Testing

Tests should verify:

- Path 1 has ten unique rooms before `floor2_shared_boss`.
- Path 1 includes optional side rooms.
- Path 1 exits never lead back to `floor2_safe_room`.
- Path 1 reaches `floor2_shared_boss`.
- The blue and black lanes still route toward the same shared boss endpoint until they are expanded.

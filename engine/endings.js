'use strict';

const LINE = '█'.repeat(60);

// Determine ending type from player state after floor 10
function determineEnding(player) {
  // Secret: never fled + focus ring relic + world rank 1
  const hasRing = (player.relics || []).includes('focus ring') ||
                  (player.inventory || []).includes('focus ring');
  if (player.neverFled && hasRing && player.worldRank <= 1) {
    return 'secret';
  }
  const rank = player.worldRank || 6;
  if (rank <= 2) return 'good';
  if (rank <= 4) return 'slave';
  return 'extermination';
}

function showEnding(type) {
  console.log('\n' + LINE);

  if (type === 'good') {
    console.log('  ENDING: EARTH SAVED  —  RANK 1-2');
    console.log(LINE);
    console.log(`
  The final calculations complete across all ten floors.
  The Overseers render their judgment.

  Earth ranks within the top two competing worlds.

  "World-Earth: Survival Classification. Full autonomy retained."

  You walk out of the dungeon into a sky that still belongs to your world.
  The signal reaches home before you do.
  Seven billion people learn they will see tomorrow.

  You were Earth's last hope.
  You were enough.
`);

  } else if (type === 'slave') {
    console.log('  ENDING: EARTH ENSLAVED  —  RANK 3-4');
    console.log(LINE);
    console.log(`
  The Overseers complete their assessment.
  Earth places 3rd or 4th — not destroyed, but not free.

  "World-Earth: Production Classification.
   Resource extraction and labor protocols begin immediately."

  You survived the dungeon. Earth survived the culling.
  But survival has a price.

  Within the year, the infrastructure arrives.
  Earth becomes a supplier world — alive, but in chains.

  You fought hard enough to live.
  Not hard enough to be free.
`);

  } else if (type === 'extermination') {
    console.log('  ENDING: EARTH DESTROYED  —  RANK 5-10');
    console.log(LINE);
    console.log(`
  The Overseers finalize the rankings.
  Earth does not place in the top four.

  "World-Earth: Harvest Classification.
   Termination sequence initiated. Resources to be reclaimed."

  You feel it through the dimensional link —
  a tremor, then nothing. The connection to home goes dark.

  You won your fight.
  You cleared the dungeon.
  Earth lost the competition.

  Some victories are not enough.
`);

  } else if (type === 'secret') {
    console.log('  ENDING: SYSTEM BREACH  —  SECRET');
    console.log(LINE);
    console.log(`
  Something went wrong for the Overseers.
  Or right — depending on who you ask.

  You never ran. You carried a fragment of something older than the competition.
  Your performance didn't just win — it exposed fault lines in the framework.

  The competition's logic collapses mid-calculation.
  The ranking system freezes. The Overseers' broadcast cuts to static.

  No terminations. No enslavements. No harvest.
  The machine stops.

  Ten worlds. Unknown fates. But the machine that judged them is broken.
  For now — that is enough.
`);
  }

  console.log(LINE);
  console.log('\n  Thanks for playing TRIAL OF TEN WORLDS\n');
}

module.exports = { showEnding, determineEnding };

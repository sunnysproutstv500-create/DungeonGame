'use strict';

const MAX_IMPLEMENTED_FLOOR = 2;

function ensureRunStats(player) {
  if (!player.runStats) {
    player.runStats = {
      floorsCleared: 0,
      enemiesDefeated: 0,
      relicsFound: [],
      endingReached: null,
      rankAchieved: null,
    };
  }
  if (!Array.isArray(player.runStats.relicsFound)) player.runStats.relicsFound = [];
  if (player.runStats.floorsCleared === undefined) player.runStats.floorsCleared = 0;
  if (player.runStats.enemiesDefeated === undefined) player.runStats.enemiesDefeated = 0;
  return player.runStats;
}

function trackRelicFound(player, itemId) {
  if (!itemId) return;
  const stats = ensureRunStats(player);
  if (!stats.relicsFound.includes(itemId)) stats.relicsFound.push(itemId);
}

function completeFloor(player, options = {}) {
  const stats = ensureRunStats(player);
  const completedFloor = player.floor || 1;
  const healRatio = options.healRatio ?? 0.25;
  const healAmount = Math.floor((player.maxHp || 0) * healRatio);
  const currencyReward = options.currencyReward ?? completedFloor * 15;

  stats.floorsCleared += 1;
  stats.lastCompletedRoute = options.route || 'unknown';
  stats.lastCompletedFloor = completedFloor;

  player.floorComplete = true;
  player.pendingTransition = {
    fromFloor: completedFloor,
    toFloor: completedFloor + 1,
    route: stats.lastCompletedRoute,
    currencyReward,
  };

  player.floor = completedFloor + 1;
  player.hp = Math.min(player.maxHp, player.hp + healAmount);
  player.usedChoices = {};
  player.clearedRooms = {};
  player.statusEffects = [];

  return {
    completedFloor,
    nextFloor: player.floor,
    healAmount,
    currencyReward,
    route: stats.lastCompletedRoute,
  };
}

function getRunSummary(player, options = {}) {
  const stats = ensureRunStats(player);
  const rank = player.worldRank || stats.rankAchieved || 'Unranked';
  return {
    reason: options.reason || 'ended',
    floorsCleared: stats.floorsCleared || 0,
    enemiesDefeated: stats.enemiesDefeated || 0,
    relicsFound: [...(stats.relicsFound || [])],
    endingReached: options.endingReached || stats.endingReached || 'Run ended',
    rankAchieved: rank,
  };
}

function resetRunState(player) {
  player.currentRunActive = false;
  player.runEnded = true;
  player.floorComplete = false;
  player.pendingTransition = null;
  player.hp = Math.max(0, player.hp || 0);
  player.inventory = [];
  player.equipment = {
    weapon: null,
    armor: null,
    trinket: null,
  };
  player.usedChoices = {};
  player.clearedRooms = {};
  player.mapData = {};
  player.statusEffects = [];
}

function endRun(player, options = {}) {
  const summary = getRunSummary(player, options);
  player.runStats = {
    floorsCleared: summary.floorsCleared,
    enemiesDefeated: summary.enemiesDefeated,
    relicsFound: summary.relicsFound,
    endingReached: summary.endingReached,
    rankAchieved: summary.rankAchieved,
  };
  resetRunState(player);
  return summary;
}

function formatRunSummary(summary) {
  const relics = summary.relicsFound.length > 0 ? summary.relicsFound.join(', ') : 'None';
  return [
    '',
    '='.repeat(60),
    '  RUN SUMMARY',
    '='.repeat(60),
    `  Floors cleared: ${summary.floorsCleared}`,
    `  Enemies defeated: ${summary.enemiesDefeated}`,
    `  Relics found: ${relics}`,
    `  Ending reached: ${summary.endingReached}`,
    `  Rank achieved: ${summary.rankAchieved}`,
    '='.repeat(60),
    '',
  ].join('\n');
}

function formatFloorTransition(result) {
  return [
    '',
    '='.repeat(60),
    `  FLOOR ${result.completedFloor} CLEARED`,
    '='.repeat(60),
    '  The elevator descends deeper into the dungeon...',
    `  +${result.healAmount} HP recovered between floors.`,
    `  Floor ${result.nextFloor} waits below.`,
    '='.repeat(60),
    '',
  ].join('\n');
}

module.exports = {
  MAX_IMPLEMENTED_FLOOR,
  ensureRunStats,
  trackRelicFound,
  completeFloor,
  endRun,
  getRunSummary,
  formatRunSummary,
  formatFloorTransition,
};

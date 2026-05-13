const DEFAULT_ABILITIES = [
  {
    id: 'power_strike',
    name: 'Power Strike',
    type: 'damage_bonus',
    value: 5,
    cooldown: 2,
    currentCooldown: 0,
  },
  {
    id: 'guard',
    name: 'Guard',
    type: 'damage_reduce',
    value: 0.5,
    cooldown: 3,
    currentCooldown: 0,
  },
];

function createPlayer(name) {
  return {
    name,
    hp: 100,
    maxHp: 100,
    attack: 15,
    defense: 5,
    level: 1,
    xp: 0,
    xpToNext: 10,
    gold: 0,
    inventory: [],
    equipment: {
      weapon: null,
      armor: null,
      trinket: null,
    },
    usedChoices: {},
    statusEffects: [],
    perception: 0,
    abilities: DEFAULT_ABILITIES.map(a => ({ ...a })),
    floor: 1,
    worldRank: 5,
    runScore: 0,
    relics: [],
    neverFled: true,
    clearedRooms: {},
    mapData: {},
    currentRunActive: true,
    runEnded: false,
    floorComplete: false,
    pendingTransition: null,
    runStats: {
      floorsCleared: 0,
      enemiesDefeated: 0,
      relicsFound: [],
      endingReached: null,
      rankAchieved: null,
    },
  };
}

function gainXP(player, amount) {
  player.xp += amount;
  console.log(`  +${amount} XP`);
  while (player.xp >= player.xpToNext) {
    levelUp(player);
  }
}

function levelUp(player) {
  player.xp -= player.xpToNext;
  player.level += 1;
  player.xpToNext += 10;
  player.maxHp += 5;
  player.attack += 2;
  player.defense += 1;
  player.hp = player.maxHp;
  console.log('\n*** LEVEL UP! ***');
  console.log(`  Level ${player.level} | HP: ${player.maxHp} | ATK: ${player.attack} | DEF: ${player.defense} | Next: ${player.xpToNext} XP`);
}

function showStats(player) {
  const bar = (hp, max) => {
    const filled = Math.round((hp / max) * 10);
    return '[' + '█'.repeat(filled) + '░'.repeat(10 - filled) + ']';
  };
  const perStr = player.perception > 0 ? `  PER: ${player.perception}` : '';
  console.log(`\n  ${player.name} | Lv.${player.level} | HP ${bar(player.hp, player.maxHp)} ${player.hp}/${player.maxHp}`);
  console.log(`  ATK: ${player.attack}  DEF: ${player.defense}  XP: ${player.xp}/${player.xpToNext}  Gold: ${player.gold}g${perStr}`);
  if (player.inventory.length > 0) {
    console.log(`  Inventory: ${player.inventory.join(', ')}`);
  }
}

module.exports = { createPlayer, gainXP, showStats };

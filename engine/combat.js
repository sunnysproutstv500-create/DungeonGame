'use strict';
const fs   = require('fs');
const path = require('path');
const { gainXP } = require('./state');
const {
  applyStatus, processStatusEffects,
  getEffAtk, getEffDef,
  isStunned, fmtEffects, clearStatusEffects,
} = require('./statusEffects');

const ITEMS = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/items.json'), 'utf-8'));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function applyCombatAdvantages(enemyData, player) {
  const adjusted = clone(enemyData);
  const inventory = new Set(player?.inventory || []);

  for (const advantage of adjusted.advantages || []) {
    if (!inventory.has(advantage.item)) continue;
    if (advantage.message) console.log(`  ${advantage.message}`);
    if (advantage.hpDelta) adjusted.hp = Math.max(1, (adjusted.hp || 1) + advantage.hpDelta);
    if (advantage.attackDelta) adjusted.attack = Math.max(1, (adjusted.attack || 1) + advantage.attackDelta);
    if (advantage.defenseDelta) adjusted.defense = Math.max(0, (adjusted.defense || 0) + advantage.defenseDelta);
    if (advantage.removeAbilities?.length) {
      const removals = new Set(advantage.removeAbilities);
      adjusted.abilities = (adjusted.abilities || []).filter(id => !removals.has(id));
      adjusted.phases = (adjusted.phases || []).map(phase => ({
        ...phase,
        abilities: (phase.abilities || []).filter(id => !removals.has(id)),
      }));
    }
  }

  return adjusted;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function useItem(player, itemId) {
  const item = ITEMS[itemId];
  if (!item) return false;

  if (item.effect === 'heal') {
    const healed = Math.min(player.maxHp - player.hp, item.value);
    player.hp += healed;
    player.inventory.splice(player.inventory.indexOf(itemId), 1);
    console.log(`  You use ${item.name} and restore ${healed} HP. (HP: ${player.hp}/${player.maxHp})`);
    return true;
  }

  if (item.effect === 'cleanse') {
    const before = (player.statusEffects || []).length;
    player.statusEffects = (player.statusEffects || []).filter(
      fx => fx.type !== 'poison' && fx.type !== 'burn'
    );
    const removed = before - player.statusEffects.length;
    player.inventory.splice(player.inventory.indexOf(itemId), 1);
    console.log(`  You use ${item.name}. ${removed > 0 ? '☠️🔥 Poison and burn cleared!' : 'No effects to cleanse.'} (HP: ${player.hp}/${player.maxHp})`);
    return true;
  }

  return false;
}

function abilityDesc(ab) {
  if (ab.type === 'damage_bonus')   return `+${ab.value} damage`;
  if (ab.type === 'damage_reduce')  return `reduce damage taken`;
  if (ab.type === 'berserk')        return `+${ab.value} dmg, costs ${ab.hpCost} HP`;
  if (ab.type === 'heal')           return `restore ${ab.value} HP`;
  if (ab.type === 'status_attack') {
    const s = ab.status ? ` + ${ab.status.type}(${ab.status.duration}t)` : '';
    return `+${ab.damage || 0} dmg${s}`;
  }
  return ab.type;
}

// Damage roll using effective ATK / DEF from statusEffects.
function rollDamage(attacker, defender) {
  const atk  = getEffAtk(attacker);
  const def  = getEffDef(defender);
  const base = Math.max(1, atk - def);
  const roll = Math.floor(Math.random() * 6) - 2; // -2..+3
  return Math.max(1, base + roll);
}

// Terminal HP bar.
function renderBar(hp, max, width) {
  const filled = Math.round(Math.max(0, hp) / Math.max(1, max) * width);
  return '[' + '█'.repeat(Math.min(filled, width)) + '░'.repeat(Math.max(0, width - filled)) + ']';
}

// ── Enemy ability table ────────────────────────────────────────────────────

const ENEMY_ABILITIES = {
  // Regular
  shiv_stab:      { mult: 1.5,  msg: 'stabs with a rusty shiv' },
  dodge:          { mult: 0,    msg: 'dodges nimbly — no attack' },
  quick_strike:   { mult: 1.4,  msg: 'lands a quick bonus strike' },
  frenzy:         { mult: 2.0,  msg: 'attacks in a wild frenzy' },
  bone_armor:     { mult: 0,    msg: 'hardens its bone armor — no attack' },
  shield_bash:    { mult: 0.75, msg: 'bashes with a shield' },
  cleave:         { mult: 1.5,  msg: 'cleaves through your guard' },
  battle_roar:    { mult: 1.3,  msg: 'roars and charges forward' },
  shield_up:      { effect: 'shield',      msg: 'raises its shield — your next hit is reduced' },
  heavy_hit:      { mult: 1.7,             msg: 'winds up and strikes with full force' },
  // Boss — phase abilities
  enraged_strike: { mult: 2.0,             msg: 'unleashes a devastating enraged strike' },
  armor_break:    { effect: 'defenseDown', msg: 'shatters your guard — DEF reduced for 2 turns' },
  sweeping_attack:{ effect: 'sweep', fixed: 15, msg: 'sweeps the room — unavoidable' },
  // Status-applying abilities
  poison_hit:     { effect: 'applyStatus', status: { type: 'poison',      duration: 3, value: 2 }, mult: 0.8, msg: 'lands a venomous blow' },
  burning_strike: { effect: 'applyStatus', status: { type: 'burn',        duration: 2, value: 3 }, mult: 0.8, msg: 'strikes with a burning weapon' },
  crushing_blow:  { effect: 'applyStatus', status: { type: 'defenseDown', duration: 2, value: 3 }, mult: 1.2, msg: 'delivers a crushing blow' },
};

function applyAbility(enemy, player, id, playerDefending) {
  const ab    = ENEMY_ABILITIES[id] || { mult: 1.0, msg: 'uses an ability' };
  const label = id.replace(/_/g, ' ');

  if (ab.effect === 'shield') {
    enemy.shieldUp = true;
    console.log(`  ${enemy.name} uses ${label} — your next hit is reduced.`);
    return;
  }

  if (ab.effect === 'defenseDown') {
    applyStatus(player, { type: 'defenseDown', duration: 2, value: 3 });
    const base = rollDamage(enemy, player);
    const dmg  = Math.max(1, Math.floor(playerDefending ? base * 0.25 : base * 0.5));
    player.hp -= dmg;
    console.log(`  ${enemy.name} uses ${label} for ${dmg} damage — your DEF is reduced for 2 turns!`);
    return;
  }

  if (ab.effect === 'sweep') {
    player.hp -= ab.fixed;
    console.log(`  ${enemy.name} uses ${label} for ${ab.fixed} unavoidable damage!`);
    return;
  }

  if (ab.effect === 'applyStatus') {
    const base = rollDamage(enemy, player);
    const dmg  = Math.max(0, Math.floor(playerDefending ? base * ab.mult / 4 : base * ab.mult));
    if (dmg > 0) player.hp -= dmg;
    applyStatus(player, ab.status);
    const tag = ab.status.type === 'poison' ? '☠️ ' : ab.status.type === 'burn' ? '🔥 ' : '';
    console.log(`  ${enemy.name} uses ${label}${dmg > 0 ? ` for ${dmg} damage` : ''} — ${tag}${ab.status.type}!`);
    return;
  }

  // Standard multiplier
  const base = rollDamage(enemy, player);
  const dmg  = Math.max(0, Math.floor(playerDefending ? base * ab.mult / 4 : base * ab.mult));
  if (dmg > 0) player.hp -= dmg;
  console.log(`  ${enemy.name} uses ${label}${dmg > 0 ? ` for ${dmg} damage` : ' — no effect'}.`);
}

function enemyTurn(enemy, player, enemyData, playerDefending) {
  const type      = enemyData.type || 'aggressive';
  const abilities = enemyData.abilities || [];

  // Offensive abilities: anything except shield and zero-effect (dodge, bone_armor)
  const offAbilities = abilities.filter(id => {
    const ab = ENEMY_ABILITIES[id];
    return ab && ab.effect !== 'shield' && ab.mult !== 0;
  });

  const doAttack = () => {
    const base = rollDamage(enemy, player);
    const dmg  = playerDefending ? Math.max(1, Math.floor(base / 4)) : base;
    player.hp -= dmg;
    console.log(`  ${enemy.name} attacks for ${dmg} damage.`);
  };

  if (type === 'aggressive') {
    if (offAbilities.length > 0 && Math.random() < 0.4) {
      applyAbility(enemy, player, offAbilities[Math.floor(Math.random() * offAbilities.length)], playerDefending);
      return;
    }
    doAttack();
    return;
  }

  if (type === 'defensive') {
    if (Math.random() < 0.5) {
      if (abilities.includes('shield_up')) {
        applyAbility(enemy, player, 'shield_up', playerDefending);
      } else {
        console.log(`  ${enemy.name} takes a defensive stance and holds back.`);
      }
      return;
    }
    doAttack();
    return;
  }

  if (type === 'trickster' && abilities.length > 0 && Math.random() < 0.5) {
    applyAbility(enemy, player, abilities[Math.floor(Math.random() * abilities.length)], playerDefending);
    return;
  }

  doAttack();
}

// ── Combat display ─────────────────────────────────────────────────────────

function displayState(player, enemy, curPhase, phaseIndex, isBoss) {
  if (isBoss) {
    const phaseLabel = curPhase.phaseName || `Phase ${phaseIndex + 1}`;
    console.log(`\n  ─── Phase ${phaseIndex + 1}: ${phaseLabel} ───`);
    console.log(`  ${enemy.name.padEnd(16)} ${renderBar(enemy.hp, enemy.maxHp, 14)} ${enemy.hp}/${enemy.maxHp}`);
    const eFx = fmtEffects(enemy);
    if (eFx) console.log(`    Enemy effects:  ${eFx}`);
    console.log(`  ${'You'.padEnd(16)} ${renderBar(player.hp, player.maxHp, 14)} ${player.hp}/${player.maxHp}`);
    const pFx = fmtEffects(player);
    if (pFx) console.log(`    Your effects:   ${pFx}`);
  } else {
    console.log(`\n  Your HP: ${player.hp}/${player.maxHp}   ${enemy.name} HP: ${enemy.hp}/${enemy.maxHp}`);
    const pFx = fmtEffects(player);
    if (pFx) console.log(`  Your effects: ${pFx}`);
    const eFx = fmtEffects(enemy);
    if (eFx) console.log(`  ${enemy.name} effects: ${eFx}`);
  }
}

// ── Phase transition ───────────────────────────────────────────────────────

function doPhaseTransition(enemy, player, phases, phaseIndex, curPhaseRef) {
  const next = phases[phaseIndex];
  enemy.hp      = next.hp;
  enemy.maxHp   = next.hp;
  enemy.attack  = next.attack;
  enemy.defense = next.defense;
  enemy.shieldUp = false;
  clearStatusEffects(enemy);
  clearStatusEffects(player); // mercy: clean slate for each phase
  curPhaseRef.value = next;
  console.log('\n' + '═'.repeat(60));
  console.log(`  ${next.intro || `Phase ${phaseIndex + 1} begins!`}`);
  console.log('═'.repeat(60) + '\n');
}

// ── Main combat loop ───────────────────────────────────────────────────────

function runCombat(player, enemyData, prompt) {
  if (!player.statusEffects) player.statusEffects = [];

  const combatData = applyCombatAdvantages(enemyData, player);
  const phases   = combatData.phases ? [...combatData.phases] : [];
  const isBoss   = phases.length > 0;
  let phaseIndex = 0;
  const curPhase = { value: combatData }; // mutable ref so doPhaseTransition can update it

  const enemy = {
    name:       combatData.name,
    hp:         combatData.hp,
    maxHp:      combatData.hp,
    attack:     combatData.attack,
    defense:    combatData.defense,
    xpReward:   combatData.xp,
    goldReward: combatData.goldReward,
    shieldUp:   false,
    statusEffects: [],
  };

  // ── Header ──
  if (isBoss) {
    console.log('\n' + '█'.repeat(60));
    console.log(`  ⚔  BOSS FIGHT: ${enemy.name}  ⚔`);
    if (combatData.intro) console.log(`\n  ${combatData.intro}`);
    console.log('█'.repeat(60));
  } else {
    console.log('\n' + '!'.repeat(60));
    console.log(`  COMBAT: ${player.name}  vs  ${enemy.name}`);
    console.log(`  Enemy — HP: ${enemy.hp} | ATK: ${enemy.attack} | DEF: ${enemy.defense}`);
    console.log('!'.repeat(60));
  }

  // ── Main loop ──
  while (player.hp > 0 && enemy.hp > 0) {

    // 1. Note stun state BEFORE ticking (so duration-1 stun still skips this turn)
    const playerStunned = isStunned(player);
    const enemyStunned  = isStunned(enemy);

    // 2. Process DOT effects (poisons, burns — also decrements all durations)
    processStatusEffects(player, 'You');
    if (player.hp <= 0) break;

    processStatusEffects(enemy, enemy.name);
    if (enemy.hp <= 0) {
      if (phaseIndex < phases.length) {
        doPhaseTransition(enemy, player, phases, phaseIndex++, curPhase);
        continue;
      }
      break;
    }

    // 3. Display
    displayState(player, enemy, curPhase.value, phaseIndex, isBoss);

    // 4. Player turn
    let defending = false;

    if (playerStunned) {
      console.log('  ⚡ You are STUNNED and cannot act this turn!');
    } else {
      console.log('  1) Attack  2) Defend  3) Use Item  4) Use Ability  5) Flee');
      const choice = prompt('  > ') ?? '';

      if (choice === '2') {
        defending = true;
        console.log('  You brace for impact. (Incoming damage heavily reduced this turn.)');

      } else if (choice === '3') {
        if (player.inventory.length === 0) {
          console.log('  Your inventory is empty!');
        } else {
          console.log('  Inventory:');
          player.inventory.forEach((id, i) => {
            const item  = ITEMS[id];
            const label = item ? `${item.name} (${item.effect}${item.value > 0 ? ' +' + item.value : ''})` : id;
            console.log(`    ${i + 1}) ${label}`);
          });
          console.log('    0) Cancel');
          const itemInput = prompt('  > ') ?? '';
          const itemIdx   = parseInt(itemInput, 10) - 1;
          if (itemIdx >= 0 && itemIdx < player.inventory.length) {
            const used = useItem(player, player.inventory[itemIdx]);
            if (!used) console.log('  That item has no effect here.');
          } else if (itemInput !== '0') {
            console.log('  Invalid choice.');
          }
        }

      } else if (choice === '4') {
        const abilities = player.abilities || [];
        if (abilities.length === 0) {
          console.log('  You have no abilities.');
        } else {
          console.log('  Abilities:');
          abilities.forEach((ab, i) => {
            const status = ab.currentCooldown > 0 ? `cooldown: ${ab.currentCooldown}` : 'ready';
            console.log(`    ${i + 1}) ${ab.name}  — ${abilityDesc(ab)}  [${status}]`);
          });
          console.log('    0) Cancel');
          const abInput = prompt('  > ') ?? '';
          const abIdx   = parseInt(abInput, 10) - 1;
          if (abIdx >= 0 && abIdx < abilities.length) {
            const ability = abilities[abIdx];
            if (ability.currentCooldown > 0) {
              console.log(`  ${ability.name} is on cooldown for ${ability.currentCooldown} more turn(s).`);
            } else if (ability.type === 'damage_bonus') {
              let dmg = rollDamage(player, enemy) + ability.value;
              if (enemy.shieldUp) { dmg = Math.floor(dmg / 2); enemy.shieldUp = false; console.log('  The shield absorbs half the blow!'); }
              enemy.hp -= dmg;
              ability.currentCooldown = ability.cooldown;
              console.log(`  ${ability.name}! You hit ${enemy.name} for ${dmg} damage.`);
            } else if (ability.type === 'damage_reduce') {
              defending = true;
              ability.currentCooldown = ability.cooldown;
              console.log(`  You activate ${ability.name}! (incoming damage heavily reduced)`);
            } else if (ability.type === 'berserk') {
              const cost = Math.min(ability.hpCost, player.hp - 1);
              player.hp -= cost;
              let dmg = rollDamage(player, enemy) + ability.value;
              if (enemy.shieldUp) { dmg = Math.floor(dmg / 2); enemy.shieldUp = false; console.log('  The shield absorbs half the blow!'); }
              enemy.hp -= dmg;
              ability.currentCooldown = ability.cooldown;
              console.log(`  ${ability.name}! You pay ${cost} HP and slam ${enemy.name} for ${dmg} damage.`);
            } else if (ability.type === 'heal') {
              const healed = Math.min(ability.value, player.maxHp - player.hp);
              player.hp += healed;
              ability.currentCooldown = ability.cooldown;
              console.log(`  ${ability.name}! You recover ${healed} HP. (HP: ${player.hp}/${player.maxHp})`);
            } else if (ability.type === 'status_attack') {
              let dmg = rollDamage(player, enemy) + (ability.damage || 0);
              if (enemy.shieldUp) { dmg = Math.floor(dmg / 2); enemy.shieldUp = false; console.log('  The shield absorbs half the blow!'); }
              enemy.hp -= dmg;
              ability.currentCooldown = ability.cooldown;
              console.log(`  ${ability.name}! You hit ${enemy.name} for ${dmg} damage.`);
              if (ability.status) {
                applyStatus(enemy, ability.status);
                const tag = ability.status.type === 'poison'      ? '☠️ ' :
                            ability.status.type === 'burn'         ? '🔥 ' :
                            ability.status.type === 'defenseDown'  ? '🛡️ ' : '';
                console.log(`  ${enemy.name} is now ${tag}${ability.status.type}!`);
              }
            }
          } else if (abInput !== '0') {
            console.log('  Invalid choice.');
          }
        }

      } else if (choice === '5') {
        if (Math.random() > 0.4) {
          console.log('  You flee successfully!');
          clearStatusEffects(player);
          return 'fled';
        }
        console.log('  You failed to flee!');

      } else {
        // Default: attack
        let dmg = rollDamage(player, enemy);
        if (enemy.shieldUp) { dmg = Math.floor(dmg / 2); enemy.shieldUp = false; console.log('  The shield absorbs half the blow!'); }
        enemy.hp -= dmg;
        const crit = dmg > (getEffAtk(player) - getEffDef(enemy) + 1);
        console.log(`  You strike ${enemy.name} for ${dmg} damage.${crit ? ' Critical hit!' : ''}`);
      }
    } // end player turn

    // 5. Phase transition check after player attack
    if (enemy.hp <= 0) {
      if (phaseIndex < phases.length) {
        doPhaseTransition(enemy, player, phases, phaseIndex++, curPhase);
        continue;
      }
      break;
    }

    // 6. Enemy turn (skip if stunned)
    if (enemyStunned) {
      console.log(`  ⚡ ${enemy.name} is STUNNED and cannot act!`);
    } else {
      enemyTurn(enemy, player, curPhase.value, defending);
    }

    // 7. Tick player cooldowns
    (player.abilities || []).forEach(ab => { if (ab.currentCooldown > 0) ab.currentCooldown--; });

  } // end while

  // ── Defeat ──
  if (player.hp <= 0) {
    player.hp = 0;
    clearStatusEffects(player);
    console.log('\n  You have been defeated...');
    return 'defeat';
  }

  // ── Victory ──
  clearStatusEffects(player);
  console.log('\n' + '!'.repeat(60));
  console.log(`  Victory! ${enemy.name} has been defeated.`);
  if (isBoss && combatData.victoryText) {
    console.log(`\n  ${combatData.victoryText}`);
  }
  console.log('!'.repeat(60));

  gainXP(player, enemy.xpReward);
  player.gold += enemy.goldReward;
  console.log(`  +${enemy.goldReward} gold`);

  if (combatData.loot && combatData.loot.length > 0) {
    if (isBoss) {
      for (const drop of combatData.loot) {
        player.inventory.push(drop);
        console.log(`  Obtained: ${drop}`);
      }
    } else {
      const drop = combatData.loot[Math.floor(Math.random() * combatData.loot.length)];
      player.inventory.push(drop);
      console.log(`  ${enemy.name} dropped: ${drop}`);
    }
  }

  return 'victory';
}

module.exports = { runCombat };

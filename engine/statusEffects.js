'use strict';

/**
 * Shared status-effect helpers used by both combat.js and sceneRunner.js.
 * Effects never permanently modify stats — they are read by getEffAtk/getEffDef.
 */

// Add or refresh a status effect on a target.
function applyStatus(target, effect) {
  if (!target.statusEffects) target.statusEffects = [];
  const existing = target.statusEffects.find(fx => fx.type === effect.type);
  if (existing) {
    existing.duration = Math.max(existing.duration, effect.duration);
    existing.value    = Math.max(existing.value,    effect.value || 0);
  } else {
    target.statusEffects.push({ type: effect.type, duration: effect.duration, value: effect.value || 0 });
  }
}

// Process all active DOTs, decrement every effect's duration, remove expired.
// Returns total HP damage dealt (for caller to react to hp <= 0).
function processStatusEffects(target, label) {
  if (!target.statusEffects || target.statusEffects.length === 0) return 0;
  let totalDmg = 0;
  const expired = [];

  for (const fx of target.statusEffects) {
    if (fx.type === 'poison') {
      target.hp -= fx.value;
      totalDmg  += fx.value;
      console.log(`  ☠️  Poison deals ${fx.value} damage to ${label}.`);
    } else if (fx.type === 'burn') {
      target.hp -= fx.value;
      totalDmg  += fx.value;
      console.log(`  🔥 Burn deals ${fx.value} damage to ${label}.`);
    }

    fx.duration--;

    if (fx.duration <= 0) {
      expired.push(fx);
      if (fx.type === 'stun')        console.log(`  ⚡ Stun wears off (${label}).`);
      if (fx.type === 'weaken')      console.log(`  ${label}: Weakness fades.`);
      if (fx.type === 'defenseDown') console.log(`  ${label}: Defense restored.`);
      if (fx.type === 'poison')      console.log(`  ☠️  Poison fades (${label}).`);
      if (fx.type === 'burn')        console.log(`  🔥 Burn fades (${label}).`);
    }
  }

  if (expired.length > 0) {
    const expSet = new Set(expired);
    target.statusEffects = target.statusEffects.filter(fx => !expSet.has(fx));
  }

  return totalDmg;
}

// Effective ATK accounting for weaken.
function getEffAtk(target) {
  let atk = target.attack || 0;
  for (const fx of (target.statusEffects || [])) {
    if (fx.type === 'weaken') atk = Math.max(1, atk - fx.value);
  }
  return atk;
}

// Effective DEF accounting for defenseDown.
function getEffDef(target) {
  let def = target.defense || 0;
  for (const fx of (target.statusEffects || [])) {
    if (fx.type === 'defenseDown') def = Math.max(0, def - fx.value);
  }
  return def;
}

// Returns true if the target has an active stun effect.
function isStunned(target) {
  return (target.statusEffects || []).some(fx => fx.type === 'stun');
}

// Format active effects for display, e.g. "poison(2) defenseDown(1)".
function fmtEffects(target) {
  const active = (target.statusEffects || []).filter(fx => fx.duration > 0);
  if (active.length === 0) return null;
  return active.map(fx => `${fx.type}(${fx.duration})`).join(' ');
}

// Remove all effects — call at end of combat or on phase transition.
function clearStatusEffects(target) {
  target.statusEffects = [];
}

module.exports = {
  applyStatus, processStatusEffects,
  getEffAtk, getEffDef,
  isStunned, fmtEffects, clearStatusEffects,
};

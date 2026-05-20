const React = require('react');
const { useEffect, useMemo, useState } = React;
const {
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} = require('react-native');

const runtime = require('../engine/runtime');
const metaCore = require('../engine/metaCore');
const saveStore = require('./saveStore');

const CHOICE_RISK_PREFIX = 'Risk:';
const CHOICE_REWARD_PREFIX = 'Reward:';

const STITCH_THEME = {
  background: '#0d0f0c',
  surface: '#151714',
  surfaceHigh: '#1e201d',
  surfaceHighest: '#333532',
  primary: '#f2ca50',
  primaryDim: '#d4af37',
  onPrimary: '#3c2f00',
  text: '#f2f0ea',
  muted: '#d0c5af',
  outline: '#4d4635',
  danger: '#8b1a12',
};

function Stat({ label, value }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function TrialTopBar({ title, player, meta }) {
  return (
    <View style={styles.trialTopBar}>
      <View style={styles.trialTitleBlock}>
        <Text style={styles.trialIcon}>◉</Text>
        <Text style={styles.trialTitle}>{title}</Text>
      </View>
      <View style={styles.trialMetaBlock}>
        <View style={styles.trialMetaColumn}>
          <Text style={styles.trialMetaLabel}>{player?.name || 'EARTH-001'}</Text>
          <Text style={styles.trialMetaValue}>LVL {player?.level || 1}</Text>
        </View>
        <View style={styles.trialDivider} />
        <View style={styles.trialMetaColumn}>
          <Text style={styles.trialMetaLabel}>ECHOES</Text>
          <Text style={styles.trialEchoValue}>◇ {meta?.currency || 0}</Text>
        </View>
      </View>
    </View>
  );
}

function HpVitalityBar({ player }) {
  const maxHp = Math.max(1, player?.maxHp || 1);
  const hp = Math.max(0, player?.hp || 0);
  const pct = Math.max(0, Math.min(100, Math.round((hp / maxHp) * 100)));
  return (
    <View style={styles.hpPanel}>
      <View style={styles.hpHeader}>
        <Text style={styles.hpLabel}>HP VITALITY</Text>
        <Text style={styles.hpValue}>{hp}/{maxHp}</Text>
      </View>
      <View style={styles.hpTrack}>
        <View style={[styles.hpFill, { width: `${pct}%` }]} />
      </View>
    </View>
  );
}

function BottomTrialNav({ active = 'Scene' }) {
  const tabs = [
    ['Scene', '☷'],
    ['Inventory', '▣'],
    ['Map', '◉'],
    ['Upgrades', '✧'],
  ];
  return (
    <View style={styles.bottomTrialNav}>
      {tabs.map(([label, icon]) => {
        const selected = label === active;
        return (
          <View key={label} style={[styles.navTab, selected && styles.activeNavTab]}>
            <Text style={[styles.navIcon, selected && styles.activeNavText]}>{icon}</Text>
            <Text style={[styles.navLabel, selected && styles.activeNavText]}>{label}</Text>
          </View>
        );
      })}
    </View>
  );
}

function SceneArtwork({ label }) {
  return (
    <View style={styles.sceneArtwork}>
      <Text style={styles.sceneArtworkIcon}>▧</Text>
      <Text style={styles.sceneArtworkLabel}>{label}</Text>
    </View>
  );
}

function countColiseumWins(player) {
  return (player?.inventory || []).filter(itemId => /^f10_win_\d+$/.test(itemId)).length;
}

function ColiseumRecord({ player }) {
  const wins = Math.min(10, countColiseumWins(player));
  return (
    <View style={styles.coliseumRecord}>
      <View style={styles.coliseumHeader}>
        <Text style={styles.coliseumLabel}>COLISEUM RECORD</Text>
        <Text style={styles.coliseumValue}>{wins} / 10 WINS</Text>
      </View>
      <View style={styles.coliseumPips}>
        {Array.from({ length: 10 }).map((_, index) => (
          <View key={index} style={[styles.coliseumPip, index < wins && styles.filledColiseumPip]}>
            <Text style={[styles.coliseumPipText, index < wins && styles.filledColiseumPipText]}>
              {index === 9 ? '⌂' : '○'}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function ActionButton({ label, onPress, tone = 'primary', disabled = false }) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        tone === 'secondary' && styles.secondaryButton,
        disabled && styles.disabledButton,
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          tone === 'secondary' && styles.secondaryButtonText,
          disabled && styles.disabledButtonText,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function PlayerStrip({ player }) {
  return (
    <View style={styles.statsBand}>
      <View style={styles.playerIdentity}>
        <Text style={styles.playerName}>{player.name}</Text>
        <Text style={styles.playerClass}>Lv.{player.level} {player.className || 'Adventurer'}</Text>
      </View>
      <View style={styles.playerStats}>
        <Stat label="HP" value={`${player.hp}/${player.maxHp}`} />
        <Stat label="ATK" value={player.attack} />
        <Stat label="DEF" value={player.defense} />
        <Stat label="GOLD" value={player.gold} />
      </View>
    </View>
  );
}

function formatStatus(effect) {
  const duration = effect.duration ? ` ${effect.duration}t` : '';
  const value = effect.value ? ` ${effect.value}` : '';
  return `${effect.type}${duration}${value}`;
}

function StatusRow({ label, effects }) {
  const active = (effects || []).filter(effect => effect.duration === undefined || effect.duration > 0);
  if (active.length === 0) return null;
  return (
    <View style={styles.statusRow}>
      <Text style={styles.statusLabel}>{label}</Text>
      <View style={styles.statusChips}>
        {active.map((effect, index) => (
          <Text key={`${effect.type}-${index}`} style={styles.statusChip}>
            {formatStatus(effect)}
          </Text>
        ))}
      </View>
    </View>
  );
}

function MetaPanel({ meta, onBuyUpgrade }) {
  return (
    <View style={styles.metaPanel}>
      <Text style={styles.metaTitle}>The Echo Archive</Text>
      <Text style={styles.metaText}>Bind Echoes from failed descents into permanent strength.</Text>
      <View style={styles.metaGrid}>
        <Stat label="ECHOES" value={meta.currency} />
        <Stat label="HP+" value={meta.upgrades.hp} />
        <Stat label="ATK+" value={meta.upgrades.atk} />
        <Stat label="DEF+" value={meta.upgrades.def} />
        <Stat label="PER+" value={meta.upgrades.per} />
        <Stat label="RWD+" value={meta.upgrades.rewardMultiplier || 0} />
      </View>
      <Text style={styles.metaText}>
        Unlocked abilities: {meta.unlockedAbilities.length}
      </Text>
      <View style={styles.upgradeList}>
        {metaCore.UPGRADE_DEFS.map(upgrade => (
          <View key={upgrade.stat} style={styles.upgradeRow}>
            <View style={styles.upgradeTextBlock}>
              <Text style={styles.upgradeName}>{upgrade.label}</Text>
              <Text style={styles.upgradeDetail}>
                Owned {meta.upgrades[upgrade.stat] || 0} | Cost {upgrade.cost}
              </Text>
            </View>
            <ActionButton
              label="Buy"
              onPress={() => onBuyUpgrade(upgrade.stat)}
              disabled={meta.currency < upgrade.cost}
              tone="secondary"
            />
          </View>
        ))}
      </View>
    </View>
  );
}

function AbilityUnlockPanel({ meta, options, onBuyAbility }) {
  if (!options.unlocks || options.unlocks.length === 0) return null;
  return (
    <View style={styles.setupPanel}>
      <View style={styles.setupPanelHeader}>
        <Text style={styles.metaTitle}>Ability Unlocks</Text>
        <Text style={styles.setupCount}>{meta.currency} Echoes</Text>
      </View>
      <View style={styles.itemList}>
        {options.unlocks.map(ability => {
          const affordable = meta.currency >= ability.cost;
          const unlockState = ability.owned ? 'Owned' : affordable ? 'Affordable' : 'Locked';
          return (
            <View key={ability.id} style={[styles.abilitySelectRow, ability.owned && styles.selectedAbilityRow]}>
              <View style={styles.itemTextBlock}>
                <View style={styles.itemTitleRow}>
                  <Text style={styles.itemName}>{ability.name}</Text>
                  <Text style={[styles.statePill, ability.owned && styles.ownedPill, affordable && !ability.owned && styles.affordablePill]}>
                    {unlockState}
                  </Text>
                </View>
                <Text style={styles.itemDescription}>
                  {ability.description} Cost {ability.cost}
                </Text>
                <Text style={styles.helperText}>Available in Run Abilities after purchase.</Text>
              </View>
              <ActionButton
                label={ability.owned ? 'Owned' : affordable ? `Buy ${ability.cost}` : `Need ${ability.cost}`}
                onPress={() => onBuyAbility(ability.id)}
                disabled={ability.owned || !affordable}
                tone="secondary"
              />
            </View>
          );
        })}
      </View>
    </View>
  );
}

function RunSetupPanel({ options, selectedAbilityIds, onSelectClass, onToggleAbility }) {
  return (
    <View style={styles.setupPanel}>
      <View style={styles.setupPanelHeader}>
        <Text style={styles.metaTitle}>CHOOSE EARTH'S LOADOUT</Text>
        <Text style={styles.setupCount}>
          {selectedAbilityIds.length}/{options.maxAbilities} abilities
        </Text>
      </View>
      <Text style={styles.helperText}>
        The Overseers do not care what kind of hero Earth wanted. They only record what survives.
      </Text>

      <Text style={styles.sectionLabel}>Earth-001 Discipline</Text>
      <View style={styles.itemList}>
        {options.classes.map(gameClass => (
          <View key={gameClass.id} style={[styles.abilitySelectRow, gameClass.selected && styles.selectedAbilityRow]}>
            <View style={styles.itemTextBlock}>
              <Text style={styles.itemName}>{gameClass.name}</Text>
              <Text style={styles.itemDescription}>{gameClass.description}</Text>
            </View>
            <ActionButton
              label={gameClass.selected ? 'Selected' : 'Select'}
              onPress={() => onSelectClass(gameClass.id)}
              disabled={gameClass.selected}
              tone="secondary"
            />
          </View>
        ))}
      </View>

      <Text style={styles.sectionLabel}>Run Abilities</Text>
      {selectedAbilityIds.length >= options.maxAbilities && (
        <Text style={styles.helperText}>Unequip one ability to equip another.</Text>
      )}
      <View style={styles.itemList}>
        {options.abilities.map(ability => {
          const selected = selectedAbilityIds.includes(ability.id);
          const loadoutFull = !selected && selectedAbilityIds.length >= options.maxAbilities;
          return (
            <View key={ability.id} style={[styles.abilitySelectRow, selected && styles.selectedAbilityRow]}>
              <View style={styles.itemTextBlock}>
                <Text style={styles.itemName}>{ability.name}</Text>
                <Text style={styles.itemDescription}>{ability.description}</Text>
              </View>
              <ActionButton
                label={selected ? 'Equipped' : loadoutFull ? 'Full' : 'Equip'}
                onPress={() => onToggleAbility(ability.id)}
                disabled={loadoutFull}
                tone="secondary"
              />
            </View>
          );
        })}
      </View>
    </View>
  );
}

function EventLog({ events }) {
  if (events.length === 0) return null;
  return (
    <CollapsiblePanel title="Log" count={events.length} initiallyOpen={false}>
      <View style={styles.log}>
      {events.slice(0, 5).map((event, index) => (
        <Text key={`${event.type}-${index}`} style={styles.logLine}>
          {formatEvent(event)}
        </Text>
      ))}
      </View>
    </CollapsiblePanel>
  );
}

function formatEvent(event) {
  if (event.type === 'choice_selected') return `You chose: ${event.text}`;
  if (event.type === 'choice_result') return event.message;
  if (event.type === 'scene_changed') return `Moved to ${event.to}`;
  if (event.type === 'item_gained') return `Gained ${event.itemId}`;
  if (event.type === 'gold_gained') return `Found ${event.amount} gold`;
  if (event.type === 'player_attack') return `You dealt ${event.damage} damage`;
  if (event.type === 'ability_used') {
    const parts = [];
    if (event.damage) parts.push(`${event.damage} damage`);
    if (event.healed) parts.push(`${event.healed} HP`);
    return `${event.name} used${parts.length ? `: ${parts.join(', ')}` : ''}`;
  }
  if (event.type === 'ability_use_failed') return 'Ability is not ready';
  if (event.type === 'enemy_ability') {
    const status = event.status?.type ? ` and applied ${event.status.type}` : '';
    return `${event.enemy} used ${event.name}${event.damage ? ` for ${event.damage} damage` : ''}${status}`;
  }
  if (event.type === 'enemy_attack') return `${event.enemy} dealt ${event.damage} damage`;
  if (event.type === 'combat_pressure') return `Pressure opened you up: +${event.bonusDamage} damage`;
  if (event.type === 'combat_defeat') return `Defeated by ${event.enemy}`;
  if (event.type === 'combat_victory') return `Defeated ${event.enemy}`;
  if (event.type === 'reward_summary') return event.message;
  if (event.type === 'combat_fled') return 'Escaped combat';
  if (event.type === 'item_used' && event.effect === 'heal') return `${event.name} restored ${event.healed} HP`;
  if (event.type === 'item_used' && event.effect === 'cleanse') return `${event.name} removed ${event.removed} effects`;
  if (event.type === 'item_use_failed') return 'Item cannot be used';
  if (event.type === 'item_equipped') return `Equipped ${event.name}`;
  if (event.type === 'equip_failed') return 'Gear cannot be equipped';
  if (event.type === 'gear_trait' && event.bonusDamage) return `${event.name}: +${event.bonusDamage} damage`;
  if (event.type === 'gear_trait' && event.reducedBy) return `${event.name}: reduced damage by ${event.reducedBy}`;
  if (event.type === 'gear_trait' && event.gold) return `${event.name}: +${event.gold} gold`;
  if (event.type === 'gear_trait' && event.traitId === 'flee_bonus') return `${event.name}: improved escape`;
  if (event.type === 'run_ended') return 'Run ended';
  if (event.type === 'floor_completed') return `Floor ${event.completedFloor} cleared`;
  if (event.type === 'meta_awarded') return `Echoes +${event.amount}`;
  if (event.type === 'upgrade_purchased') return `Purchased ${event.stat.toUpperCase()}+`;
  if (event.type === 'ability_unlocked') return `Unlocked ${event.name || event.abilityId}`;
  if (event.type === 'not_enough_currency') return 'Not enough Echoes';
  if (event.type === 'already_unlocked') return 'Ability already unlocked';
  if (event.type === 'ability_not_in_class') return 'Ability is not available for this class';
  if (event.type === 'save_created') return `Saved at ${event.scene}`;
  if (event.type === 'save_loaded') return `Loaded ${event.scene}`;
  return event.type.replace(/_/g, ' ');
}

const OUTCOME_EVENT_TYPES = new Set([
  'choice_result',
  'item_gained',
  'gold_gained',
  'item_used',
  'item_equipped',
  'gear_trait',
  'player_attack',
  'ability_used',
  'enemy_attack',
  'enemy_ability',
  'combat_pressure',
  'combat_victory',
  'reward_summary',
  'combat_fled',
  'combat_defeat',
  'floor_completed',
  'meta_awarded',
  'run_ended',
]);

function OutcomePanel({ events }) {
  const outcomes = (events || [])
    .filter(event => OUTCOME_EVENT_TYPES.has(event.type))
    .slice(0, 3);

  if (outcomes.length === 0) return null;

  return (
    <View style={styles.outcomePanel}>
      <Text style={styles.outcomeTitle}>Recent Result</Text>
      {outcomes.map((event, index) => (
        <Text key={`${event.type}-${index}`} style={styles.outcomeLine}>
          {formatEvent(event)}
        </Text>
      ))}
    </View>
  );
}

function EquipmentPanel({ equipmentItems }) {
  if (!equipmentItems || equipmentItems.length === 0) return null;
  return (
    <CollapsiblePanel title="Equipment" initiallyOpen>
      <View style={styles.equipmentGrid}>
        {equipmentItems.map(item => (
          <View key={item.slot} style={styles.equipmentSlot}>
            <Text style={styles.equipmentSlotLabel}>{item.slot}</Text>
            <Text style={styles.equipmentName}>{item.name}</Text>
            <Text style={styles.itemDescription}>{item.description}</Text>
            {item.traitText ? <Text style={styles.traitText}>{item.traitText}</Text> : null}
          </View>
        ))}
      </View>
    </CollapsiblePanel>
  );
}

function CollapsiblePanel({ title, count, children, initiallyOpen = true }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <View style={styles.utilityPanel}>
      <TouchableOpacity
        accessibilityRole="button"
        onPress={() => setOpen(current => !current)}
        style={styles.utilityHeader}
      >
        <Text style={styles.panelTitle}>{title}{count !== undefined ? ` (${count})` : ''}</Text>
        <Text style={styles.utilityToggle}>{open ? 'Hide' : 'Show'}</Text>
      </TouchableOpacity>
      {open ? children : null}
    </View>
  );
}

function ObjectivePanel({ objective }) {
  if (!objective) return null;
  return (
    <View style={styles.objectivePanel}>
      <View style={styles.objectiveHeader}>
        <Text style={styles.objectiveLabel}>Objective</Text>
        <Text style={[styles.statePill, objective.ready && styles.ownedPill]}>
          {objective.route || 'unknown'}
        </Text>
      </View>
      <Text style={styles.objectiveGoal}>{objective.goal}</Text>
      {objective.missing && objective.missing.length > 0 ? (
        <Text style={styles.objectiveMissing}>Missing: {objective.missing.join(', ')}</Text>
      ) : (
        <Text style={styles.objectiveReady}>Ready to advance</Text>
      )}
    </View>
  );
}

function ContractBadge({ contractProgress }) {
  if (!contractProgress) return null;
  return (
    <View style={styles.contractBadge}>
      <Text style={styles.contractBadgeLabel}>Contracts</Text>
      <Text style={styles.contractBadgeValue}>
        {contractProgress.completed}/{contractProgress.required}
      </Text>
      <Text style={[styles.contractBadgeState, contractProgress.ready && styles.contractBadgeReady]}>
        {contractProgress.ready ? 'Boss portal open' : 'Contracts remaining'}
      </Text>
    </View>
  );
}

function MapProgressPanel({ mapProgress }) {
  const [selectedMapRoomId, setSelectedMapRoomId] = useState(null);
  if (!mapProgress) return null;
  const exploredRooms = (mapProgress.rooms || []).filter(room => room.visited || room.current);
  const currentRoom = exploredRooms.find(room => room.current);
  const selectedMapRoom =
    exploredRooms.find(room => room.id === selectedMapRoomId) ||
    currentRoom ||
    exploredRooms[0] ||
    null;
  const hiddenCount = Math.max(0, (mapProgress.discoveredCount || 0) - exploredRooms.length);
  const tagIcon = tag => {
    if (tag === 'safe') return 'S';
    if (tag === 'boss') return 'B';
    if (tag === 'combat') return '!';
    if (tag === 'treasure') return '$';
    if (tag === 'secret') return '?';
    return '*';
  };
  return (
    <CollapsiblePanel title="Map" count={`${mapProgress.visitedCount}/${mapProgress.totalRooms}`} initiallyOpen={false}>
      <View style={styles.mapSummary}>
        <Text style={styles.mapSummaryText}>Current: {mapProgress.currentRoom}</Text>
        <Text style={styles.mapSummaryText}>
          Explored {exploredRooms.length}/{mapProgress.totalRooms} | Hidden {hiddenCount}
        </Text>
      </View>
      <View style={styles.mapNodeCanvas}>
        {exploredRooms.map(room => {
          const selected = selectedMapRoom?.id === room.id;
          return (
            <TouchableOpacity
              accessibilityRole="button"
              key={room.id}
              onPress={() => setSelectedMapRoomId(room.id)}
              style={[
                styles.mapNode,
                room.current && styles.currentMapNode,
                room.cleared && styles.clearedMapNode,
                selected && styles.selectedMapNode,
              ]}
            >
              <Text style={styles.mapNodeIcon}>{tagIcon(room.tag)}</Text>
              <Text style={styles.mapNodeName}>{room.shortName}</Text>
              <Text style={styles.mapNodeMeta}>{room.current ? 'Here' : room.cleared ? 'Cleared' : room.tag}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {selectedMapRoom && (
        <View style={styles.mapDetailPanel}>
          <View style={styles.mapDetailHeader}>
            <Text style={styles.mapDetailTitle}>{selectedMapRoom.name}</Text>
            <Text style={styles.mapDetailPill}>{selectedMapRoom.current ? 'Current' : selectedMapRoom.cleared ? 'Cleared' : selectedMapRoom.tag}</Text>
          </View>
          <Text style={styles.mapDetailLine}>Type: {selectedMapRoom.tag}</Text>
          <Text style={styles.mapDetailLine}>Known connections:</Text>
          <View style={styles.mapChipRow}>
            {(selectedMapRoom.knownConnections || []).length > 0 ? (
              selectedMapRoom.knownConnections.map(connection => (
                <Text key={connection.id} style={styles.mapChip}>{connection.shortName}</Text>
              ))
            ) : (
              <Text style={styles.mapMutedText}>None explored yet</Text>
            )}
          </View>
          <Text style={styles.mapDetailLine}>Known rewards:</Text>
          <View style={styles.mapChipRow}>
            {(selectedMapRoom.knownRewards || []).length > 0 ? (
              selectedMapRoom.knownRewards.map(reward => (
                <Text key={reward} style={styles.mapChip}>{reward}</Text>
              ))
            ) : (
              <Text style={styles.mapMutedText}>No known rewards</Text>
            )}
          </View>
          <Text style={styles.mapDetailLine}>Known requirements:</Text>
          <View style={styles.mapChipRow}>
            {(selectedMapRoom.knownRequirements || []).length > 0 ? (
              selectedMapRoom.knownRequirements.map(requirement => (
                <Text key={requirement} style={styles.mapChip}>{requirement}</Text>
              ))
            ) : (
              <Text style={styles.mapMutedText}>None known</Text>
            )}
          </View>
        </View>
      )}
    </CollapsiblePanel>
  );
}

function itemStatLine(item) {
  if (!item.equippable) return item.description;
  const stats = item.description.split('.')[0].replace(/^[^:]+:\s*/, '');
  return `${item.slot || 'gear'} | ${stats}`;
}

function InventoryPanel({ items, onUseItem, onEquipItem }) {
  if (!items || items.length === 0) {
    return (
      <CollapsiblePanel title="Inventory" count={0} initiallyOpen={false}>
        <Text style={styles.emptyText}>No items</Text>
      </CollapsiblePanel>
    );
  }

  return (
    <CollapsiblePanel title="Inventory" count={items.length} initiallyOpen>
      <View style={styles.itemList}>
        {items.map(item => (
          <View key={`${item.id}-${item.index}`} style={styles.itemRow}>
            <View style={styles.itemTextBlock}>
              <Text style={styles.itemName}>{item.label || item.name}</Text>
              <Text style={styles.itemDescription}>{itemStatLine(item)}</Text>
              {item.traitText ? <Text style={styles.traitText}>{item.traitText}</Text> : null}
              {item.equippable && (
                <View style={styles.gearComparisonBlock}>
                  <Text style={styles.gearComparison}>
                    Current: {item.currentEquippedName || 'Empty'}
                  </Text>
                  <Text style={styles.gearComparison}>
                    Change: {item.comparisonText}
                  </Text>
                </View>
              )}
            </View>
            <ActionButton
              label={item.equippable ? 'Equip' : 'Use'}
              onPress={() => item.equippable ? onEquipItem(item.id) : onUseItem(item.id)}
              disabled={!item.usable && !item.equippable}
              tone="secondary"
            />
          </View>
        ))}
      </View>
    </CollapsiblePanel>
  );
}

function ScenePanel({ view, onAction, events }) {
  const isEndScene = view.scene.id === 'the_end';
  const isColiseum = view.floor === 10 || /coliseum|arena|bout/i.test(`${view.scene.title} ${view.scene.text}`);
  return (
    <>
      <View style={styles.sceneCard}>
        <Text style={styles.title}>{view.scene.title}</Text>
        <View style={styles.sceneDivider} />
        <SceneArtwork label={view.scene.title} />
        <Text style={styles.bodyText}>{view.scene.text}</Text>
      </View>
      <OutcomePanel events={events} />
      {isColiseum ? <ColiseumRecord player={view.player} /> : null}
      <View style={styles.actions}>
        {view.choices.map(choice => (
          <View key={`${choice.index}-${choice.text}`} style={styles.choiceBlock}>
            <ActionButton
              label={choice.text}
              onPress={() => onAction({ type: 'choose_scene_option', index: choice.index })}
            />
            {(choice.riskLabel || choice.rewardLabel || choice.progressLabel) && (
              <View style={styles.choiceMetaRow}>
                {choice.riskLabel ? (
                  <Text style={styles.choiceRisk}>
                    {choice.riskLabel.startsWith(CHOICE_RISK_PREFIX)
                      ? choice.riskLabel
                      : `${CHOICE_RISK_PREFIX} ${choice.riskLabel}`}
                  </Text>
                ) : null}
                {choice.rewardLabel ? (
                  <Text style={styles.choiceReward}>
                    {choice.rewardLabel.startsWith(CHOICE_REWARD_PREFIX)
                      ? choice.rewardLabel
                      : `${CHOICE_REWARD_PREFIX} ${choice.rewardLabel}`}
                  </Text>
                ) : null}
                {choice.progressLabel ? <Text style={styles.choiceProgress}>{choice.progressLabel}</Text> : null}
              </View>
            )}
          </View>
        ))}
        {isEndScene && (
          <ActionButton
            label="Continue"
            onPress={() => onAction({ type: 'complete_floor' })}
          />
        )}
        <ActionButton
          label="End Run"
          tone="secondary"
          onPress={() => onAction({ type: 'end_run' })}
        />
      </View>
    </>
  );
}

function CombatPanel({ view, onAction, events }) {
  const quickItems = (view.items || []).filter(item => item.usable);
  const bossAdvantages = view.combat.enemy.advantagesApplied || [];

  return (
    <>
      <View style={styles.sceneCard}>
        <Text style={styles.floorText}>Combat Protocol</Text>
        <Text style={styles.title}>{view.scene.title}</Text>
        <View style={styles.sceneDivider} />
        <SceneArtwork label={view.combat.enemy.name} />
        <Text style={styles.bodyText}>{view.scene.text}</Text>
      </View>
      <View style={styles.enemyBand}>
        <Text style={styles.enemyName}>{view.combat.enemy.name}</Text>
        <Text style={styles.enemyHp}>HP {view.combat.enemy.hp}/{view.combat.enemy.maxHp}</Text>
        <StatusRow label="Enemy" effects={view.combat.enemy.statusEffects} />
      </View>
      {view.combat.intent && (
        <View style={styles.intentPanel}>
          <View style={styles.intentHeader}>
            <Text style={styles.intentLabel}>Intent</Text>
            <Text style={styles.intentDanger}>Danger: {String(view.combat.intent.danger || 'low').toUpperCase()}</Text>
          </View>
          <Text style={styles.intentText}>{view.combat.intent.text}</Text>
        </View>
      )}
      {view.combat.pressure && (
        <View style={styles.pressurePanel}>
          <Text style={styles.pressureLabel}>Pressure</Text>
          <Text style={styles.pressureText}>{view.combat.pressure.text}</Text>
        </View>
      )}
      {bossAdvantages.length > 0 && (
        <View style={styles.bossAdvantagePanel}>
          <Text style={styles.bossAdvantageLabel}>Boss Advantage</Text>
          <Text style={styles.bossAdvantageText}>
            {bossAdvantages.length} earned counter{bossAdvantages.length === 1 ? '' : 's'} active.
          </Text>
        </View>
      )}
      <StatusRow label="You" effects={view.player.statusEffects} />
      <OutcomePanel events={events} />
      {view.combat.abilities && view.combat.abilities.length > 0 && (
        <View style={styles.abilityPanel}>
          <Text style={styles.panelTitle}>Abilities</Text>
          <View style={styles.itemList}>
            {view.combat.abilities.map(ability => (
              <View key={ability.id} style={styles.abilityRow}>
                <View style={styles.itemTextBlock}>
                  <Text style={styles.itemName}>{ability.name}</Text>
                  <Text style={styles.itemDescription}>
                    {ability.description}
                    {ability.currentCooldown > 0 ? ` Cooldown: ${ability.currentCooldown}` : ''}
                  </Text>
                </View>
                <ActionButton
                  label={ability.ready ? 'Use' : `${ability.currentCooldown}`}
                  onPress={() => onAction({ type: 'combat_ability', abilityId: ability.id })}
                  disabled={!ability.ready}
                  tone="secondary"
                />
              </View>
            ))}
          </View>
        </View>
      )}
      {quickItems.length > 0 && (
        <View style={styles.abilityPanel}>
          <Text style={styles.panelTitle}>Quick Items</Text>
          <View style={styles.itemList}>
            {quickItems.map(item => (
              <View key={`combat-${item.id}-${item.index}`} style={styles.abilityRow}>
                <View style={styles.itemTextBlock}>
                  <Text style={styles.itemName}>{item.label || item.name}</Text>
                  <Text style={styles.itemDescription}>{item.description}</Text>
                </View>
                <ActionButton
                  label="Use"
                  onPress={() => onAction({ type: 'use_item', itemId: item.id })}
                  tone="secondary"
                />
              </View>
            ))}
          </View>
        </View>
      )}
      <View style={styles.actions}>
        {view.combat.actions.map(action => (
          <ActionButton
            key={action.type}
            label={action.label}
            onPress={() => onAction({ type: action.type })}
          />
        ))}
      </View>
    </>
  );
}

function HomeScreen({ meta, savedRun, onStartNew, onContinue }) {
  return (
    <View style={styles.homeScreen}>
      <View style={styles.homeFrame}>
        <View style={styles.homeHero}>
          <Text style={styles.homeEyebrow}>Earth-001 Enters the Gauntlet</Text>
          <Text style={styles.homeTitle}>Trial of Ten Worlds</Text>
          <Text style={styles.homeSubtitle}>Ten worlds. One survivor.</Text>
        </View>

        <View style={styles.homeStatusRow}>
          <View style={styles.homeStatusChip}>
            <Text style={styles.homeStatusLabel}>Echoes</Text>
            <Text style={styles.homeStatusValue}>{meta.currency}</Text>
          </View>
          <View style={styles.homeStatusChip}>
            <Text style={styles.homeStatusLabel}>Saved Run</Text>
            <Text style={styles.homeStatusValue}>{savedRun ? savedRun.player.name : 'None'}</Text>
          </View>
        </View>

        <View style={styles.homeActions}>
          <ActionButton
            label={savedRun ? `Continue Run` : 'Continue Run'}
            onPress={onContinue}
            disabled={!savedRun}
          />
          <ActionButton label="Start New Run" onPress={onStartNew} tone="secondary" />
        </View>
      </View>
    </View>
  );
}

function SetupScreen({ playerName, onChangeName, meta, savedRun, setupOptions, selectedAbilityIds, onSelectClass, onToggleAbility, onStart, onContinue, onClearSave, onBuyUpgrade, onBuyAbility, onBack }) {
  const cleanName = playerName.trim();
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <View style={styles.setupHeader}>
        <View style={styles.setupTitleBlock}>
          <Text style={styles.floorText}>Trial Setup</Text>
          <Text style={styles.title}>Earth-001 Loadout</Text>
        </View>
        <ActionButton label="Back" onPress={onBack} tone="secondary" />
      </View>
      <View style={styles.startSummary}>
        <View>
          <Text style={styles.summaryKicker}>Echoes</Text>
          <Text style={styles.summaryValue}>{meta.currency}</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summarySaved}>
          <Text style={styles.summaryKicker}>Saved Run</Text>
          <Text style={styles.summaryValueSmall}>{savedRun ? savedRun.player.name : 'None'}</Text>
        </View>
      </View>

      <CollapsiblePanel title="Character" initiallyOpen>
        <Text style={styles.label}>Name</Text>
        <TextInput
          accessibilityLabel="Character name"
          value={playerName}
          onChangeText={onChangeName}
          placeholder="Enter a name"
          placeholderTextColor="#857866"
          style={styles.input}
        />
      </CollapsiblePanel>

      <CollapsiblePanel title="Class & Abilities" initiallyOpen={false}>
        <RunSetupPanel
          options={setupOptions}
          selectedAbilityIds={selectedAbilityIds}
          onSelectClass={onSelectClass}
          onToggleAbility={onToggleAbility}
        />
      </CollapsiblePanel>

      <CollapsiblePanel title="Echo Upgrades" count={meta.currency} initiallyOpen={false}>
        <MetaPanel meta={meta} onBuyUpgrade={onBuyUpgrade} />
        <AbilityUnlockPanel meta={meta} options={setupOptions} onBuyAbility={onBuyAbility} />
      </CollapsiblePanel>

      <View style={styles.startActionBar}>
        <ActionButton label="Begin Trial" onPress={() => onStart(cleanName)} disabled={cleanName.length === 0} />
        <ActionButton
          label={savedRun ? `Continue ${savedRun.player.name}` : 'Continue Saved Run'}
          onPress={onContinue}
          disabled={!savedRun}
          tone="secondary"
        />
        <ActionButton
          label="Clear Save"
          onPress={onClearSave}
          disabled={!savedRun}
          tone="secondary"
        />
      </View>
    </ScrollView>
  );
}

function RunEndedPanel({ view, meta, runRewards, onMenu }) {
  const rewardBonus = (meta.upgrades.rewardMultiplier || 0) * 5;
  return (
    <View style={styles.endedPanel}>
      <Text style={styles.title}>Run Complete</Text>
      <Text style={styles.bodyText}>
        The current expedition is over. Start a fresh run when you are ready.
      </Text>
      {view.player.runStats && (
        <View style={styles.summaryPanel}>
          <Text style={styles.summaryLine}>Floors cleared: {view.player.runStats.floorsCleared}</Text>
          <Text style={styles.summaryLine}>Enemies defeated: {view.player.runStats.enemiesDefeated}</Text>
          <Text style={styles.summaryLine}>Ending: {view.player.runStats.endingReached}</Text>
          <Text style={styles.summaryLine}>Echoes earned: {runRewards.metaEarned}</Text>
          <Text style={styles.summaryLine}>Total Echoes: {meta.currency}</Text>
          <Text style={styles.summaryLine}>Reward bonus: +{rewardBonus}</Text>
        </View>
      )}
      <ActionButton label="Return to Menu" onPress={onMenu} />
    </View>
  );
}

module.exports = function App() {
  const initialMeta = useMemo(() => saveStore.loadMeta(), []);
  const [meta, setMeta] = useState(initialMeta);
  const [selectedClassId, setSelectedClassId] = useState('fighter');
  const setupOptions = useMemo(() => runtime.getRunSetupOptions(meta, selectedClassId), [meta, selectedClassId]);
  const [playerName, setPlayerName] = useState('Earth-001');
  const [selectedAbilityIds, setSelectedAbilityIds] = useState(() => runtime.getRunSetupOptions(initialMeta).selectedAbilityIds);
  const [menuScreen, setMenuScreen] = useState('home');
  const [gameState, setGameState] = useState(null);
  const [savedRun, setSavedRun] = useState(() => saveStore.loadSavedRun());
  const [events, setEvents] = useState([]);
  const [saveNotice, setSaveNotice] = useState('');
  const [runRewards, setRunRewards] = useState({ metaEarned: 0 });
  const view = gameState ? runtime.getView(gameState) : null;

  useEffect(() => {
    let active = true;
    Promise.all([
      saveStore.loadMetaAsync(),
      saveStore.loadSavedRunAsync(),
    ]).then(([storedMeta, storedRun]) => {
      if (!active) return;
      setMeta(storedMeta);
      setSavedRun(storedRun);
      setSelectedAbilityIds(current => {
        const nextOptions = runtime.getRunSetupOptions(storedMeta, selectedClassId);
        const allowed = new Set(nextOptions.abilities.map(ability => ability.id));
        const kept = current.filter(id => allowed.has(id)).slice(0, nextOptions.maxAbilities);
        return kept.length > 0 ? kept : nextOptions.selectedAbilityIds;
      });
    });
    return () => {
      active = false;
    };
  }, []);

  const dispatch = action => {
    const result = runtime.dispatch(gameState, action);
    const rewardEvents = [];
    let nextMeta = meta;
    let metaEarned = 0;
    result.events.forEach(event => {
      if (event.type === 'floor_completed') {
        const reward = metaCore.getFloorCurrencyReward(nextMeta, event.completedFloor);
        nextMeta = metaCore.awardMetaCurrency(nextMeta, reward);
        metaEarned += reward;
        rewardEvents.push({ type: 'meta_awarded', amount: reward });
      }
    });
    if (nextMeta !== meta) {
      saveStore.saveMetaAsync(nextMeta);
      setMeta(nextMeta);
    }
    if (result.events.some(event => event.type === 'run_ended')) {
      saveStore.clearSavedRunAsync();
      setSavedRun(null);
      setSaveNotice('');
    }
    if (metaEarned > 0) {
      setRunRewards(current => ({ ...current, metaEarned: current.metaEarned + metaEarned }));
    }
    setGameState(result.state);
    setEvents(rewardEvents.concat(result.events, events).slice(0, 8));
  };

  const startRun = name => {
    setGameState(runtime.startNewRun({ name, meta, classId: selectedClassId, selectedAbilityIds }));
    setEvents([]);
    setSaveNotice('');
    setRunRewards({ metaEarned: 0 });
  };

  const saveRun = () => {
    if (!gameState || view.runEnded) return;
    const snapshot = runtime.createSaveData(gameState);
    saveStore.saveRunSnapshotAsync(snapshot);
    setSavedRun(snapshot);
    setSaveNotice(`Saved: ${snapshot.currentSceneId}`);
    setEvents([{ type: 'save_created', scene: snapshot.currentSceneId }].concat(events).slice(0, 8));
  };

  const continueSavedRun = () => {
    if (!savedRun) return;
    setGameState(runtime.hydrateRun(savedRun));
    setSaveNotice(`Loaded: ${savedRun.currentSceneId}`);
    setEvents([{ type: 'save_loaded', scene: savedRun.currentSceneId }]);
  };

  const returnToMenu = () => {
    setGameState(null);
    setMenuScreen('home');
    setEvents([]);
    setSaveNotice('');
  };

  const buyUpgrade = stat => {
    const purchase = metaCore.purchaseUpgrade(meta, stat);
    if (!purchase.ok) {
      setEvents([{ type: purchase.reason }].concat(events).slice(0, 8));
      return;
    }
    saveStore.saveMetaAsync(purchase.meta);
    setMeta(purchase.meta);
    setSelectedAbilityIds(current => {
      const nextOptions = runtime.getRunSetupOptions(purchase.meta, selectedClassId);
      const allowed = new Set(nextOptions.abilities.map(ability => ability.id));
      const kept = current.filter(id => allowed.has(id)).slice(0, nextOptions.maxAbilities);
      return kept.length > 0 ? kept : nextOptions.selectedAbilityIds;
    });
    setEvents([{ type: 'upgrade_purchased', stat }].concat(events).slice(0, 8));
  };

  const buyAbility = abilityId => {
    const purchase = metaCore.purchaseAbility(meta, selectedClassId, abilityId);
    if (!purchase.ok) {
      setEvents([{ type: purchase.reason }].concat(events).slice(0, 8));
      return;
    }
    saveStore.saveMetaAsync(purchase.meta);
    setMeta(purchase.meta);
    const nextOptions = runtime.getRunSetupOptions(purchase.meta, selectedClassId);
    const unlocked = nextOptions.abilities.find(ability => ability.id === abilityId);
    setEvents([{
      type: 'ability_unlocked',
      abilityId,
      name: unlocked?.name,
    }].concat(events).slice(0, 8));
  };

  const toggleAbility = abilityId => {
    setSelectedAbilityIds(current => {
      if (current.includes(abilityId)) return current.filter(id => id !== abilityId);
      if (current.length >= setupOptions.maxAbilities) return current;
      return current.concat(abilityId);
    });
  };

  const selectClass = classId => {
    const nextOptions = runtime.getRunSetupOptions(meta, classId);
    setSelectedClassId(nextOptions.selectedClassId);
    setSelectedAbilityIds(nextOptions.selectedAbilityIds);
  };

  if (!gameState) {
    return (
      <SafeAreaView style={menuScreen === 'home' ? styles.homeSafe : styles.safe}>
        <StatusBar barStyle={menuScreen === 'home' ? 'light-content' : 'dark-content'} />
        {menuScreen === 'home' ? (
          <HomeScreen
            meta={meta}
            savedRun={savedRun}
            onStartNew={() => setMenuScreen('setup')}
            onContinue={continueSavedRun}
          />
        ) : (
          <SetupScreen
            playerName={playerName}
            onChangeName={setPlayerName}
            meta={meta}
            savedRun={savedRun}
            setupOptions={setupOptions}
            selectedAbilityIds={selectedAbilityIds}
            onSelectClass={selectClass}
            onToggleAbility={toggleAbility}
            onStart={startRun}
            onContinue={continueSavedRun}
            onBuyUpgrade={buyUpgrade}
            onBuyAbility={buyAbility}
            onBack={() => setMenuScreen('home')}
            onClearSave={() => {
              saveStore.clearSavedRunAsync();
              setSavedRun(null);
              setSaveNotice('');
            }}
          />
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <View style={styles.shell}>
        <TrialTopBar title={`Floor ${view.floor} - ${view.scene.title}`} player={view.player} meta={meta} />
        <HpVitalityBar player={view.player} />
        <View style={styles.runToolbar}>
          <View>
            <Text style={styles.toolbarText}>Earth-001 Trial Feed</Text>
            {saveNotice ? <Text style={styles.saveNotice}>{saveNotice}</Text> : null}
          </View>
          <ActionButton label="Save Run" onPress={saveRun} tone="secondary" disabled={view.runEnded} />
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          {!view.runEnded && <ObjectivePanel objective={view.objective} />}
          {!view.runEnded && <ContractBadge contractProgress={view.contractProgress} />}
          {!view.runEnded && <MapProgressPanel mapProgress={view.mapProgress} />}
          {view.runEnded ? (
            <RunEndedPanel view={view} meta={meta} runRewards={runRewards} onMenu={returnToMenu} />
          ) : view.mode === 'combat' ? (
            <CombatPanel view={view} onAction={dispatch} events={events} />
          ) : (
            <ScenePanel view={view} onAction={dispatch} events={events} />
          )}
          <EquipmentPanel equipmentItems={view.equipmentItems} />
          <InventoryPanel
            items={view.items}
            onUseItem={itemId => dispatch({ type: 'use_item', itemId })}
            onEquipItem={itemId => dispatch({ type: 'equip_item', itemId })}
          />
          <EventLog events={events} />
        </ScrollView>
        <BottomTrialNav active={view.runEnded ? 'Upgrades' : view.mode === 'combat' ? 'Scene' : 'Scene'} />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: STITCH_THEME.background,
  },
  homeSafe: {
    flex: 1,
    backgroundColor: STITCH_THEME.background,
  },
  shell: {
    flex: 1,
    backgroundColor: STITCH_THEME.background,
  },
  homeScreen: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 18,
    backgroundColor: STITCH_THEME.background,
  },
  homeFrame: {
    width: '88%',
    maxWidth: 340,
    alignSelf: 'center',
    gap: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: STITCH_THEME.outline,
    borderRadius: 0,
    backgroundColor: STITCH_THEME.surface,
  },
  homeHero: {
    minHeight: 260,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(242,202,80,0.35)',
    borderRadius: 0,
    backgroundColor: STITCH_THEME.background,
  },
  homeEyebrow: {
    color: STITCH_THEME.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  homeTitle: {
    color: STITCH_THEME.primary,
    fontSize: 31,
    lineHeight: 38,
    fontWeight: '900',
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 3,
  },
  homeSubtitle: {
    color: STITCH_THEME.muted,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '800',
    textAlign: 'center',
  },
  homeStatusRow: {
    flexDirection: 'row',
    gap: 10,
  },
  homeStatusChip: {
    flex: 1,
    minHeight: 72,
    justifyContent: 'center',
    padding: 12,
    borderWidth: 1,
    borderColor: STITCH_THEME.outline,
    borderRadius: 0,
    backgroundColor: STITCH_THEME.surfaceHigh,
  },
  homeStatusLabel: {
    color: STITCH_THEME.muted,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  homeStatusValue: {
    color: STITCH_THEME.text,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '900',
    marginTop: 3,
  },
  homeActions: {
    gap: 10,
    padding: 12,
    borderRadius: 0,
    backgroundColor: STITCH_THEME.surface,
  },
  trialTopBar: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(242,202,80,0.22)',
    backgroundColor: STITCH_THEME.surfaceHigh,
  },
  trialTitleBlock: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  trialIcon: {
    color: STITCH_THEME.primary,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '900',
  },
  trialTitle: {
    flex: 1,
    color: STITCH_THEME.primary,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '900',
  },
  trialMetaBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  trialMetaColumn: {
    alignItems: 'flex-end',
  },
  trialMetaLabel: {
    color: STITCH_THEME.muted,
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  trialMetaValue: {
    color: STITCH_THEME.text,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  trialEchoValue: {
    color: STITCH_THEME.primary,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '900',
  },
  trialDivider: {
    width: 1,
    height: 30,
    backgroundColor: 'rgba(153,144,124,0.3)',
  },
  hpPanel: {
    gap: 6,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 8,
    backgroundColor: STITCH_THEME.background,
  },
  hpHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  hpLabel: {
    color: STITCH_THEME.muted,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  hpValue: {
    color: STITCH_THEME.primary,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '900',
  },
  hpTrack: {
    height: 8,
    borderWidth: 1,
    borderColor: 'rgba(242,202,80,0.18)',
    backgroundColor: STITCH_THEME.surfaceHighest,
  },
  hpFill: {
    height: '100%',
    backgroundColor: 'rgba(242,202,80,0.65)',
  },
  statsBand: {
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: STITCH_THEME.surfaceHigh,
  },
  playerIdentity: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 10,
  },
  playerName: {
    flex: 1,
    color: STITCH_THEME.text,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '900',
  },
  playerClass: {
    color: STITCH_THEME.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  playerStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
  },
  stat: {
    minWidth: 48,
    alignItems: 'center',
  },
  statLabel: {
    color: STITCH_THEME.muted,
    fontSize: 11,
    fontWeight: '700',
  },
  statValue: {
    color: STITCH_THEME.text,
    fontSize: 14,
    fontWeight: '800',
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 18,
    paddingBottom: 94,
  },
  sceneHeader: {
    borderBottomWidth: 2,
    borderBottomColor: '#2f4f3d',
    paddingBottom: 12,
    marginBottom: 16,
  },
  setupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderBottomWidth: 2,
    borderBottomColor: '#2f4f3d',
    paddingBottom: 12,
    marginBottom: 16,
  },
  setupTitleBlock: {
    flex: 1,
  },
  floorText: {
    color: STITCH_THEME.muted,
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  title: {
    color: STITCH_THEME.text,
    fontSize: 25,
    lineHeight: 31,
    fontWeight: '900',
    marginTop: 4,
  },
  bodyText: {
    color: STITCH_THEME.muted,
    fontSize: 17,
    lineHeight: 27,
  },
  sceneCard: {
    gap: 14,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(242,202,80,0.32)',
    backgroundColor: STITCH_THEME.surface,
  },
  sceneDivider: {
    height: 1,
    backgroundColor: 'rgba(242,202,80,0.18)',
  },
  sceneArtwork: {
    minHeight: 160,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(242,202,80,0.22)',
    backgroundColor: '#080a08',
  },
  sceneArtworkIcon: {
    color: 'rgba(242,240,234,0.18)',
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '900',
  },
  sceneArtworkLabel: {
    color: 'rgba(208,197,175,0.45)',
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 1.4,
  },
  coliseumRecord: {
    gap: 12,
    marginTop: 18,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(242,202,80,0.24)',
    backgroundColor: STITCH_THEME.surfaceHigh,
  },
  coliseumHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  coliseumLabel: {
    color: STITCH_THEME.muted,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  coliseumValue: {
    color: STITCH_THEME.primary,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '900',
  },
  coliseumPips: {
    flexDirection: 'row',
    gap: 5,
  },
  coliseumPip: {
    flex: 1,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(242,202,80,0.2)',
    backgroundColor: STITCH_THEME.surfaceHighest,
  },
  filledColiseumPip: {
    backgroundColor: STITCH_THEME.primary,
    borderColor: STITCH_THEME.primary,
  },
  coliseumPipText: {
    color: STITCH_THEME.primary,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
  },
  filledColiseumPipText: {
    color: STITCH_THEME.onPrimary,
  },
  objectivePanel: {
    gap: 6,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(242,202,80,0.25)',
    borderRadius: 0,
    backgroundColor: STITCH_THEME.surfaceHigh,
    marginBottom: 16,
  },
  objectiveHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  objectiveLabel: {
    color: STITCH_THEME.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  objectiveGoal: {
    color: STITCH_THEME.text,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '900',
  },
  objectiveMissing: {
    color: STITCH_THEME.primary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  objectiveReady: {
    color: STITCH_THEME.primary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
  },
  contractBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(242,202,80,0.35)',
    borderRadius: 0,
    backgroundColor: STITCH_THEME.surfaceHigh,
    marginBottom: 16,
  },
  contractBadgeLabel: {
    color: STITCH_THEME.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  contractBadgeValue: {
    color: STITCH_THEME.primary,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '900',
  },
  contractBadgeState: {
    color: STITCH_THEME.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
  contractBadgeReady: {
    color: '#21452f',
  },
  outcomePanel: {
    gap: 4,
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderLeftWidth: 4,
    borderLeftColor: STITCH_THEME.primary,
    borderRadius: 0,
    backgroundColor: STITCH_THEME.surfaceHigh,
  },
  outcomeTitle: {
    color: STITCH_THEME.primary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  outcomeLine: {
    color: STITCH_THEME.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
  },
  actions: {
    gap: 10,
    marginTop: 22,
  },
  choiceBlock: {
    gap: 6,
  },
  choiceMetaRow: {
    gap: 3,
    paddingHorizontal: 8,
  },
  choiceRisk: {
    color: '#8f3d33',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
  },
  choiceReward: {
    color: '#2f4f3d',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
  },
  choiceProgress: {
    color: '#4d4539',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
  startActions: {
    marginTop: 0,
    marginBottom: 4,
  },
  startSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(242,202,80,0.32)',
    borderRadius: 0,
    backgroundColor: STITCH_THEME.surfaceHigh,
  },
  summaryKicker: {
    color: STITCH_THEME.muted,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  summaryValue: {
    color: STITCH_THEME.primary,
    fontSize: 24,
    lineHeight: 29,
    fontWeight: '900',
  },
  summaryValueSmall: {
    color: STITCH_THEME.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
  },
  summaryDivider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: 'rgba(153,144,124,0.35)',
  },
  summarySaved: {
    flex: 1,
  },
  startActionBar: {
    gap: 10,
    marginTop: 22,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(242,202,80,0.18)',
  },
  button: {
    minHeight: 48,
    justifyContent: 'center',
    borderRadius: 0,
    backgroundColor: STITCH_THEME.primary,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: STITCH_THEME.primaryDim,
  },
  secondaryButton: {
    backgroundColor: STITCH_THEME.surfaceHigh,
    borderColor: 'rgba(242,202,80,0.35)',
    borderWidth: 1,
  },
  buttonText: {
    color: STITCH_THEME.onPrimary,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 1,
  },
  secondaryButtonText: {
    color: STITCH_THEME.text,
  },
  disabledButton: {
    opacity: 0.45,
  },
  disabledButtonText: {
    color: '#6f675a',
  },
  label: {
    color: STITCH_THEME.muted,
    fontSize: 13,
    fontWeight: '900',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: 'rgba(242,202,80,0.35)',
    borderRadius: 0,
    backgroundColor: '#090b09',
    color: STITCH_THEME.text,
    fontSize: 18,
    fontWeight: '800',
    paddingHorizontal: 14,
    marginBottom: 18,
  },
  metaPanel: {
    gap: 10,
    marginTop: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(242,202,80,0.35)',
    borderRadius: 0,
    backgroundColor: STITCH_THEME.surfaceHigh,
  },
  setupPanel: {
    gap: 10,
    marginTop: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(242,202,80,0.28)',
    borderRadius: 0,
    backgroundColor: STITCH_THEME.surfaceHigh,
  },
  setupPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  setupCount: {
    color: STITCH_THEME.primary,
    fontSize: 14,
    fontWeight: '900',
  },
  sectionLabel: {
    color: STITCH_THEME.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
    marginTop: 4,
  },
  helperText: {
    color: STITCH_THEME.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  metaTitle: {
    color: STITCH_THEME.primary,
    fontSize: 17,
    fontWeight: '900',
  },
  metaGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
    padding: 10,
    borderRadius: 0,
    backgroundColor: STITCH_THEME.background,
  },
  metaText: {
    color: STITCH_THEME.muted,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '700',
  },
  utilityPanel: {
    gap: 10,
    marginTop: 22,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(242,202,80,0.18)',
  },
  utilityHeader: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  utilityToggle: {
    color: STITCH_THEME.primary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  mapSummary: {
    gap: 2,
    padding: 10,
    borderRadius: 0,
    backgroundColor: STITCH_THEME.surfaceHigh,
    borderWidth: 1,
    borderColor: 'rgba(242,202,80,0.25)',
  },
  mapSummaryText: {
    color: STITCH_THEME.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  mapNodeCanvas: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  mapNode: {
    width: '31%',
    minWidth: 86,
    minHeight: 82,
    justifyContent: 'space-between',
    gap: 4,
    padding: 8,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: 'rgba(242,202,80,0.25)',
    backgroundColor: STITCH_THEME.surfaceHigh,
  },
  currentMapNode: {
    borderColor: STITCH_THEME.primary,
    backgroundColor: '#272715',
  },
  clearedMapNode: {
    borderColor: 'rgba(242,202,80,0.45)',
  },
  selectedMapNode: {
    borderColor: STITCH_THEME.primary,
    backgroundColor: '#302a14',
  },
  mapNodeIcon: {
    color: STITCH_THEME.primary,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '900',
  },
  mapNodeName: {
    color: STITCH_THEME.text,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
  },
  mapNodeMeta: {
    color: STITCH_THEME.muted,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  mapDetailPanel: {
    gap: 8,
    padding: 10,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: 'rgba(242,202,80,0.25)',
    backgroundColor: STITCH_THEME.surfaceHigh,
  },
  mapDetailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  mapDetailTitle: {
    flex: 1,
    color: STITCH_THEME.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
  },
  mapDetailPill: {
    color: STITCH_THEME.onPrimary,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '900',
    textTransform: 'uppercase',
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 0,
    backgroundColor: STITCH_THEME.primary,
    overflow: 'hidden',
  },
  mapDetailLine: {
    color: STITCH_THEME.muted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  mapChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  mapChip: {
    color: STITCH_THEME.text,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
    paddingVertical: 4,
    paddingHorizontal: 7,
    borderRadius: 0,
    backgroundColor: STITCH_THEME.surfaceHighest,
    overflow: 'hidden',
  },
  mapMutedText: {
    color: STITCH_THEME.muted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  mapRoomList: {
    gap: 6,
  },
  mapRoomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 0,
    backgroundColor: STITCH_THEME.surfaceHigh,
    borderWidth: 1,
    borderColor: 'rgba(242,202,80,0.25)',
  },
  currentMapRoom: {
    borderColor: STITCH_THEME.primary,
    backgroundColor: '#272715',
  },
  mapRoomName: {
    flex: 1,
    color: STITCH_THEME.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
  },
  mapRoomMeta: {
    color: STITCH_THEME.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  equipmentGrid: {
    gap: 8,
  },
  equipmentSlot: {
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(242,202,80,0.25)',
    borderRadius: 0,
    backgroundColor: STITCH_THEME.surfaceHigh,
  },
  equipmentSlotLabel: {
    color: STITCH_THEME.muted,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  equipmentName: {
    color: STITCH_THEME.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
    textTransform: 'capitalize',
  },
  panelTitle: {
    color: STITCH_THEME.text,
    fontSize: 18,
    fontWeight: '900',
  },
  emptyText: {
    color: STITCH_THEME.muted,
    fontSize: 14,
    fontWeight: '700',
  },
  itemList: {
    gap: 8,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(242,202,80,0.25)',
    borderRadius: 0,
    backgroundColor: STITCH_THEME.surfaceHigh,
  },
  itemTextBlock: {
    flex: 1,
  },
  itemTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  itemName: {
    color: STITCH_THEME.text,
    fontSize: 15,
    fontWeight: '900',
  },
  statePill: {
    color: STITCH_THEME.muted,
    backgroundColor: STITCH_THEME.surfaceHighest,
    borderColor: 'rgba(242,202,80,0.24)',
    borderWidth: 1,
    borderRadius: 0,
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 2,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  ownedPill: {
    color: STITCH_THEME.primary,
    backgroundColor: '#24220f',
    borderColor: STITCH_THEME.primary,
  },
  affordablePill: {
    color: STITCH_THEME.primary,
    backgroundColor: '#24220f',
    borderColor: STITCH_THEME.primaryDim,
  },
  itemDescription: {
    color: STITCH_THEME.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  traitText: {
    color: STITCH_THEME.primary,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
    marginTop: 2,
  },
  gearComparisonBlock: {
    marginTop: 2,
    gap: 1,
  },
  gearComparison: {
    color: STITCH_THEME.primary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
  },
  upgradeList: {
    gap: 8,
    marginTop: 2,
  },
  upgradeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(242,202,80,0.18)',
  },
  upgradeTextBlock: {
    flex: 1,
  },
  upgradeName: {
    color: STITCH_THEME.text,
    fontSize: 15,
    fontWeight: '900',
  },
  upgradeDetail: {
    color: STITCH_THEME.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  runToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(242,202,80,0.16)',
    backgroundColor: STITCH_THEME.background,
  },
  toolbarText: {
    color: STITCH_THEME.muted,
    fontSize: 14,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  saveNotice: {
    color: STITCH_THEME.primary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    marginTop: 2,
  },
  enemyBand: {
    marginTop: 18,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,180,171,0.45)',
  },
  enemyName: {
    color: STITCH_THEME.text,
    fontSize: 19,
    fontWeight: '900',
  },
  enemyHp: {
    color: '#ffb4ab',
    fontSize: 15,
    fontWeight: '800',
    marginTop: 4,
  },
  intentPanel: {
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(242,202,80,0.3)',
    borderRadius: 0,
    backgroundColor: STITCH_THEME.surfaceHigh,
    gap: 4,
  },
  intentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  intentLabel: {
    color: STITCH_THEME.primary,
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  intentDanger: {
    color: '#ffb4ab',
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  intentText: {
    color: STITCH_THEME.muted,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
  },
  pressurePanel: {
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: 'rgba(255,180,171,0.45)',
    borderRadius: 0,
    backgroundColor: '#21110f',
    gap: 3,
  },
  pressureLabel: {
    color: '#ffb4ab',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  pressureText: {
    color: STITCH_THEME.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  bossAdvantagePanel: {
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: 'rgba(242,202,80,0.35)',
    borderRadius: 0,
    backgroundColor: '#202016',
    gap: 3,
  },
  bossAdvantageLabel: {
    color: STITCH_THEME.primary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  bossAdvantageText: {
    color: STITCH_THEME.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  statusRow: {
    marginTop: 10,
    gap: 6,
  },
  statusLabel: {
    color: STITCH_THEME.muted,
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  statusChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  statusChip: {
    color: STITCH_THEME.primary,
    backgroundColor: STITCH_THEME.surfaceHigh,
    borderColor: 'rgba(242,202,80,0.35)',
    borderWidth: 1,
    borderRadius: 0,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 12,
    fontWeight: '800',
  },
  abilityPanel: {
    gap: 10,
    marginTop: 18,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(242,202,80,0.18)',
  },
  abilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(242,202,80,0.25)',
    borderRadius: 0,
    backgroundColor: STITCH_THEME.surfaceHigh,
  },
  abilitySelectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(242,202,80,0.25)',
    borderRadius: 0,
    backgroundColor: STITCH_THEME.surfaceHigh,
  },
  selectedAbilityRow: {
    borderColor: STITCH_THEME.primary,
    backgroundColor: '#272715',
  },
  log: {
    gap: 6,
  },
  logLine: {
    color: STITCH_THEME.muted,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
  },
  endedPanel: {
    gap: 16,
  },
  summaryPanel: {
    gap: 6,
    padding: 12,
    borderRadius: 0,
    backgroundColor: STITCH_THEME.surfaceHigh,
    borderWidth: 1,
    borderColor: 'rgba(242,202,80,0.3)',
  },
  summaryLine: {
    color: STITCH_THEME.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
  bottomTrialNav: {
    minHeight: 66,
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: 'rgba(242,202,80,0.25)',
    backgroundColor: STITCH_THEME.surfaceHigh,
  },
  navTab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  activeNavTab: {
    backgroundColor: 'rgba(242,202,80,0.22)',
    borderTopWidth: 2,
    borderTopColor: STITCH_THEME.primary,
  },
  navIcon: {
    color: STITCH_THEME.muted,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '900',
  },
  navLabel: {
    color: STITCH_THEME.muted,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
  },
  activeNavText: {
    color: STITCH_THEME.primary,
  },
});

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

function Stat({ label, value }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
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
      <Text style={styles.metaTitle}>Meta Progress</Text>
      <View style={styles.metaGrid}>
        <Stat label="POINTS" value={meta.currency} />
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
        <Text style={styles.setupCount}>{meta.currency} points</Text>
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
        <Text style={styles.metaTitle}>Run Setup</Text>
        <Text style={styles.setupCount}>
          {selectedAbilityIds.length}/{options.maxAbilities} abilities
        </Text>
      </View>

      <Text style={styles.sectionLabel}>Class</Text>
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
  if (event.type === 'meta_awarded') return `Meta points +${event.amount}`;
  if (event.type === 'upgrade_purchased') return `Purchased ${event.stat.toUpperCase()}+`;
  if (event.type === 'ability_unlocked') return `Unlocked ${event.name || event.abilityId}`;
  if (event.type === 'not_enough_currency') return 'Not enough meta points';
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
  if (!mapProgress) return null;
  const visibleRooms = (mapProgress.rooms || []).filter(room => room.visited || room.current).slice(-6);
  return (
    <CollapsiblePanel title="Map" count={`${mapProgress.visitedCount}/${mapProgress.totalRooms}`} initiallyOpen={false}>
      <View style={styles.mapSummary}>
        <Text style={styles.mapSummaryText}>Current: {mapProgress.currentRoom}</Text>
        <Text style={styles.mapSummaryText}>
          Seen {mapProgress.discoveredCount} | Visited {mapProgress.visitedCount}
        </Text>
      </View>
      <View style={styles.mapRoomList}>
        {visibleRooms.map(room => (
          <View key={room.id} style={[styles.mapRoomRow, room.current && styles.currentMapRoom]}>
            <Text style={styles.mapRoomName}>{room.shortName}</Text>
            <Text style={styles.mapRoomMeta}>{room.current ? 'Here' : room.cleared ? 'Cleared' : room.tag}</Text>
          </View>
        ))}
      </View>
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
  return (
    <>
      <View style={styles.sceneHeader}>
        <Text style={styles.floorText}>Floor {view.floor}</Text>
        <Text style={styles.title}>{view.scene.title}</Text>
      </View>
      <Text style={styles.bodyText}>{view.scene.text}</Text>
      <OutcomePanel events={events} />
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

  return (
    <>
      <View style={styles.sceneHeader}>
        <Text style={styles.floorText}>Combat</Text>
        <Text style={styles.title}>{view.scene.title}</Text>
      </View>
      <Text style={styles.bodyText}>{view.scene.text}</Text>
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
          <Text style={styles.homeEyebrow}>LitRPG Expedition</Text>
          <Text style={styles.homeTitle}>Dungeon Depths</Text>
          <Text style={styles.homeSubtitle}>Descend, adapt, and bring something back.</Text>
        </View>

        <View style={styles.homeStatusRow}>
          <View style={styles.homeStatusChip}>
            <Text style={styles.homeStatusLabel}>Meta Points</Text>
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
          <Text style={styles.floorText}>New Expedition</Text>
          <Text style={styles.title}>Prepare Your Run</Text>
        </View>
        <ActionButton label="Back" onPress={onBack} tone="secondary" />
      </View>
      <View style={styles.startSummary}>
        <View>
          <Text style={styles.summaryKicker}>Meta Points</Text>
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

      <CollapsiblePanel title="Meta Upgrades" count={meta.currency} initiallyOpen={false}>
        <MetaPanel meta={meta} onBuyUpgrade={onBuyUpgrade} />
        <AbilityUnlockPanel meta={meta} options={setupOptions} onBuyAbility={onBuyAbility} />
      </CollapsiblePanel>

      <View style={styles.startActionBar}>
        <ActionButton label="Begin Run" onPress={() => onStart(cleanName)} disabled={cleanName.length === 0} />
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
          <Text style={styles.summaryLine}>Meta earned: {runRewards.metaEarned}</Text>
          <Text style={styles.summaryLine}>Total meta points: {meta.currency}</Text>
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
      <StatusBar barStyle="dark-content" />
      <View style={styles.shell}>
        <PlayerStrip player={view.player} />
        <View style={styles.runToolbar}>
          <View>
            <Text style={styles.toolbarText}>Floor {view.floor}</Text>
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
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#f5f1e8',
  },
  homeSafe: {
    flex: 1,
    backgroundColor: '#101713',
  },
  shell: {
    flex: 1,
    backgroundColor: '#f5f1e8',
  },
  homeScreen: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 18,
    backgroundColor: '#101713',
  },
  homeFrame: {
    width: '88%',
    maxWidth: 320,
    alignSelf: 'flex-start',
    gap: 18,
    marginLeft: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#52664e',
    borderRadius: 8,
    backgroundColor: '#172018',
  },
  homeHero: {
    minHeight: 260,
    justifyContent: 'flex-end',
    gap: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#7a6a45',
    borderRadius: 8,
    backgroundColor: '#20251f',
  },
  homeEyebrow: {
    color: '#d9c28a',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  homeTitle: {
    color: '#fffaf0',
    fontSize: 33,
    lineHeight: 38,
    fontWeight: '900',
  },
  homeSubtitle: {
    color: '#c7d6bd',
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '800',
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
    borderColor: '#52664e',
    borderRadius: 8,
    backgroundColor: '#111a15',
  },
  homeStatusLabel: {
    color: '#9fb194',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  homeStatusValue: {
    color: '#fffaf0',
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '900',
    marginTop: 3,
  },
  homeActions: {
    gap: 10,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#fffaf0',
  },
  statsBand: {
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#20251f',
  },
  playerIdentity: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 10,
  },
  playerName: {
    flex: 1,
    color: '#fffaf0',
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '900',
  },
  playerClass: {
    color: '#c7d6bd',
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
    color: '#c7d6bd',
    fontSize: 11,
    fontWeight: '700',
  },
  statValue: {
    color: '#fffaf0',
    fontSize: 14,
    fontWeight: '800',
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 18,
    paddingBottom: 32,
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
    color: '#56645c',
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  title: {
    color: '#1f241e',
    fontSize: 26,
    lineHeight: 31,
    fontWeight: '900',
    marginTop: 4,
  },
  bodyText: {
    color: '#252925',
    fontSize: 17,
    lineHeight: 25,
  },
  objectivePanel: {
    gap: 6,
    padding: 12,
    borderWidth: 1,
    borderColor: '#a8b78d',
    borderRadius: 8,
    backgroundColor: '#f3f7ee',
    marginBottom: 16,
  },
  objectiveHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  objectiveLabel: {
    color: '#56645c',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  objectiveGoal: {
    color: '#1f241e',
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '900',
  },
  objectiveMissing: {
    color: '#6a4e22',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  objectiveReady: {
    color: '#21452f',
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
    borderColor: '#b9a56a',
    borderRadius: 8,
    backgroundColor: '#fff7df',
    marginBottom: 16,
  },
  contractBadgeLabel: {
    color: '#61512a',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  contractBadgeValue: {
    color: '#211d14',
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '900',
  },
  contractBadgeState: {
    color: '#6a4e22',
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
    borderLeftColor: '#2f4f3d',
    borderRadius: 8,
    backgroundColor: '#eef3e7',
  },
  outcomeTitle: {
    color: '#2f4f3d',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  outcomeLine: {
    color: '#252925',
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
    borderColor: '#c8b998',
    borderRadius: 8,
    backgroundColor: '#fffaf0',
  },
  summaryKicker: {
    color: '#56645c',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  summaryValue: {
    color: '#1f241e',
    fontSize: 24,
    lineHeight: 29,
    fontWeight: '900',
  },
  summaryValueSmall: {
    color: '#1f241e',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
  },
  summaryDivider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: '#d0c5ad',
  },
  summarySaved: {
    flex: 1,
  },
  startActionBar: {
    gap: 10,
    marginTop: 22,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#d0c5ad',
  },
  button: {
    minHeight: 48,
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#2f4f3d',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderColor: '#7b6f5c',
    borderWidth: 1,
  },
  buttonText: {
    color: '#fffaf0',
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '800',
  },
  secondaryButtonText: {
    color: '#3d3327',
  },
  disabledButton: {
    opacity: 0.45,
  },
  disabledButtonText: {
    color: '#6f675a',
  },
  label: {
    color: '#3d3327',
    fontSize: 13,
    fontWeight: '900',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: '#8b7d68',
    borderRadius: 8,
    backgroundColor: '#fffaf0',
    color: '#1f241e',
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
    borderColor: '#c8b998',
    borderRadius: 8,
    backgroundColor: '#ebe2cf',
  },
  setupPanel: {
    gap: 10,
    marginTop: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#a8b78d',
    borderRadius: 8,
    backgroundColor: '#f3f7ee',
  },
  setupPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  setupCount: {
    color: '#56645c',
    fontSize: 14,
    fontWeight: '900',
  },
  sectionLabel: {
    color: '#56645c',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
    marginTop: 4,
  },
  helperText: {
    color: '#6a5f4f',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  metaTitle: {
    color: '#1f241e',
    fontSize: 17,
    fontWeight: '900',
  },
  metaGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#20251f',
  },
  metaText: {
    color: '#4d4539',
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '700',
  },
  utilityPanel: {
    gap: 10,
    marginTop: 22,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#d0c5ad',
  },
  utilityHeader: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  utilityToggle: {
    color: '#56645c',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  mapSummary: {
    gap: 2,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#ebe2cf',
    borderWidth: 1,
    borderColor: '#c8b998',
  },
  mapSummaryText: {
    color: '#3d3327',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
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
    borderRadius: 8,
    backgroundColor: '#fffaf0',
    borderWidth: 1,
    borderColor: '#d0c5ad',
  },
  currentMapRoom: {
    borderColor: '#2f4f3d',
    backgroundColor: '#e3eadb',
  },
  mapRoomName: {
    flex: 1,
    color: '#1f241e',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
  },
  mapRoomMeta: {
    color: '#56645c',
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
    borderColor: '#a8b78d',
    borderRadius: 8,
    backgroundColor: '#f3f7ee',
  },
  equipmentSlotLabel: {
    color: '#56645c',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  equipmentName: {
    color: '#1f241e',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
    textTransform: 'capitalize',
  },
  panelTitle: {
    color: '#1f241e',
    fontSize: 18,
    fontWeight: '900',
  },
  emptyText: {
    color: '#5f5648',
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
    borderColor: '#c8b998',
    borderRadius: 8,
    backgroundColor: '#fffaf0',
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
    color: '#1f241e',
    fontSize: 15,
    fontWeight: '900',
  },
  statePill: {
    color: '#4d4539',
    backgroundColor: '#eee4d0',
    borderColor: '#c8b998',
    borderWidth: 1,
    borderRadius: 8,
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 2,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  ownedPill: {
    color: '#21452f',
    backgroundColor: '#dfeadc',
    borderColor: '#8eaa7a',
  },
  affordablePill: {
    color: '#4f361c',
    backgroundColor: '#f1dfb7',
    borderColor: '#b89550',
  },
  itemDescription: {
    color: '#5f5648',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  traitText: {
    color: '#6a4e22',
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
    color: '#2f4f3d',
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
    borderTopColor: '#c8b998',
  },
  upgradeTextBlock: {
    flex: 1,
  },
  upgradeName: {
    color: '#1f241e',
    fontSize: 15,
    fontWeight: '900',
  },
  upgradeDetail: {
    color: '#5f5648',
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
    borderBottomColor: '#d0c5ad',
  },
  toolbarText: {
    color: '#3d3327',
    fontSize: 14,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  saveNotice: {
    color: '#56645c',
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
    borderColor: '#8f3d33',
  },
  enemyName: {
    color: '#5f241f',
    fontSize: 19,
    fontWeight: '900',
  },
  enemyHp: {
    color: '#5f241f',
    fontSize: 15,
    fontWeight: '800',
    marginTop: 4,
  },
  intentPanel: {
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#b86a42',
    borderRadius: 8,
    backgroundColor: '#fff1df',
    gap: 4,
  },
  intentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  intentLabel: {
    color: '#6a2f22',
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  intentDanger: {
    color: '#6a2f22',
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  intentText: {
    color: '#332820',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
  },
  pressurePanel: {
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: '#8f3d33',
    borderRadius: 8,
    backgroundColor: '#fbe7df',
    gap: 3,
  },
  pressureLabel: {
    color: '#6a2f22',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  pressureText: {
    color: '#332820',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  statusRow: {
    marginTop: 10,
    gap: 6,
  },
  statusLabel: {
    color: '#4d4539',
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
    color: '#1f241e',
    backgroundColor: '#d8e4cf',
    borderColor: '#8eaa7a',
    borderWidth: 1,
    borderRadius: 8,
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
    borderTopColor: '#d0c5ad',
  },
  abilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#a8b78d',
    borderRadius: 8,
    backgroundColor: '#f3f7ee',
  },
  abilitySelectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#c8b998',
    borderRadius: 8,
    backgroundColor: '#fffaf0',
  },
  selectedAbilityRow: {
    borderColor: '#2f4f3d',
    backgroundColor: '#e3eadb',
  },
  log: {
    gap: 6,
  },
  logLine: {
    color: '#56645c',
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
    borderRadius: 8,
    backgroundColor: '#ebe2cf',
    borderWidth: 1,
    borderColor: '#c8b998',
  },
  summaryLine: {
    color: '#3d3327',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
});

// Static game definitions: stats, slots, rarities and optimizer presets.

export const STATS = [
  { key: 'health', label: 'Health', unit: '', color: '#e5393b' },
  { key: 'attackDamage', label: 'Attack dmg.', unit: '', color: '#f2a516' },
  { key: 'defense', label: 'Defense', unit: '', color: '#1d7fc1' },
  { key: 'projectileDamage', label: 'Projectile dmg.', unit: '', color: '#f2741f' },
  { key: 'mana', label: 'Mana', unit: '', color: '#2353b0' },
  { key: 'attackSpeed', label: 'Attack speed', unit: '%', color: '#f0a020' },
  { key: 'critChance', label: 'Crit. chance', unit: '%', color: '#d99a17' },
  { key: 'critDamage', label: 'Crit. damage', unit: '%', color: '#e0442a' },
  { key: 'cooldownReduction', label: 'Cooldown red.', unit: '%', color: '#4f5bc4' },
  { key: 'moveSpeed', label: 'Move speed', unit: '%', color: '#17a37f' },
  { key: 'bonusHealing', label: 'Bonus healing', unit: '', color: '#2cb04a' },
  { key: 'skillDamage', label: 'Skill damage', unit: '', color: '#f06a1c' },
  { key: 'dodge', label: 'Dodge', unit: '', color: '#1a9e95' },
  { key: 'damageReduction', label: 'Damage red.', unit: '%', color: '#1b7686' },
  { key: 'magicDamage', label: 'Magic damage', unit: '', color: '#7b3cc8' },
  { key: 'tenacity', label: 'Tenacity', unit: '%', color: '#c0662b' },
  // Stats that appear on item tooltips but not on the in-game status screen; the Status panel lists them only when non-zero.
  { key: 'physicalDamage', label: 'Physical dmg.', unit: '%', color: '#b5532a', extra: true },
  { key: 'skillCritChance', label: 'Skill crit. chance', unit: '%', color: '#c2830f', extra: true },
  { key: 'skillCritDamage', label: 'Skill crit. dmg.', unit: '%', color: '#c9372c', extra: true },
  { key: 'lifeSteal', label: 'Life steal', unit: '%', color: '#a61e3a', extra: true },
  { key: 'spellVampirism', label: 'Spell vampirism', unit: '%', color: '#8a2fa8', extra: true },
  { key: 'maxStamina', label: 'Stamina', unit: '', color: '#7fa31a', extra: true },
  { key: 'healthRegen', label: 'Health regen', unit: '/s', color: '#d9455f', extra: true },
  { key: 'manaRegen', label: 'Mana regen', unit: '/s', color: '#3a78d6', extra: true },
  { key: 'staminaRegen', label: 'Stamina regen', unit: '/s', color: '#5f8f12', extra: true },
];

export const STAT_KEYS = STATS.map((s) => s.key);
export const STAT_MAP = Object.fromEntries(STATS.map((s) => [s.key, s]));

export const SLOT_TYPES = {
  glove: { label: 'Glove', group: 'accessory' },
  amulet: { label: 'Amulet', group: 'accessory' },
  bracelet: { label: 'Bracelet', group: 'accessory' },
  ring: { label: 'Ring', group: 'accessory', duplicates: true }, // the only item that can be worn twice
  artifact: { label: 'Artifact', group: 'accessory' },
  helmet: { label: 'Helmet', group: 'armor' },
  chestplate: { label: 'Chestplate', group: 'armor' },
  leggings: { label: 'Leggings', group: 'armor' },
  boots: { label: 'Boots', group: 'armor' },
  offhand: { label: 'Offhand', group: 'armor' },
};
export const SLOT_TYPE_KEYS = Object.keys(SLOT_TYPES);

// Equipment slot instances, in the same 3-column layout as the in-game screen.
export const SLOTS = [
  { id: 'glove', type: 'glove', label: 'Glove' },
  { id: 'helmet', type: 'helmet', label: 'Helmet' },
  { id: 'amulet', type: 'amulet', label: 'Amulet' },
  { id: 'artifact1', type: 'artifact', label: 'Artifact I' },
  { id: 'chestplate', type: 'chestplate', label: 'Chestplate' },
  { id: 'bracelet', type: 'bracelet', label: 'Bracelet' },
  { id: 'artifact2', type: 'artifact', label: 'Artifact II' },
  { id: 'leggings', type: 'leggings', label: 'Leggings' },
  { id: 'ring1', type: 'ring', label: 'Ring I' },
  { id: 'artifact3', type: 'artifact', label: 'Artifact III' },
  { id: 'boots', type: 'boots', label: 'Boots' },
  { id: 'ring2', type: 'ring', label: 'Ring II' },
  { id: 'offhand', type: 'offhand', label: 'Offhand' },
];
export const SLOT_MAP = Object.fromEntries(SLOTS.map((s) => [s.id, s]));

// Texture folders copied from the server resource pack by import-textures.js, in display order.
export const TEXTURE_PACKS = {
  nerfs: 'Server accessories',
  hsur: 'HSUR accessories',
  mctrinketsringsvol1: 'Rings vol. 1',
  mcfantasytrinketsvol2: 'Fantasy necklaces vol. 2',
  trinketsvol3: 'Trinkets vol. 3',
};

// Texture names are grouped by prefix (the first word). The server names its textures in French.
export const TEXTURE_MULTI_PREFIXES = ['boucle_oreille', 'feu_follet'];
export const TEXTURE_PREFIX_LABELS = {
  amulette: 'Amulet', anneau: 'Ring', antenne: 'Antenna', bague: 'Ring', bottes: 'Boots', boucle_oreille: 'Earring', bourse: 'Purse',
  bouclier: 'Shield', cagoule: 'Balaclava', capuche: 'Hood', carapace: 'Shell', casque: 'Helmet', ceinture: 'Belt',
  chapeau: 'Hat', charme: 'Charm', chat: 'Cat', collier: 'Necklace', couronne: 'Crown', couteau: 'Knife', crane: 'Skull',
  dent: 'Tooth', feu_follet: 'Wisp', fleur: 'Flower', gants: 'Gloves', hache: 'Axe', lanterne: 'Lantern', manteau: 'Coat',
  masque: 'Mask', orbe: 'Orb', patte: 'Leg', pendentif: 'Pendant', piece: 'Coin', plume: 'Feather', poignard: 'Dagger',
  sablier: 'Hourglass', tissu: 'Cloth',
};

export const RARITIES = [
  { key: 'common', label: 'Common', color: '#9aa4b2' },
  { key: 'uncommon', label: 'Uncommon', color: '#3fb950' },
  { key: 'rare', label: 'Rare', color: '#2f81f7' },
  { key: 'epic', label: 'Epic', color: '#a371f7' },
  { key: 'legendary', label: 'Legendary', color: '#f5a524' },
  { key: 'mythic', label: 'Mythic', color: '#e5484d' },
  { key: 'event', label: 'Event', color: '#e0458f' }, // pink / red / rainbow tooltips
];
export const RARITY_MAP = Object.fromEntries(RARITIES.map((r) => [r.key, r]));

// Weight = how much one point of a stat is worth. Starting points only — tune them to your class.
export const PRESETS = {
  balanced: {
    label: 'Balanced',
    weights: {
      health: 0.2, attackDamage: 1, defense: 0.5, projectileDamage: 0.6, mana: 0.1, attackSpeed: 0.5,
      critChance: 0.6, critDamage: 0.15, cooldownReduction: 0.5, moveSpeed: 0.3, bonusHealing: 0.2,
      skillDamage: 0.5, dodge: 0.4, damageReduction: 1, magicDamage: 0.6, tenacity: 0.3,
      physicalDamage: 0.6, skillCritChance: 0.3, skillCritDamage: 0.08, lifeSteal: 0.3, spellVampirism: 0.2,
      maxStamina: 0.1, healthRegen: 2, manaRegen: 1, staminaRegen: 0.5,
    },
  },
  melee: {
    label: 'Melee DPS',
    weights: {
      health: 0.1, attackDamage: 1, defense: 0.2, attackSpeed: 0.7, critChance: 0.8, critDamage: 0.2,
      cooldownReduction: 0.3, moveSpeed: 0.1, skillDamage: 0.4, dodge: 0.1,
      physicalDamage: 0.8, lifeSteal: 0.3, maxStamina: 0.1, staminaRegen: 0.5,
    },
  },
  ranged: {
    label: 'Ranged',
    weights: {
      health: 0.1, projectileDamage: 1, attackSpeed: 0.6, critChance: 0.8, critDamage: 0.2,
      cooldownReduction: 0.3, moveSpeed: 0.2, skillDamage: 0.4, dodge: 0.2,
      physicalDamage: 0.4, maxStamina: 0.1, staminaRegen: 0.5,
    },
  },
  magic: {
    label: 'Mage',
    weights: {
      health: 0.1, mana: 0.3, critChance: 0.4, critDamage: 0.1, cooldownReduction: 0.8,
      skillDamage: 0.6, magicDamage: 1, moveSpeed: 0.1,
      skillCritChance: 0.6, skillCritDamage: 0.15, spellVampirism: 0.3, manaRegen: 2,
    },
  },
  tank: {
    label: 'Tank',
    weights: {
      health: 0.4, defense: 1, moveSpeed: 0.1, bonusHealing: 0.4, dodge: 0.8, damageReduction: 2, tenacity: 0.6,
      lifeSteal: 0.3, healthRegen: 4,
    },
  },
};

// Base stats depend on class and skill tree, so the player always enters them by hand.
export const DEFAULT_BASE_STATS = Object.fromEntries(STAT_KEYS.map((k) => [k, 0]));

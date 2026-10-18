// Inline SVG icon set (stat glyphs, equipment slots, UI).

const sparkle = (cx, cy, r) => {
  const a = r * 0.28;
  return `M${cx} ${cy - r}L${cx + a} ${cy - a}L${cx + r} ${cy}L${cx + a} ${cy + a}L${cx} ${cy + r}L${cx - a} ${cy + a}L${cx - r} ${cy}L${cx - a} ${cy - a}Z`;
};
const stroke = (d, w = 2) =>
  `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

const HEART = 'M12 20.3l-1.3-1.2C6 14.9 3 12.2 3 8.8 3 6.1 5.1 4 7.8 4c1.5 0 3 .7 4.2 1.9C13.2 4.7 14.7 4 16.2 4 18.9 4 21 6.1 21 8.8c0 3.4-3 6.1-7.7 10.3z';
const SHIELD = 'M12 2l8 3v6.5c0 4.9-3.4 9.1-8 10.5-4.6-1.4-8-5.6-8-10.5V5z';
const SWORD = 'M20.5 3.5L14 5 6.5 12.5l5 5L19 10z M3.8 12.3l1.4-1.4 7.9 7.9-1.4 1.4z M5.6 16.9l1.5 1.5-3 3-1.5-1.5z';
const DROP = 'M12 2.5c3.5 4.5 6.5 8.2 6.5 11.6a6.5 6.5 0 0 1-13 0C5.5 10.7 8.5 7 12 2.5z';
const BURST = 'M12 2l2 5.5 5-3-2.2 5.3L22 12l-5.2 2.2 2.2 5.3-5-3L12 22l-2-5.5-5 3 2.2-5.3L2 12l5.2-2.2L5 4.5l5 3z';
const FANGS = 'M3 3.5h18v3.2C21 8 20 9 18.7 9h-1.4l-2.1 8-2-8h-2.4l-2 8-2.1-8H5.3C4 9 3 8 3 6.7z';
const CROSSHAIR = `<circle cx="12" cy="12" r="6.6" fill="none" stroke="currentColor" stroke-width="2"/>${stroke('M12 2.5v4.5M12 17v4.5M2.5 12H7M17 12h4.5')}`;

const STAT_GLYPHS = {
  health: `<path d="${HEART}"/>`,
  attackDamage: `<path d="${SWORD}"/>`,
  defense: `<path d="${SHIELD}"/>`,
  projectileDamage: stroke('M3 12h15M14.5 8l4 4-4 4M3.5 8.5l3 3.5-3 3.5M7.5 8.5l3 3.5-3 3.5', 2.1),
  mana: `<path fill-rule="evenodd" d="${DROP} ${sparkle(12, 14.6, 3.4)}"/>`,
  attackSpeed: `<path d="${SWORD}"/>${stroke('M3 4h6M2.5 7.5h4', 1.8)}`,
  critChance: `${CROSSHAIR}<circle cx="12" cy="12" r="1.9"/>`,
  critDamage: `<path d="${BURST}"/>`,
  cooldownReduction: '<path d="M6 2.5h12v2h-1.3c0 3.2-2.2 5.5-3.7 7.5 1.5 2 3.7 4.3 3.7 7.5H18v2H6v-2h1.3c0-3.2 2.2-5.5 3.7-7.5C9.5 10 7.3 7.7 7.3 4.5H6z"/>',
  moveSpeed: `<path d="M9 3h6v9l4.6 2.3c1.2.6 1.9 1.6 1.9 2.8V19H9z M8 20h14v1.8H8z"/>${stroke('M2.5 9h4M3.5 13h3', 1.8)}`,
  bonusHealing: `<path fill-rule="evenodd" d="${HEART} M11 7.5h2v3h3v2h-3v3h-2v-3H8v-2h3z"/>`,
  skillDamage: '<path d="M12 2c.8 3.2 5.5 5.6 5.5 11a5.5 5.5 0 0 1-11 0c0-2.8 1.5-4.6 2.8-5.8-.1 2 .7 3.4 2 3.9C11 8.5 10.5 5.2 12 2z"/>',
  dodge: `<circle cx="15" cy="4.5" r="2.3"/>${stroke('M7 9.5l4-2 3 2.5 2.5 3H20M11 7.5l-1.5 6 3.5 3-1 5M9.5 13.5l-3 3.5H3', 2.1)}`,
  damageReduction: `<path fill-rule="evenodd" d="${SHIELD} M8 10.4h8v2.4H8z"/>`,
  magicDamage: `<path d="M4.5 18.1L15.4 7.2l1.4 1.4L5.9 19.5z ${sparkle(18.5, 4.8, 3.3)} ${sparkle(8.5, 5.5, 2.2)} ${sparkle(19, 14, 2.2)}"/>`,
  tenacity: '<path d="M2.5 19.5l6.2-11 3.6 5.2 2.4-3.4 6.8 9.2z"/>',
  physicalDamage: '<path d="M5 3.5h14V10H5z M10.7 10h2.6v11.5h-2.6z"/>',
  skillCritChance: `${CROSSHAIR}<path d="${sparkle(12, 12, 3.4)}"/>`,
  skillCritDamage: `<path fill-rule="evenodd" d="${BURST} ${sparkle(12, 12, 3.4)}"/>`,
  lifeSteal: `<path d="${FANGS} M19 13.5c1.4 2 2.5 3.4 2.5 4.8a2.5 2.5 0 0 1-5 0c0-1.4 1.1-2.8 2.5-4.8z"/>`,
  spellVampirism: `<path d="${FANGS} ${sparkle(19, 17.5, 3.6)}"/>`,
  maxStamina: '<path d="M13.5 2L5 13.5h5.8L9.5 22 19 10h-5.8z"/>',
  healthRegen: `<path fill-rule="evenodd" d="${HEART} M12 7.2l4 4.3h-2.6v4.3h-2.8v-4.3H8z"/>`,
  manaRegen: `<path fill-rule="evenodd" d="${DROP} M12 9.8l3.6 3.8h-2.3v4h-2.6v-4H8.4z"/>`,
  staminaRegen: `<path d="M10.5 2L3 13h5L7 22l8.5-11.5h-5z"/>${stroke('M19.5 20.5V11M16.3 14.2l3.2-3.2 3.2 3.2', 2)}`,
};

const SLOT_GLYPHS = {
  glove:
    '<path d="M13 9.5a1.6 1.6 0 0 1 3.2 0V22H13z M17.6 7a1.6 1.6 0 0 1 3.2 0v15h-3.2z M22.2 8a1.6 1.6 0 0 1 3.2 0v14h-3.2z M26.8 11a1.6 1.6 0 0 1 3.2 0v11h-3.2z M12 23.5h19.5v9H12z M31.5 25l4.7-4.4 2.6 2.6-5.5 6.3h-1.8z M10.5 34.5h23.5l1 6H9.5z"/>',
  helmet:
    '<path fill-rule="evenodd" d="M17 7h14l6 6.5V29l-4.5 9h-17L11 29V13.5z M13.5 19h21v2.6h-21z M18.5 25h2.6v8h-2.6z M22.7 25h2.6v8h-2.6z M26.9 25h2.6v8h-2.6z"/>',
  amulet:
    `${stroke('M8 7.5c3 9 9 14 16 14s13-5 16-14', 2.6)}<rect x="21.5" y="19.5" width="5" height="5.5" rx="1"/><path fill-rule="evenodd" d="M24 25a8.6 8.6 0 1 1 0 17.2a8.6 8.6 0 1 1 0-17.2z M24 28.4l1.6 4 4 1.6-4 1.6-1.6 4-1.6-4-4-1.6 4-1.6z"/>`,
  artifact:
    '<path d="M24 4.5l5.2 14.5L24 43.5l-5.2-24.5z M21.2 42.5L8.5 30.5 5.5 21.5l10 4.5z M26.8 42.5l12.7-12 3-9-10 4.5z"/>',
  chestplate:
    '<path fill-rule="evenodd" d="M17 7.5l-9.5 5 3 9.5 4.5-2.2V41h18V19.8l4.5 2.2 3-9.5-9.5-5c-1 2.6-3.6 4.2-7 4.2s-6-1.6-7-4.2z M22.9 21h2.2v16h-2.2z M17.5 27h4v1.6h-4z M26.5 27h4v1.6h-4z"/>',
  bracelet:
    '<path fill-rule="evenodd" d="M15 14h18l7 6v8l-7 6H15l-7-6v-8z M17 18.2l-4.8 3.8v4l4.8 3.8h14l4.8-3.8v-4L31 18.2z"/><path d="M24 30.5l3 3.5-3 3.5-3-3.5z"/>',
  ring:
    '<path d="M20.5 5h7l3.2 4.2-3.2 4.3h-7l-3.2-4.3z"/><path fill-rule="evenodd" d="M19 15.5h10l6 6v10l-6 6H19l-6-6v-10z M20.6 19.5L17 23.1v6.8l3.6 3.6h6.8l3.6-3.6v-6.8l-3.6-3.6z"/>',
  leggings: '<path d="M13 7.5h22v5.2H13z M13 14.5h22l-1.2 26.5h-8.3L24 23l-1.5 18h-8.3z"/>',
  boots:
    '<path fill-rule="evenodd" d="M15 6.5h10.5v20.5l9.6 4.8c2 1 3 2.6 3 4.4V39H15z M15 10.5h10.5v2H15z"/><path d="M14 40.5h25.5V43H14z"/>',
  offhand:
    '<path d="M17 13.5a2 2 0 0 1 4 0V26h-4z M22 9.5a2 2 0 0 1 4 0V26h-4z M27 11.5a2 2 0 0 1 4 0V26h-4z M32 15.5a2 2 0 0 1 4 0V28h-4z M17 25h19v8c0 5-3.6 8.5-8.5 8.5H25c-4.6 0-8-3.4-8-8z M17 27.5L10.6 21 8 23.6l9 10z"/>',
  rune: '<path fill-rule="evenodd" d="M24 4l15 8.5v23L24 44 9 35.5v-23z M21.5 13h3v22h-3z M24.5 14.5l6 5-2 2.2-6-5z M24.5 23.5l6 6.5-2 2-6-6.5z"/>',
};

const UI = {
  equip: '<path d="M12 2.5a4 4 0 1 1 0 8 4 4 0 0 1 0-8z M4.5 21c0-4.6 3.4-8.2 7.5-8.2s7.5 3.6 7.5 8.2z"/>',
  items: '<path fill-rule="evenodd" d="M8 7.5V6.5a4 4 0 0 1 8 0v1h3.2l1.3 14H3.5l1.3-14z M10 7.5h4v-1a2 2 0 0 0-4 0z"/>',
  sets: '<path d="M12 2.5l9.5 5-9.5 5-9.5-5z M4.7 11.3L12 15.2l7.3-3.9 2.2 1.2-9.5 5-9.5-5z M4.7 15.8L12 19.7l7.3-3.9 2.2 1.2-9.5 5-9.5-5z"/>',
  optimizer: `<path d="${sparkle(10, 13, 8)} ${sparkle(18.5, 5.5, 3.6)}"/>`,
  profile: '<path d="M4 20.5V11h3.4v9.5z M10.3 20.5V4h3.4v16.5z M16.6 20.5v-7h3.4v7z"/>',
  lock: '<path fill-rule="evenodd" d="M7 10V7.5a5 5 0 0 1 10 0V10h1.5v11h-13V10z M9.5 10h5V7.5a2.5 2.5 0 0 0-5 0z"/>',
  unlock: '<path fill-rule="evenodd" d="M7 10V7.5a5 5 0 0 1 9.6-2l-2.3 1A2.5 2.5 0 0 0 9.5 7.5V10h9v11h-13V10z"/>',
  plus: stroke('M12 5v14M5 12h14', 2.4),
  edit: '<path d="M4 17.2V20h2.8L17 9.8 14.2 7z M18.4 8.4l1.4-1.4c.4-.4.4-1 0-1.4l-1.4-1.4c-.4-.4-1-.4-1.4 0l-1.4 1.4z"/>',
  trash: '<path d="M6 7h12l-1 14H7z M4.5 4.5h4l1-1.5h5l1 1.5h4v2h-15z"/>',
  copy: '<path fill-rule="evenodd" d="M8 3h11v13H8z M10 5v9h7V5z M4.5 7.5H6.5v11h9v2h-11z"/>',
  close: stroke('M6 6l12 12M18 6L6 18', 2.4),
  check: stroke('M4.5 12.5l5 5 10-11', 2.6),
  search: `<circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="2.2"/>${stroke('M15 15l5 5', 2.4)}`,
  play: '<path d="M7 4.5l13 7.5-13 7.5z"/>',
  refresh: stroke('M19 8a7.5 7.5 0 1 0 1 6M19.5 3.5V8.5h-5', 2.2),
  save: '<path fill-rule="evenodd" d="M4 3h13l3 3v15H4z M7 5v5h9V5z M12 13a3 3 0 1 1 0 6 3 3 0 0 1 0-6z"/>',
  image: '<path fill-rule="evenodd" d="M3 4.5h18v15H3z M5 6.5v8.6l4-4 3.5 3.5 2.5-2.5 4 4V6.5z M15.5 8a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6z"/>',
  diamond: '<path d="M12 2l10 10-10 10L2 12z"/>',
  info: '<path fill-rule="evenodd" d="M12 2.5a9.5 9.5 0 1 1 0 19 9.5 9.5 0 0 1 0-19z M11 10.5h2V17h-2z M12 6.5a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6z"/>',
  swap: stroke('M4 8h14l-3.5-3.5M20 16H6l3.5 3.5', 2.2),
};

export function statIcon(key) {
  return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${STAT_GLYPHS[key] || UI.diamond}</svg>`;
}

export function slotIcon(type) {
  return `<svg viewBox="0 0 48 48" fill="currentColor" aria-hidden="true">${SLOT_GLYPHS[type] || ''}</svg>`;
}

export function uiIcon(name) {
  return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${UI[name] || ''}</svg>`;
}

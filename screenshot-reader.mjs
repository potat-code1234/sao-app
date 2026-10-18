// Reads an in-game item tooltip screenshot with Claude and returns it as structured data.
// Used by the server's POST /api/import/read. Needs `npm install` and ANTHROPIC_API_KEY.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { STATS, SLOT_TYPES, RARITIES } from './public/js/data.js';

export { Anthropic };

const StatLine = z.object({ key: z.enum(STATS.map((s) => s.key)), value: z.number() });
export const Reading = z.object({
  language: z.enum(['en', 'fr', 'other']),
  kind: z.enum(['equipment', 'rune', 'other']),
  name: z.string(),
  existing_item: z.string().nullable(),
  level: z.number().int().nullable(),
  rarity: z.enum(RARITIES.map((r) => r.key)),
  slot: z.enum(Object.keys(SLOT_TYPES)).nullable(),
  stats: z.array(StatLine),
  unmapped: z.array(z.string()),
  set: z
    .object({
      name: z.string(),
      existing_set: z.string().nullable(),
      bonuses: z.array(z.object({ pieces: z.number().int(), stats: z.array(StatLine), unmapped: z.array(z.string()) })),
    })
    .nullable(),
});

const STAT_NAMES = `
health: Health, Max Health | Santé, Santé Max
attackDamage: Attack Damage | Dégâts d'attaque
defense: Defense | Défense
projectileDamage: Projectile Damage | Dégâts Projectile
mana: Max Mana, Mana | Mana Max
attackSpeed: Attack Speed | Vitesse d'attaque
critChance: Critical Chance, Critical Hit Chance | Chance Critique
critDamage: Critical Damage, Critical Power | Dégâts Critique, Puissance Critique
cooldownReduction: Ability Haste, Cooldown Reduction | Hâte d'aptitude
moveSpeed: Movement Speed | Vitesse de Déplacement
bonusHealing: Bonus Healing | Soins Bonus
skillDamage: Skill Damage | Dégâts de Compétence
dodge: Dodge, Dodge Chance | Esquive
damageReduction: Damage Reduction | Réduction de Dégâts
magicDamage: Magic Damage | Dégâts Magique(s)
tenacity: Tenacity | Ténacité
physicalDamage: Physical Damage | Dégâts Physique(s)
skillCritChance: Skill Critical Chance, Skill Critical Hit Chance | Chance Critique de Compétence
skillCritDamage: Skill Critical Damage | Dégâts Critique de Compétence
lifeSteal: Life Steal | Vol de vie
spellVampirism: Spell Vampirism, Vampirism | Vampirisme
maxStamina: Max Stamina, Stamina Max | Stamina Max
healthRegen: Health Regeneration, Health/s | Régénération Santé, Santé/s
manaRegen: Mana Regeneration, Mana/s | Régénération Mana, Mana/s
staminaRegen: Stamina Regeneration, Stamina/s | Régénération Stamina, Stamina/s`.trim();

function systemPrompt(items, sets) {
  return `You read item tooltips from screenshots of a Minecraft MMORPG (Sword Art Online server) and return them as structured data for a gear optimizer.

Fields:
- language: the language the tooltip text is written in ("en" English, "fr" French, otherwise "other").
- kind: "rune" when the category says Rune; "other" for materials, potions and anything that can't be equipped; otherwise "equipment".
- name: the item title exactly as shown.
- existing_item: when this is the same item as one in the list of existing items below, that exact name; otherwise null.
- level: the "Minimum Level" / "Niveau Minimum" number, or null when not shown.
- rarity: from the colour of the tooltip frame: yellow or gold = legendary, purple = epic, blue = rare, green = uncommon, grey = common; any other colour or a themed frame (pink, red, rainbow, festive) = event.
- slot: from the Category line: Ring = ring, Gloves = glove, Amulet or Necklace = amulet, Bracelet = bracelet, Artifact = artifact, and the armor categories helmet, chestplate, leggings, boots, offhand. Equipment with no category shown is an artifact. null for runes and other items.
- stats: every stat line, mapped to a key from the table below. value is the number shown, without % or /s, keeping a minus sign.
- unmapped: stat lines that match no key (for example block chance, parry chance, knockback resistance, fall damage reduction, healing received), copied as shown.
- set: the set section (the line after the diamond marker) or null. existing_set: the exact name from the list of existing sets when it is the same set, else null. bonuses: one entry per [n] tier with n as pieces; lines without a [n] belong to the tier above them. In set bonuses, "Max Health" / "Santé Max" is health, and "Health/s", "Mana/s", "Stamina/s" are the regeneration stats.

Stat keys (English names | French names):
${STAT_NAMES}

Existing items: ${items.map((i) => i.name).join('; ') || 'none'}
Existing sets: ${sets.map((s) => s.name).join('; ') || 'none'}`;
}

let client = null;

/** image: { mediaType: 'image/png' | ..., data: base64 }. Resolves to a Reading. */
export async function readScreenshot(image, items, sets) {
  client ||= new Anthropic();
  const msg = await client.beta.messages.parse({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default', // if a safety classifier declines, another model answers instead
    output_config: { effort: 'medium', format: betaZodOutputFormat(Reading) },
    cache_control: { type: 'ephemeral' }, // the system prompt is the same for every screenshot
    system: systemPrompt(items, sets),
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } },
          { type: 'text', text: 'Read this tooltip.' },
        ],
      },
    ],
  });
  if (msg.stop_reason === 'refusal') throw new Error('Claude declined to read this image.');
  if (msg.stop_reason === 'max_tokens' || !msg.parsed_output) throw new Error('Claude could not read a complete answer.');
  return msg.parsed_output;
}

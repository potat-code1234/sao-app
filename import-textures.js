// Copies item textures into ./Textures: accessories, armor and runes from the Triggers Client's SAO server
// resource pack, plus Minecraft's own armor icons from the game .jar.
// Run: node import-textures.js [path\to\resourcepacks\sao\assets]   (re-run after the server pack updates)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { renderItemModel } = require('./render-model');

const CLIENT = path.join(process.env.APPDATA || '', '.Triggers Client');
const ASSETS = process.argv[2] || path.join(CLIENT, 'instances', 'Sword Art Online', 'resourcepacks', 'sao', 'assets');
const OUT = path.join(__dirname, 'Textures');

// Armor icons in the pack, found by name and size: inventory icons are square and at most 32px, while 3D
// armor models use bigger, unfolded texture sheets. Left out: worn-armor skins ("layer"), glow overlays ("_e"),
// skill and GUI images, bare "helmet"/"boots" slot placeholders, the server's own pack (already in "nerfs"),
// cosmetic packs (3D hats) and a few sheets whose names look like icons.
const ARMOR = /helmet|chestplate|leggings|boots|shield|crown|hood|(^|_)hat($|_|\d)/i;
const NOT_ARMOR_NAME = /layer|_e$|^icon_|emissive|glow|_overlay$|^(helmet|chestplate|leggings|boots|shield|empty)$|^(bone_shield|hat_lovestruck_em)$/i;
const NOT_ARMOR_PATH = /^(nerfs|lk|scenes|elitecreatures|shizuart_furnitures|cosmetic_pack\w*|lanshan_cos_\w+)\/|\/(gui|font|ui|abilities|skills?|mmoinventory|equipment_room|accessory|particles?|entity)\//i;
// Helmets that only exist as 3D models get an icon rendered from the model. Mob model parts, cosmetic hats and
// furniture are left out.
const HELMET_MODEL = /helmet|casque|hood|capuche|crown|couronne/i;
const NOT_HELMET_MODEL = /^(modelengine|elitecreatures|shizuart_furnitures|cosmetic_pack\w*|lanshan_cos_\w+|nogs_menagerie|mimix_\w+|littleroom_\w+|yungwilder|ghostpepper_\w+|ero_\w+)\/|cosmetic/i;
const VANILLA_ARMOR =/^assets\/minecraft\/textures\/item\/((leather|chainmail|iron|golden|diamond|netherite)_(helmet|chestplate|leggings|boots)|turtle_helmet)\.png$/;

// Textures folder -> sources: folders or single .png files inside the pack, or functions returning [{ name, data }].
// mmoitems_pack's accessories are duplicates of hsur's. The server keeps some accessories outside
// "accessoires": the coins, and the Occult Skull (runes/ritual_skull).
const SOURCES = {
  nerfs: ['nerfs/textures/accessoires', 'nerfs/textures/coins', 'nerfs/textures/runes/ritual_skull.png'],
  armor: [armorIcons, vanillaArmor, helmetModels],
  runes: ['nerfs/textures/runes'],
  hsur: ['hsur/textures/custom/items/accessory'],
  mctrinketsringsvol1: ['mctrinketsringsvol1/textures/item'],
  mcfantasytrinketsvol2: ['mcfantasytrinketsvol2/textures/item'],
  trinketsvol3: ['trinketsvol3/textures/item'],
};

function walk(dir, fn) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, fn);
    else fn(p);
  }
}

function armorIcons() {
  const found = [];
  walk(ASSETS, (p) => {
    if (!p.endsWith('.png')) return;
    const rel = path.relative(ASSETS, p).split(path.sep).join('/');
    const name = path.basename(rel, '.png').replace(/_icon$/i, '');
    if (ARMOR.test(name) && !NOT_ARMOR_NAME.test(name) && !NOT_ARMOR_PATH.test(rel)) found.push({ name, data: fs.readFileSync(p), from: rel.split('/')[0] });
  });
  return found;
}

// Icons rendered from 3D helmet models, named <model>_3d ("helmet" alone gets its pack's name first).
function helmetModels() {
  const found = [];
  walk(ASSETS, (p) => {
    const rel = path.relative(ASSETS, p).split(path.sep).join('/');
    const name = path.basename(p, '.json');
    if (!p.endsWith('.json') || !rel.includes('/models/') || !HELMET_MODEL.test(name) || NOT_HELMET_MODEL.test(rel)) return;
    let model;
    try {
      model = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      return;
    }
    if (!Array.isArray(model.elements)) return;
    const ns = rel.split('/')[0];
    try {
      const data = renderItemModel(ASSETS, p, 128);
      const base = /^(helmet|hood|crown)$/i.test(name) ? `${ns.replace(/_?set$/i, '')}_${name}` : name;
      if (data) found.push({ name: `${base}_3d`, data, from: ns, rendered: true });
    } catch (e) {
      console.warn(`  skip ${rel}: ${e.message}`);
    }
  });
  return found;
}

// Only true icons go in a pack with a filter: for armor, square images of at most 32px (vanilla icons
// included), plus the icons rendered from 3D models.
const FILTERS = {
  armor: ({ data, rendered }) => rendered || (data.readUInt32BE(16) === data.readUInt32BE(20) && data.readUInt32BE(16) <= 32),
};

// Minecraft's armor icons, read from the newest game .jar of the Triggers Client (or the official launcher).
function vanillaArmor() {
  const dirs = [path.join(CLIENT, 'versions'), path.join(process.env.APPDATA || '', '.minecraft', 'versions')];
  const versionKey = (v) => v.split(/\D+/).filter(Boolean).map((n) => n.padStart(4, '0')).join('.');
  for (const dir of dirs.filter((d) => fs.existsSync(d))) {
    const versions = fs.readdirSync(dir).filter((v) => fs.existsSync(path.join(dir, v, `${v}.jar`)));
    if (!versions.length) continue;
    const newest = versions.sort((a, b) => versionKey(b).localeCompare(versionKey(a)))[0];
    return zipEntries(path.join(dir, newest, `${newest}.jar`), VANILLA_ARMOR).map((e) => ({ name: path.basename(e.name, '.png'), data: e.data, from: 'minecraft' }));
  }
  console.warn('  skip Minecraft armor icons: no game .jar found');
  return [];
}

/** Entries of a zip file whose name matches `want`: [{ name, data }]. Stored and deflated entries only. */
function zipEntries(file, want) {
  const buf = fs.readFileSync(file);
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error(`${file} is not a zip file`);
  const out = [];
  for (let i = 0, p = buf.readUInt32LE(end + 16); i < buf.readUInt16LE(end + 10); i++) {
    const nameLen = buf.readUInt16LE(p + 28);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (want.test(name)) {
      const local = buf.readUInt32LE(p + 42);
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const raw = buf.subarray(start, start + buf.readUInt32LE(p + 20));
      out.push({ name, data: buf.readUInt16LE(p + 10) === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw) });
    }
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return out;
}

function fromPack(rel) {
  const src = path.join(ASSETS, rel);
  if (!fs.existsSync(src)) {
    console.warn(`  skip ${rel}: not found`);
    return [];
  }
  const files = rel.toLowerCase().endsWith('.png')
    ? [src]
    : fs.readdirSync(src).filter((f) => f.toLowerCase().endsWith('.png')).map((f) => path.join(src, f));
  return files.map((f) => ({ name: path.basename(f, '.png'), data: fs.readFileSync(f), from: path.basename(path.dirname(f)) }));
}

if (!fs.existsSync(ASSETS)) {
  console.error(`Resource pack not found: ${ASSETS}\nJoin the server once so the client downloads it, or pass the pack's assets folder as an argument.`);
  process.exit(1);
}

let total = 0;
for (const [pack, sources] of Object.entries(SOURCES)) {
  const dest = path.join(OUT, pack);
  fs.mkdirSync(dest, { recursive: true });
  const names = new Set();
  const seen = new Set(); // identical images are copied once
  for (const source of sources) {
    for (const entry of typeof source === 'function' ? source() : fromPack(source)) {
      const { name, data, from } = entry;
      if (FILTERS[pack] && !FILTERS[pack](entry)) continue;
      const hash = crypto.createHash('sha1').update(data).digest('hex');
      if (seen.has(hash)) continue;
      seen.add(hash);
      // a name already taken gets where it came from appended, e.g. piece_miel_coins
      const base = names.has(name) ? `${name}_${from}` : name;
      names.add(base);
      fs.writeFileSync(path.join(dest, `${base}.png`), data);
    }
  }
  console.log(`  ${pack.padEnd(22)} ${names.size} textures`);
  total += names.size;
}
console.log(`Copied ${total} textures to ${OUT}`);

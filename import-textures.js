// Copies item textures into ./Textures: accessories, armor and runes from the Triggers Client's SAO server
// resource pack, plus Minecraft's own armor icons from the game .jar.
// Run: node import-textures.js [path\to\resourcepacks\sao\assets]   (re-run after the server pack updates)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const CLIENT = path.join(process.env.APPDATA || '', '.Triggers Client');
const ASSETS = process.argv[2] || path.join(CLIENT, 'instances', 'Sword Art Online', 'resourcepacks', 'sao', 'assets');
const OUT = path.join(__dirname, 'Textures');

// Armor among the pack's item icons: 2D item models (their "layer0" texture) and *_icon.png files. 3D armor
// models are left out, their texture is an unfolded sheet, not an icon. So are the server's own pack (already
// in "nerfs"), inventory slot placeholders, accessories and a few unrelated namespaces.
const ARMOR = /helmet|chestplate|leggings|boots|shield|crown|armor|(^|_)hat($|_)/i;
const NOT_ARMOR = /^(nerfs|minecraft|lk|scenes|mae|elitecreatures|shizuart_furnitures)\/|\/(mmoinventory|accessory)\//;
const VANILLA_ARMOR = /^assets\/minecraft\/textures\/item\/((leather|chainmail|iron|golden|diamond|netherite)_(helmet|chestplate|leggings|boots)|turtle_helmet)\.png$/;

// Textures folder -> sources: folders or single .png files inside the pack, or functions returning [{ name, data }].
// mmoitems_pack's accessories are duplicates of hsur's. The server keeps some accessories outside
// "accessoires": the coins, and the Occult Skull (runes/ritual_skull).
const SOURCES = {
  nerfs: ['nerfs/textures/accessoires', 'nerfs/textures/coins', 'nerfs/textures/runes/ritual_skull.png'],
  armor: ['hsur/textures/custom/items/armor', 'mmoitems_pack/textures/hyronic_pack/items/armor', armorIcons, vanillaArmor],
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
  const found = new Map(); // file -> name
  const rel = (p) => path.relative(ASSETS, p).split(path.sep).join('/');
  walk(ASSETS, (p) => {
    const r = rel(p);
    if (NOT_ARMOR.test(r)) return;
    if (/_icon\.png$/i.test(r) && ARMOR.test(path.basename(r))) {
      found.set(p, path.basename(r, '.png').replace(/_icon$/i, ''));
    } else if (r.includes('/models/') && r.endsWith('.json')) {
      let model;
      try {
        model = JSON.parse(fs.readFileSync(p, 'utf8'));
      } catch {
        return;
      }
      const tex = model.textures?.layer0;
      if (!tex || !/item\/(paper|handheld|generated)$/.test(model.parent || '')) return;
      const [ns, t] = tex.includes(':') ? tex.split(':') : ['minecraft', tex];
      const file = path.join(ASSETS, ns, 'textures', `${t}.png`);
      if (NOT_ARMOR.test(`${ns}/textures/${t}`) || !fs.existsSync(file)) return;
      if (ARMOR.test(path.basename(t)) || ARMOR.test(path.basename(r, '.json'))) found.set(file, path.basename(t));
    }
  });
  return [...found].map(([file, name]) => ({ name, data: fs.readFileSync(file), from: rel(file).split('/')[0] }));
}

// Only true icons go in a pack with a filter: for armor, square images that are not worn-armor skins
// ("layer"), animated strips or bare "helmet"/"boots" slot placeholders.
const FILTERS = {
  armor: ({ name, data }) => data.readUInt32BE(16) === data.readUInt32BE(20) && !/layer|^(helmet|chestplate|leggings|boots|empty)$/i.test(name),
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

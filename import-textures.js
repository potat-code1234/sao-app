// Copies the accessory textures from the Triggers Client's SAO server resource pack into ./Textures.
// Run: node import-textures.js [path\to\resourcepacks\sao\assets]   (re-run after the server pack updates)
const fs = require('fs');
const path = require('path');

const ASSETS =
  process.argv[2] ||
  path.join(process.env.APPDATA || '', '.Triggers Client', 'instances', 'Sword Art Online', 'resourcepacks', 'sao', 'assets');
const OUT = path.join(__dirname, 'Textures');

// Textures folder name -> folders (or single .png files) inside the pack. (mmoitems_pack's accessories are duplicates of hsur's.)
// The server keeps some accessories outside "accessoires": the coins, and the Occult Skull (runes/ritual_skull).
const SOURCES = {
  nerfs: ['nerfs/textures/accessoires', 'nerfs/textures/coins', 'nerfs/textures/runes/ritual_skull.png'],
  hsur: ['hsur/textures/custom/items/accessory'],
  mctrinketsringsvol1: ['mctrinketsringsvol1/textures/item'],
  mcfantasytrinketsvol2: ['mcfantasytrinketsvol2/textures/item'],
  trinketsvol3: ['trinketsvol3/textures/item'],
};

if (!fs.existsSync(ASSETS)) {
  console.error(`Resource pack not found: ${ASSETS}\nJoin the server once so the client downloads it, or pass the pack's assets folder as an argument.`);
  process.exit(1);
}

let total = 0;
for (const [name, rels] of Object.entries(SOURCES)) {
  const dest = path.join(OUT, name);
  fs.mkdirSync(dest, { recursive: true });
  const copied = new Set();
  for (const rel of rels) {
    const src = path.join(ASSETS, rel);
    if (!fs.existsSync(src)) {
      console.warn(`  skip ${rel}: not found`);
      continue;
    }
    const files = rel.toLowerCase().endsWith('.png')
      ? [src]
      : fs.readdirSync(src).filter((f) => f.toLowerCase().endsWith('.png')).map((f) => path.join(src, f));
    for (const file of files) {
      // a name already taken by an earlier folder gets that folder's name appended, e.g. piece_miel_coins
      let base = path.basename(file, '.png');
      if (copied.has(base)) base = `${base}_${path.basename(path.dirname(file))}`;
      copied.add(base);
      fs.copyFileSync(file, path.join(dest, `${base}.png`));
    }
  }
  console.log(`  ${name.padEnd(22)} ${copied.size} textures`);
  total += copied.size;
}
console.log(`Copied ${total} textures to ${OUT}`);

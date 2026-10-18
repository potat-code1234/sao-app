# SAO Gear Optimizer

A local web app that works out which accessories to wear. Everything runs on your PC: a small Node.js server with no dependencies, and plain JSON files for the data.

## Start

Double-click **`start.bat`**. The browser opens at <http://localhost:3077>. Close the console window to stop the app.

You can also run `node server.js --open` (or `npm start`) from this folder.

## Deploy on a server (Coolify)

The repo deploys with Coolify's **Docker Compose** build pack, using [docker-compose.yaml](docker-compose.yaml).

- **Data:** items, sets and images are stored in the `sao-gear-data` volume (`/data` in the container), so they survive redeploys. On the first start the volume is filled with the `Items/` and `Data/` folders from the repo. After that, the server's copy is the one that counts: edits made in the local app are not synced.
- **Player data:** each player's base stats, equipped gear, locks, saved builds, owned items and optimizer settings are saved in their own browser, not on the server. *Base Stats › Your data* has Export and Import buttons for backups or moving to another device. `Data/profile.json` is only used as the admin's starting profile the first time they open the app in a browser.
- **Logins:** set these in Coolify's environment variables, then redeploy:

  | Variable | Login |
  |---|---|
  | `ADMIN_PASSWORD` (+ `ADMIN_USER`, default `admin`) | Admin: can change everything. Required; the container refuses to start without it. |
  | `VIEWER_PASSWORD` (+ `VIEWER_USER`, default `viewer`) | Read-only: sees the items and sets and can use the equipment page and the optimizer, but can't change items or sets. Leave it empty to turn this login off. |

  User names aren't case-sensitive. Logins last 30 days; changing a password logs everyone out. `/healthz` stays open for health checks.
- **Import from screenshots:** set `ANTHROPIC_API_KEY` (a Claude API key) in Coolify to turn it on. See [Import items from screenshots](#import-items-from-screenshots).
- **Textures:** they are part of the image. After running `node import-textures.js` locally, commit and push the `Textures/` folder and redeploy.

Without Coolify: `APP_PASSWORD=… docker compose up -d --build`, then open port 3077 of the container (add a `ports:` mapping or put a reverse proxy in front).

## Import items from screenshots

Claude reads in-game item tooltips (name, minimum level, rarity from the frame colour, stats, category, set bonuses) and the app turns them into items and sets. Only **English** tooltips are imported: French ones are skipped, and so are runes and other items that have no equipment slot. An item or set that already exists is updated rather than duplicated, keeping its image, texture and notes. Equipment without a category, such as gifts, lanterns and masks, becomes an artifact.

- **In the app:** as admin, *Items › Import screenshots*. Drop, paste (Ctrl+V) or choose screenshots, press *Read screenshots*, check the list of changes, then *Save*.
- **From the command line:** `node import-items.mjs <screenshots or folders> --url https://your-app --user admin --password …`. Add `--dry-run` to only see the changes, or `--yes` to save without asking. Run it with no arguments for the full option list at the top of the file.

Either way the server does the reading, so it needs `ANTHROPIC_API_KEY` in its environment. The Docker image installs the packages for it; when running locally, run `npm install` once and set the key before `start.bat`. Each screenshot is one Claude request (`claude-opus-5-5`), roughly a few cents.

## Pages

| Page | What it does |
|---|---|
| **Equipment** | Shows the in-game slot layout. Click a slot to equip an item; the picker shows how much each choice changes your stats and score. The 🔒 button locks a slot, and the optimizer then leaves it as it is. Total stats, set bonuses, special effects and saved builds are on this page too. |
| **Items** | Add, edit, duplicate or delete items, filter them, and mark which ones you own. Every item can have an image: click, drag a file onto it, or paste with Ctrl+V. Small textures such as 16×16 Minecraft icons stay pixel-sharp. |
| **Sets** | Set bonuses for any number of pieces (2, 3, 4, 5…). Choose whether the bonuses **stack** (2pc + 4pc both apply) or only the **highest tier** applies. |
| **Optimizer** | Weights for each stat, with presets, plus optional **Min** and **Cap** values. Press *Find best gear* to see the 5 best builds, each with its changes compared to what you wear now. |
| **Base Stats** | Your stats with no gear on. They depend on your class and skill-tree points, so you always enter them by hand. They start empty, and you update them when you switch class or respec. |

## How the score works

`score = Σ weight × total stat`. Here *total* is base + item stats + active set bonuses, and a stat with a **Cap** counts only up to that cap. A build that misses a **Min** is never picked unless no build can reach it. The search is exhaustive, so the results are the best possible builds, not estimates. If the time limit is hit, the results page says so.

By default the optimizer fills only the accessory slots (glove, amulet, bracelet, 2 rings, 3 artifacts) and keeps your current armor and offhand. Turn on *Also optimize armor & offhand* to include those slots.

## Data files

```
Items/Accessories/<id>.json     one file per item
Items/Accessories/images/       item images (<id>.png …)
Items/Sets/<id>.json            one file per set
Data/profile.json               the admin's starting profile (player profiles are saved in the browser)
```

You can edit these files by hand, then press **Reload** in the app. The file name (without `.json`) is the item or set id.

**Item**

```json
{
  "name": "Ring of Agility",
  "slot": "ring",
  "set": "black-swordsman",
  "rarity": "rare",
  "level": 12,
  "stats": { "dodge": 4, "moveSpeed": 5 },
  "effect": "Optional text, shown but not calculated",
  "notes": "",
  "image": "ring-of-agility.png"
}
```

- `slot`: `glove`, `amulet`, `bracelet`, `ring`, `artifact`, `helmet`, `chestplate`, `leggings`, `boots`, `offhand`
- `rarity`: `common`, `uncommon`, `rare`, `epic`, `legendary`, `mythic`, `event` (pink, red or rainbow tooltips)
- `level`: minimum level to equip; leave it out to use the set's `level`. The optimizer's *Item level* range filters on it, and items with no level are always kept.
- `set`: the id (file name) of a set, or `null`

**Set**

```json
{
  "name": "Black Swordsman",
  "level": 12,
  "cumulative": true,
  "bonuses": [
    { "pieces": 2, "stats": { "attackDamage": 4 } },
    { "pieces": 4, "stats": { "attackSpeed": 8 }, "effect": "Dual Blades" }
  ]
}
```

**Stat keys**: `health`, `attackDamage`, `defense`, `projectileDamage`, `mana`, `attackSpeed`, `critChance`, `critDamage`, `cooldownReduction`, `moveSpeed`, `bonusHealing`, `skillDamage`, `dodge`, `damageReduction`, `magicDamage`, `tenacity`. Enter % stats as points, so 5 means 5%.

Stats from item tooltips that the in-game status screen doesn't list (the Status panel shows them only when they are non-zero): `physicalDamage`, `skillCritChance`, `skillCritDamage`, `lifeSteal`, `spellVampirism`, `maxStamina`, `healthRegen`, `manaRegen`, `staminaRegen` (the regen stats are per second). Tooltip "Ability Haste" is entered as `cooldownReduction`, and "Critical Power" as `critDamage`.

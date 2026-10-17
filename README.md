# SAO Gear Optimizer

A local web app that works out which accessories to wear. Everything runs on your PC: a small Node.js server with no dependencies, and plain JSON files for the data.

## Start

Double-click **`start.bat`**. The browser opens at <http://localhost:3077>. Close the console window to stop the app.

You can also run `node server.js --open` (or `npm start`) from this folder.

## Deploy on a server (Coolify)

The repo deploys with Coolify's **Docker Compose** build pack, using [docker-compose.yaml](docker-compose.yaml).

- **Data:** items, sets, images and the profile are stored in the `sao-gear-data` volume (`/data` in the container), so they survive redeploys. On the first start the volume is filled with the `Items/` and `Data/` folders from the repo. After that, the server's copy is the one that counts: edits made in the local app are not synced.
- **Login:** set `APP_PASSWORD` in Coolify's environment variables, and optionally `APP_USER`. The browser then asks for them. `/healthz` stays open for health checks.
- **Textures:** they are part of the image. After running `node import-textures.js` locally, commit and push the `Textures/` folder and redeploy.

Without Coolify: `APP_PASSWORD=… docker compose up -d --build`, then open port 3077 of the container (add a `ports:` mapping or put a reverse proxy in front).

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
Data/profile.json               base stats, equipped items, locks, optimizer settings, saved builds
```

You can edit these files by hand, then press **Reload** in the app. The file name (without `.json`) is the item or set id.

**Item**

```json
{
  "name": "Ring of Agility",
  "slot": "ring",
  "set": "black-swordsman",
  "rarity": "rare",
  "owned": true,
  "stats": { "dodge": 4, "moveSpeed": 5 },
  "effect": "Optional text, shown but not calculated",
  "notes": "",
  "image": "ring-of-agility.png"
}
```

- `slot`: `glove`, `amulet`, `bracelet`, `ring`, `artifact`, `helmet`, `chestplate`, `leggings`, `boots`, `offhand`
- `rarity`: `common`, `uncommon`, `rare`, `epic`, `legendary`, `mythic`
- `set`: the id (file name) of a set, or `null`

**Set**

```json
{
  "name": "Black Swordsman",
  "cumulative": true,
  "bonuses": [
    { "pieces": 2, "stats": { "attackDamage": 4 } },
    { "pieces": 4, "stats": { "attackSpeed": 8 }, "effect": "Dual Blades" }
  ]
}
```

**Stat keys**: `health`, `attackDamage`, `defense`, `projectileDamage`, `mana`, `attackSpeed`, `critChance`, `critDamage`, `cooldownReduction`, `moveSpeed`, `bonusHealing`, `skillDamage`, `dodge`, `damageReduction`, `magicDamage`, `tenacity`. Enter % stats as points, so 5 means 5%.

Stats from item tooltips that the in-game status screen doesn't list (the Status panel shows them only when they are non-zero): `physicalDamage`, `skillCritChance`, `skillCritDamage`, `lifeSteal`, `spellVampirism`, `maxStamina`, `healthRegen`, `manaRegen`, `staminaRegen` (the regen stats are per second). Tooltip "Ability Haste" is entered as `cooldownReduction`, and "Critical Power" as `critDamage`.

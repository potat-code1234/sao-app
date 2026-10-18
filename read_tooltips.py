"""Reads item tooltip screenshots with free, local OCR and writes them to a file that you check and
import in SAO Gear (as admin: Items > Import screenshots). Nothing is sent anywhere.

    pip install -r requirements.txt                 (once)
    python read_tooltips.py <screenshots or folders...> [-o tooltips.json]

or, with uv installed:  uv run read_tooltips.py <screenshots or folders...>

The file holds, per screenshot, what was read (name, minimum level, rarity from the frame colour,
stats, category, set bonuses), a small copy of the image, and warnings about anything uncertain.
French tooltips are read too but marked as French; the app skips them.
"""

# /// script
# requires-python = ">=3.10"
# dependencies = ["rapidocr", "onnxruntime", "pillow", "numpy"]
# ///

import argparse
import base64
import difflib
import io
import json
import re
import sys
import unicodedata
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}

# Stat keys of the app (public/js/data.js) and how tooltips name them, English then French.
STAT_NAMES = {
    "health": ["Health", "Max Health", "Santé", "Santé Max"],
    "attackDamage": ["Attack Damage", "Dégâts d'attaque"],
    "defense": ["Defense", "Défense"],
    "projectileDamage": ["Projectile Damage", "Dégâts Projectile"],
    "mana": ["Max Mana", "Mana", "Mana Max"],
    "attackSpeed": ["Attack Speed", "Vitesse d'attaque"],
    "critChance": ["Critical Chance", "Critical Hit Chance", "Chance Critique"],
    "critDamage": ["Critical Damage", "Critical Power", "Dégâts Critique", "Puissance Critique"],
    "cooldownReduction": ["Ability Haste", "Cooldown Reduction", "Hâte d'aptitude"],
    "moveSpeed": ["Movement Speed", "Vitesse de Déplacement"],
    "bonusHealing": ["Bonus Healing", "Soins Bonus"],
    "skillDamage": ["Skill Damage", "Dégâts de Compétence"],
    "dodge": ["Dodge", "Dodge Chance", "Esquive"],
    "damageReduction": ["Damage Reduction", "Réduction de Dégâts"],
    "magicDamage": ["Magic Damage", "Dégâts Magique", "Dégâts Magiques"],
    "tenacity": ["Tenacity", "Ténacité"],
    "physicalDamage": ["Physical Damage", "Dégâts Physique", "Dégâts Physiques"],
    "skillCritChance": ["Skill Critical Chance", "Skill Critical Hit Chance", "Chance Critique de Compétence"],
    "skillCritDamage": ["Skill Critical Damage", "Dégâts Critique de Compétence"],
    "lifeSteal": ["Life Steal", "Vol de vie"],
    "spellVampirism": ["Spell Vampirism", "Vampirism", "Vampirisme"],
    "maxStamina": ["Max Stamina", "Stamina Max", "Stamina"],
    "healthRegen": ["Health Regeneration", "Health/s", "Régénération Santé", "Santé/s"],
    "manaRegen": ["Mana Regeneration", "Mana/s", "Régénération Mana"],
    "staminaRegen": ["Stamina Regeneration", "Stamina/s", "Régénération Stamina"],
}
# "+0.6/s Health" style set bonuses: a per-second value turns these stats into their regeneration.
REGEN = {"health": "healthRegen", "mana": "manaRegen", "maxStamina": "staminaRegen"}

SLOTS = {
    "ring": ["Ring", "Anneau", "Bague"],
    "glove": ["Gloves", "Glove", "Gants"],
    "amulet": ["Amulet", "Necklace", "Pendant", "Amulette", "Collier", "Pendentif"],
    "bracelet": ["Bracelet"],
    "artifact": ["Artifact", "Artefact", "Artéfact"],
    "helmet": ["Helmet", "Casque"],
    "chestplate": ["Chestplate", "Plastron"],
    "leggings": ["Leggings", "Jambières"],
    "boots": ["Boots", "Bottes"],
    "offhand": ["Offhand", "Off-hand", "Shield", "Bouclier", "Main secondaire"],
}

FRENCH = re.compile(r"niveau minimum|cat[ée]gorie|d[ée]g[aâ]ts|sant[ée]|d[ée]fense|vitesse|chance critique|cette rune|vous devez|esquive", re.I)
ENGLISH = re.compile(r"minimum level|category|damage|health|defense|speed|critical|legend|this rune|dodge", re.I)
FOOTER = re.compile(r"d[ée]tails de l|item details|^(left )?alt\b|exclusive|cxclu|vous devez|you must|glisser|drag", re.I)
LEVEL = re.compile(r"(minimum\s*level|niveau\s*minimum)\D*(\d+)", re.I)
CATEGORY = re.compile(r"^(category|cat[ée]gorie)$", re.I)
STAT_LINE = re.compile(r"^(?P<label>.*?[A-Za-zÀ-ÿ].*?)\s*:\s*(?P<value>[+-]?\s*\d+(?:[.,]\d+)?)\s*(?P<unit>%|/s)?\s*$")
BONUS_LINE = re.compile(r"^(?P<value>[+-]?\s*\d+(?:[.,]\d+)?)\s*(?P<unit>%|/s)?\s*(?P<label>[A-Za-zÀ-ÿ].*)$")
TIER = re.compile(r"^\[?\s*(?P<pieces>\d{1,2})\s*[\]|)]?\s+(?P<rest>[+-].*)$|^\[\s*(?P<pieces2>\d{1,2})\s*\]\s*(?P<rest2>.*)$")


def letters(s):
    """Lower-case letters only, accents removed: OCR often drops spaces and accents."""
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z/]", "", s.lower())


ALIASES = [(letters(name), key) for key, names in STAT_NAMES.items() for name in names]


def match_stat(label):
    """Stat key for a tooltip label, tolerating OCR slips ("fe Steal", "MaxStamina"); None if unsure."""
    target = letters(label)
    if not target:
        return None
    best_key, best = None, 0.0
    for alias, key in ALIASES:
        score = difflib.SequenceMatcher(None, target, alias).ratio()
        if score > best:
            best_key, best = key, score
    return best_key if best >= 0.78 else None


def number(text):
    return float(text.replace(" ", "").replace(",", "."))


def clean_value(v):
    return int(v) if v == int(v) else round(v, 4)


# ---------------------------------------------------------------- OCR
def enhanced(img):
    """Brightest colour channel, contrast stretched, doubled in size: makes faded grey text readable."""
    gray = np.asarray(img.convert("RGB")).max(axis=2).astype(np.uint8)
    return ImageOps.autocontrast(Image.fromarray(gray), cutoff=1).resize((img.width * 2, img.height * 2), Image.LANCZOS)


def ocr_rows(engine, img, scale):
    """OCR lines grouped into rows (boxes on the same height joined left to right), in original pixels."""
    result = engine(np.asarray(img.convert("RGB")))
    boxes = []
    for box, text, score in zip(result.boxes if result.txts else [], result.txts or [], result.scores or []):
        ys = [p[1] / scale for p in box]
        boxes.append({"y": min(ys), "h": max(ys) - min(ys), "x": min(p[0] for p in box) / scale, "text": text.strip(), "score": float(score)})
    boxes.sort(key=lambda b: (b["y"], b["x"]))
    rows = []
    for b in boxes:
        row = next((r for r in rows if abs(r["y"] - b["y"]) <= max(8, b["h"] * 0.45)), None)
        if row:
            row["parts"].append(b)
        else:
            rows.append({"y": b["y"], "parts": [b]})
    for r in rows:
        r["parts"].sort(key=lambda b: b["x"])
        r["x"] = r["parts"][0]["x"]
        r["text"] = " ".join(p["text"] for p in r["parts"])
        r["score"] = min(p["score"] for p in r["parts"])
    return rows


def row_quality(text, score):
    """Prefer readings that parse as something the tooltip is known to contain. The faded "[n]" of set
    tiers is often missing from the plain reading, so a reading that has it wins."""
    bonus = 0
    m = STAT_LINE.match(text)
    if TIER.match(text):
        bonus = 3
    elif m and match_stat(m["label"]):
        bonus = 2
    elif BONUS_LINE.match(text) and match_stat(BONUS_LINE.match(text)["label"]):
        bonus = 2
    elif LEVEL.search(text) or CATEGORY.match(text):
        bonus = 2
    return bonus + score + min(len(text), 40) / 400


def merged_rows(engine, img):
    """Rows from the plain and the enhanced image; for each line, the better of the two readings."""
    plain = ocr_rows(engine, img, 1)
    strong = ocr_rows(engine, enhanced(img), 2)
    rows = []
    for r in sorted(plain + strong, key=lambda r: r["y"]):
        same = next((o for o in rows if abs(o["y"] - r["y"]) <= 10), None)
        if not same:
            rows.append(r)
        elif row_quality(r["text"], r["score"]) > row_quality(same["text"], same["score"]):
            rows[rows.index(same)] = r
    return rows


# ---------------------------------------------------------------- rarity from the frame colour
def rarity_from_frame(img):
    """Hue of the bright, saturated pixels along the edges: gold = legendary, purple = epic, blue = rare,
    green = uncommon, grey = common; pink, red or mixed festive frames = event."""
    a = np.asarray(img.convert("RGB")).astype(np.float32) / 255
    h, w, _ = a.shape
    band = max(12, min(24, min(h, w) // 20))
    mask = np.zeros((h, w), bool)
    mask[:band, :] = mask[-band:, :] = mask[:, :band] = mask[:, -band:] = True
    mx, mn = a.max(2), a.min(2)
    sat = (mx - mn) / (mx + 1e-6)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    d = mx - mn + 1e-6
    hue = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    sel = mask & (sat > 0.4) & (mx > 0.6)
    if sel.sum() < 0.01 * mask.sum():
        return "common"
    hs = hue[sel]
    share = lambda lo, hi: float(((hs >= lo) & (hs < hi)).mean())
    groups = {
        "event": share(340, 360) + share(0, 25) + share(300, 340),  # red and pink
        "legendary": share(25, 70),
        "uncommon": share(70, 170),
        "rare": share(170, 250),
        "epic": share(250, 300),
    }
    if share(340, 360) + share(0, 25) >= 0.25:  # a lot of red, even mixed with gold, is an event frame
        return "event"
    return max(groups, key=groups.get)


# ---------------------------------------------------------------- tooltip structure
def parse_bonus(text):
    """'+7% Dégâts Magique', '-0.6/s Santé', '+0.6 Mana/s' -> (key, value) or (None, text)."""
    m = BONUS_LINE.match(text)
    if not m:
        return None, text
    key = match_stat(m["label"])
    if key and m["unit"] == "/s":
        key = REGEN.get(key, key)
    return (key, clean_value(number(m["value"]))) if key else (None, text)


def read_tooltip(engine, path):
    img = Image.open(path)
    rows = [r for r in merged_rows(engine, img) if r["text"]]
    warnings = []
    body = [r for r in rows if not FOOTER.search(r["text"])]

    # title: the first proper line near the top (corner ornaments read as short junk)
    top = [r for r in body if r["y"] < img.height * 0.2 and len(re.sub(r"[^A-Za-zÀ-ÿ]", "", r["text"])) >= 3 and r["score"] >= 0.8]
    title = top[0] if top else (body[0] if body else None)
    name = re.sub(r"^[^A-Za-zÀ-ÿ0-9]+", "", title["text"]).strip() if title else ""
    if not name:
        warnings.append("No item name found.")

    text = "\n".join(r["text"] for r in body)
    fr, en = len(FRENCH.findall(text)), len(ENGLISH.findall(text))
    language = "fr" if fr > en else "en" if en else "other"

    level = None
    m = LEVEL.search(text)
    if m:
        level = int(m[2])
    else:
        warnings.append("No minimum level found.")

    category = None
    for i, r in enumerate(body):
        if CATEGORY.match(re.sub(r"^[^A-Za-zÀ-ÿ]+", "", r["text"]).strip()) and i + 1 < len(body):
            category = re.sub(r"\s*[\[(].*$", "", body[i + 1]["text"]).strip()
            break
    is_rune = bool(re.search(r"\brune\b", category or "", re.I)) or bool(re.search(r"cette rune|this rune", text, re.I))
    slot = None
    if category and not is_rune:
        slot = next((s for s, names in SLOTS.items() if any(letters(n) == letters(category) for n in names)), None)
        if not slot:
            warnings.append(f'Unknown category "{category}".')
    elif not is_rune:
        warnings.append("No category shown: imported as an artifact.")

    stats, unmapped, set_info = [], [], None
    tiers, set_name = [], None
    for i, r in enumerate(body):
        if r is title:
            continue
        t = r["text"]
        tier = TIER.match(t)
        if tier:
            pieces = int(tier["pieces"] or tier["pieces2"])
            rest = (tier["rest"] if tier["pieces"] else tier["rest2"]) or ""
            if set_name is None and i > 0:
                set_name = re.sub(r"^[^A-Za-zÀ-ÿ]+", "", body[i - 1]["text"]).strip()
            tiers.append({"pieces": pieces, "stats": [], "unmapped": []})
            t = rest
            if not t:
                continue
        elif tiers and BONUS_LINE.match(t):
            pass  # continuation line of the tier above
        else:
            m = STAT_LINE.match(t)
            if m and not LEVEL.search(t):
                key = match_stat(re.sub(r"^[^A-Za-zÀ-ÿ]+", "", m["label"]))
                if key:
                    stats.append({"key": key, "value": clean_value(number(m["value"]))})
                    if r["score"] < 0.9:
                        warnings.append(f'Check "{t}" (blurry).')
                else:
                    unmapped.append(t)
                    warnings.append(f'"{t}" matches no stat: kept as effect text.')
            continue
        key, value = parse_bonus(t)
        if key:
            tiers[-1]["stats"].append({"key": key, "value": value})
        else:
            tiers[-1]["unmapped"].append(t)
            warnings.append(f'Set bonus "{t}" matches no stat: kept as effect text.')
    if tiers:
        set_info = {"name": set_name or "", "existing_set": None, "bonuses": tiers}
        if not set_name:
            warnings.append("Set bonuses found but no set name.")

    if not stats and not is_rune:
        warnings.append("No stats found.")
    reading = {
        "language": language,
        "kind": "rune" if is_rune else "equipment" if stats or set_info else "other",
        "name": name,
        "existing_item": None,
        "level": level,
        "rarity": rarity_from_frame(img),
        "slot": slot,
        "stats": stats,
        "unmapped": unmapped,
        "set": set_info,
    }
    return reading, warnings, [r["text"] for r in rows]


def thumbnail(path, max_h=640):
    img = Image.open(path).convert("RGB")
    if img.height > max_h:
        img = img.resize((round(img.width * max_h / img.height), max_h), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=85)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def collect(inputs):
    files = []
    for name in inputs:
        p = Path(name)
        if p.is_dir():
            files += sorted((f for f in p.iterdir() if f.suffix.lower() in IMAGE_EXTS), key=lambda f: [int(s) if s.isdigit() else s for s in re.split(r"(\d+)", f.name)])
        elif p.suffix.lower() in IMAGE_EXTS and p.exists():
            files.append(p)
        else:
            sys.exit(f"Not an image or folder: {name}")
    return files


def main():
    ap = argparse.ArgumentParser(description="Read SAO tooltip screenshots for import into SAO Gear.")
    ap.add_argument("inputs", nargs="+", help="screenshots or folders of screenshots")
    ap.add_argument("-o", "--output", default="tooltips.json", help="file to write (default: tooltips.json)")
    args = ap.parse_args()
    files = collect(args.inputs)
    if not files:
        sys.exit("No screenshots found.")

    from rapidocr import RapidOCR  # imported here: loading the OCR models takes a moment

    engine = RapidOCR(params={"Global.log_level": "error"})
    out = []
    for i, f in enumerate(files, 1):
        reading, warnings, lines = read_tooltip(engine, f)
        out.append({"file": f.name, "image": thumbnail(f), "reading": reading, "warnings": warnings, "ocr": lines})
        flag = f" ({len(warnings)} to check)" if warnings else ""
        print(f"[{i}/{len(files)}] {f.name}: {reading['name'] or '?'} - {reading['language']}, {reading['rarity']}, Lv {reading['level'] or '?'}{flag}")
    Path(args.output).write_text(json.dumps({"version": 1, "tooltips": out}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nWrote {args.output}. In SAO Gear (admin): Items > Import screenshots > load this file, check each item, save.")


if __name__ == "__main__":
    main()

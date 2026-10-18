// Imports items from in-game tooltip screenshots into SAO Gear. The app server reads each screenshot
// with Claude (it needs ANTHROPIC_API_KEY); this script sends them, shows what would change and saves it.
// The admin page has the same import under Items > Import screenshots.
//
//   node import-items.mjs <screenshots or folders...> [options]
//
// Options:
//   --url <address>         app to import into (default http://localhost:3077)
//   --user <name>           admin login, when the app has one (or SAO_USER)
//   --password <password>   (or SAO_PASSWORD)
//   --dry-run               show what would change, save nothing
//   --yes                   save without asking
//   --save-json <file>      also write what was read from the screenshots
//   --from-json <file>      skip reading and use a file written by --save-json
//
// Only English tooltips are imported; French ones are skipped, as are runes and other non-equipment.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { planImport, planSize, applyPlan, planText } from './public/js/import-plan.js';

const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

async function connect(url, user, password) {
  const base = url.replace(/\/+$/, '');
  let cookie = '';
  const request = async (method, route, body) => {
    const res = await fetch(base + route, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `${method} ${route}: ${res.status} ${res.statusText}`);
    return { data, res };
  };
  if (user) cookie = ((await request('POST', '/api/login', { user, password })).res.headers.get('set-cookie') || '').split(';')[0];
  const call = async (method, route, body) => (await request(method, route, body)).data;
  return { call, me: await call('GET', '/api/me'), ...(await call('GET', '/api/data')) };
}

function collectImages(inputs) {
  const files = [];
  for (const input of inputs) {
    if (!fs.existsSync(input)) throw new Error(`Not found: ${input}`);
    if (fs.statSync(input).isDirectory()) {
      for (const f of fs.readdirSync(input).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
        if (IMAGE_TYPES[path.extname(f).toLowerCase()]) files.push(path.join(input, f));
      }
    } else if (IMAGE_TYPES[path.extname(input).toLowerCase()]) files.push(input);
    else throw new Error(`Not an image: ${input}`);
  }
  return files;
}

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: 'string', default: 'http://localhost:3077' },
    user: { type: 'string', default: process.env.SAO_USER },
    password: { type: 'string', default: process.env.SAO_PASSWORD },
    'dry-run': { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
    'save-json': { type: 'string' },
    'from-json': { type: 'string' },
  },
});

// Ends by returning, not process.exit(): exiting while fetch connections close crashes Node on Windows.
async function main() {
  if (!positionals.length && !opt['from-json']) throw new Error('Give screenshots or folders to import (or --from-json). See the top of import-items.mjs.');
  const app = await connect(opt.url, opt.user, opt.password);
  if (app.me.role !== 'admin') throw new Error('Only the admin login can import items: pass --user and --password.');
  console.log(`Connected to ${opt.url}: ${app.items.length} items, ${app.sets.length} sets.`);

  let readings = [];
  if (opt['from-json']) readings = JSON.parse(fs.readFileSync(opt['from-json'], 'utf8'));
  else {
    if (!app.me.screenshotImport) throw new Error('This app is not set up to read screenshots: add ANTHROPIC_API_KEY to its environment and restart it.');
    const files = collectImages(positionals);
    for (const [i, file] of files.entries()) {
      const name = path.basename(file);
      process.stdout.write(`Reading ${i + 1}/${files.length} ${name}… `);
      try {
        const image = `data:${IMAGE_TYPES[path.extname(file).toLowerCase()]};base64,${fs.readFileSync(file).toString('base64')}`;
        readings.push({ file: name, reading: (await app.call('POST', '/api/import/read', { image })).reading });
        console.log('ok');
      } catch (e) {
        readings.push({ file: name, error: e.message });
        console.log(`failed: ${e.message}`);
      }
    }
  }
  if (opt['save-json']) {
    fs.writeFileSync(opt['save-json'], JSON.stringify(readings, null, 2));
    console.log(`Wrote ${opt['save-json']}`);
  }

  const plan = planImport(readings, app.items, app.sets);
  console.log(`\n${planText(plan) || 'Nothing to import.'}\n`);
  if (!planSize(plan) || opt['dry-run']) return;
  if (!opt.yes) {
    if (!process.stdin.isTTY) throw new Error('Add --yes to save without asking.');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`Save ${planSize(plan)} change(s) to ${opt.url}? [y/N] `);
    rl.close();
    if (!/^y(es)?$/i.test(answer.trim())) return;
  }
  await applyPlan(plan, app.call);
  console.log('Saved. Press Reload in the app to see the changes.');
}

main().catch((e) => {
  console.error(`Error: ${e.message}`);
  process.exitCode = 1;
});

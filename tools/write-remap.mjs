// Varsayılan katman + verilen atamalar. Ör: node tools/write-remap.mjs '{"3":"k29"}'
import fs from 'fs';
import { createRequire } from 'module';
import { buildLayer } from '../src/keymap.js';
const require = createRequire(import.meta.url);
const { Keyboard } = require('../electron/keyboard.cjs');
const layout = JSON.parse(fs.readFileSync(new URL('../src/data/layout.json', import.meta.url)));
const { buf } = buildLayer(layout.keys, JSON.parse(process.argv[2] || '{}'));
const kb = new Keyboard();
await kb.writeMatrix(buf, 0);
console.log('yazıldı; CapsLock girişi:', buf.slice(3 * 4, 3 * 4 + 4));
kb.close();

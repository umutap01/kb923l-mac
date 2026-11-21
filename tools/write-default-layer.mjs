// Varsayılan katmanı (KB.ini) yazar. Kurtarma: node tools/write-default-layer.mjs
import fs from 'fs';
import { createRequire } from 'module';
import { buildLayer } from '../src/keymap.js';
const require = createRequire(import.meta.url);
const { Keyboard } = require('../electron/keyboard.cjs');
const layout = JSON.parse(fs.readFileSync(new URL('../src/data/layout.json', import.meta.url)));
const { buf, problems } = buildLayer(layout.keys);
if (problems.length) throw new Error('çevrilemeyen tuş: ' + problems);
const kb = new Keyboard();
await kb.writeMatrix(buf, 0);
const led = await kb.readLed(); // klavye hâlâ yanıt veriyor mu
console.log('varsayılan katman yazıldı; klavye yanıt veriyor:', led[126] === 0x5a && led[127] === 0xa5);
kb.close();

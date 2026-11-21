import fs from 'fs';
import { createRequire } from 'module';
import { buildLayer } from '../src/keymap.js';
const require = createRequire(import.meta.url);
const { Keyboard } = require('../electron/keyboard.cjs');
const layout = JSON.parse(fs.readFileSync(new URL('../src/data/layout.json', import.meta.url)));
const { buf } = buildLayer(layout.keys, { 3: 'k29' });
const numStar = layout.keys.find((k) => k.name === 'Num*');
buf.splice(numStar.led * 4, 4, 0, 0, 0x1b, 0); // X, kod 3. baytta
console.log('CapsLock', buf.slice(12, 16), 'Num* led', numStar.led, buf.slice(numStar.led * 4, numStar.led * 4 + 4));
const kb = new Keyboard();
await kb.writeMatrix(buf, 0);
await new Promise((r) => setTimeout(r, 100));
const led = await kb.readLed();
await kb.writeLed(led);
console.log('matris + LED profili yazıldı');
kb.close();

import fs from 'fs';
import { buildLayer, defaultBytes, macSwapPreset } from '../src/keymap.js';
const layout = JSON.parse(fs.readFileSync(new URL('../src/data/layout.json', import.meta.url)));
const { buf, problems } = buildLayer(layout.keys);
console.log('sorunlu:', problems);
const h = (b) => b.map((x) => x.toString(16).padStart(2, '0')).join('');
for (const k of layout.keys) if (/Ctrl|Alt|Win|Shift|FN|Fn|Esc|^A$|Space|Wheel|Enter|><|`/.test(k.name)) console.log(k.name.padEnd(8), 'vk', k.vk.toString(16), 'led', k.led, h(defaultBytes(k)));
console.log('mac preset', macSwapPreset(layout.keys));
console.log('dolu giriş', buf.length / 4, 'sıfır olmayan', [...Array(126).keys()].filter((i) => buf.slice(i * 4, i * 4 + 4).some(Boolean)).length);

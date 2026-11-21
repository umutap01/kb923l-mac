// Özel renk yazma testi: profili yedekler, gökkuşağı yazar, özel moda geçer, geri okur, yedeği geri yükler.
const fs = require('fs');
const { Keyboard, LED_COUNT } = require('../electron/keyboard.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const kb = new Keyboard();
  const orig = await kb.readLed();
  fs.writeFileSync(process.argv[2], orig);
  const colors = [];
  for (let i = 0; i < LED_COUNT; i++) {
    const h = (i % 21) / 21;
    const f = (n) => Math.round(255 * Math.max(0, Math.min(1, Math.abs(((h * 6 + n) % 6) - 3) - 1)));
    colors[i] = [f(0), f(4), f(2)];
  }
  await kb.writeCustomRgb(colors);
  const b = Buffer.from(orig);
  b[9] = 1; b[10] = 18; b[0x5e] = 20;
  await kb.writeLed(b);
  await sleep(150);
  const r = await kb.readLed();
  console.log('özel mod geri okuma: [9]=%d [10]=%d [0x5e]=%d', r[9], r[10], r[0x5e]);
  if (process.argv[3] !== 'keep') {
    await sleep(Number(process.argv[3] || 0));
    await kb.writeLed(orig);
    await sleep(150);
    const z = await kb.readLed();
    console.log('yedek geri yüklendi:', z.equals(orig));
  }
  kb.close();
})().catch((e) => console.log('HATA', e.message));

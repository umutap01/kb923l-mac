// Tuş atama, macOS tarafında: hidutil UserKeyMapping, yalnız bu klavyeye (VID/PID eşleşmesiyle).
// Firmware'e matris yazımı (komut 0x03) kabul ediliyor ama klavye uygulamıyor (21 Kas 2026, ölçüldü);
// bu yüzden eşleme Mac'te yapılır. hidutil ayarı klavye çıkarılıp takılınca ve Mac yeniden açılınca
// kaybolur; uygulama bağlantıda yeniden uygular.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { VID, PID } = require('./keyboard.cjs');

const MATCH = JSON.stringify({ VendorID: VID, ProductID: PID });

function file(app) {
  return path.join(app.getPath('userData'), 'remap.json');
}

function load(app) {
  try {
    const j = JSON.parse(fs.readFileSync(file(app), 'utf8'));
    return Array.isArray(j.pairs) ? j.pairs : [];
  } catch {
    return [];
  }
}

function save(app, pairs) {
  fs.mkdirSync(path.dirname(file(app)), { recursive: true });
  fs.writeFileSync(file(app), JSON.stringify({ pairs }, null, 1));
}

// pairs: [{ src, dst }]  (64 bit kullanım: sayfa << 32 | kod)
function apply(pairs) {
  const map = pairs
    .filter((p) => Number.isSafeInteger(p.src) && Number.isSafeInteger(p.dst) && p.src !== p.dst)
    .map((p) => ({ HIDKeyboardModifierMappingSrc: p.src, HIDKeyboardModifierMappingDst: p.dst }));
  const json = JSON.stringify({ UserKeyMapping: map });
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/hidutil', ['property', '--matching', MATCH, '--set', json], { timeout: 5000 }, (err, out, errOut) =>
      err ? reject(new Error(String(errOut || err.message).trim())) : resolve(map.length),
    );
  });
}

module.exports = { load, save, apply };

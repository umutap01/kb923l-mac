// Klavyenin gönderdiği giriş raporlarından yalnız ilgilenilen kodları kaydeder; çıkar-tak sonrası yeniden bağlanır.
// Kullanım: KB_KEYS=39,29 node tools/listen.cjs saniye dosya
const HID = require('node-hid');
const fs = require('fs');
const out = process.argv[3];
const secs = Number(process.argv[2] || 120);
const keep = (process.env.KB_KEYS || '39,29,55,1b').split(',').map((x) => parseInt(x, 16));
const w = (s) => fs.appendFileSync(out, new Date().toISOString().slice(11, 23) + ' ' + s + '\n');
const open = new Map();
function scan() {
  for (const d of HID.devices()) {
    if (d.vendorId !== 0x258a || d.productId !== 0x0217 || open.has(d.path)) continue;
    try {
      const h = new HID.HID(d.path, { nonExclusive: true });
      open.set(d.path, h);
      w('dinleniyor if' + d.interface);
      let last = '';
      h.on('data', (b) => {
        const a = [...b];
        const s = a.map((x) => x.toString(16).padStart(2, '0')).join(' ');
        if (s === last) return;
        last = s;
        if (a[0] === 9 || a.slice(1).some((x) => keep.includes(x))) w(`if${d.interface} ` + s);
      });
      h.on('error', () => {
        w('bağlantı koptu if' + d.interface);
        try { h.close(); } catch {}
        open.delete(d.path);
      });
    } catch (e) {
      open.set(d.path, null);
      setTimeout(() => open.delete(d.path), 1500);
    }
  }
}
scan();
setInterval(scan, 1500);
setTimeout(() => process.exit(0), secs * 1000);

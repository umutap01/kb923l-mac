const HID = require('node-hid');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dev = HID.devices().find(d => d.vendorId === 0x258a && d.productId === 0x0217 && d.usagePage === 0xff02 && d.usage === 2);
const h = new HID.HID(dev.path, { nonExclusive: true });
function pkt(cmd, data, len, b2 = 0) { const p = Buffer.alloc(520); p[0] = 9; p[1] = cmd; p[2] = b2; p[4] = 1; p[6] = len & 255; p[7] = len >> 8; if (data) Buffer.from(data).copy(p, 8); return [...p]; }
async function read(cmd, len, b2 = 0) { h.sendFeatureReport(pkt(cmd, null, len, b2)); await sleep(30); const r = Buffer.from(h.getFeatureReport(9, 520)); if (r[1] !== cmd) throw new Error('cmd uyuşmadı ' + r[1].toString(16)); return r.subarray(8, 8 + len); }
async function write(cmd, data, b2 = 0) { h.sendFeatureReport(pkt(cmd, data, data.length, b2)); await sleep(30); }
(async () => {
  const a = Buffer.from(await read(0x84, 128));
  if (a[126] !== 0x5a || a[127] !== 0xa5) throw new Error('imza yok');
  await write(0x04, a);
  await sleep(100);
  const b = Buffer.from(await read(0x84, 128));
  console.log('geri okuma aynı mı:', a.equals(b));
  const t = new Date(); const s = Buffer.alloc(14);
  s.writeUInt16LE(t.getFullYear(), 3); s[5] = t.getMonth() + 1; s[6] = t.getDate(); s[7] = t.getHours(); s[8] = t.getMinutes(); s[9] = t.getSeconds(); s[10] = t.getDay();
  await write(0x0b, s);
  console.log('saat gönderildi', t.toLocaleTimeString('tr-TR'));
  h.close();
})().catch(e => { console.log('HATA', e.message); h.close(); });

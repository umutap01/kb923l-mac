// Salt okuma: klavyeden LED profili / psd / güç okur.
const HID = require('node-hid');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dev = HID.devices().find(d => d.vendorId === 0x258a && d.productId === 0x0217 && d.usagePage === 0xff02 && d.usage === 2);
if (!dev) { console.log('yok'); process.exit(1); }
const h = new HID.HID(dev.path, { nonExclusive: true });
async function read(cmd, len, b2 = 0) {
  const pk = Buffer.alloc(520); pk[0] = 9; pk[1] = cmd; pk[2] = b2; pk[4] = 1; pk[5] = 0; pk[6] = len & 255; pk[7] = len >> 8;
  h.sendFeatureReport([...pk]);
  await sleep(30);
  const r = Buffer.from(h.getFeatureReport(9, 520));
  return r;
}
const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join(' ');
(async () => {
  for (const [name, cmd, len, b2] of [['LED', 0x84, 128, 0], ['PSD', 0x82, 6, 1], ['POWER', 0x87, 2, 0]]) {
    try {
      const r = await read(cmd, len, b2);
      console.log(name, 'hdr:', hex(r.subarray(0, 8)));
      const d = r.subarray(8, 8 + len);
      for (let i = 0; i < d.length; i += 16) console.log('  ' + i.toString(16).padStart(2, '0') + ': ' + hex(d.subarray(i, i + 16)));
    } catch (e) { console.log(name, 'HATA', e.message); }
  }
  h.close();
})();

const HID = require('node-hid');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dev = HID.devices().find(d => d.vendorId === 0x258a && d.productId === 0x0217 && d.usagePage === 0xff02 && d.usage === 2);
const h = new HID.HID(dev.path, { nonExclusive: true });
(async () => {
  for (const layer of [0, 1]) {
    const len = 504;
    const p = Buffer.alloc(520); p[0] = 9; p[1] = 0x83; p[2] = layer; p[4] = 1; p[6] = len & 255; p[7] = len >> 8;
    h.sendFeatureReport([...p]); await sleep(40);
    const r = Buffer.from(h.getFeatureReport(9, 520));
    console.log('katman', layer, 'hdr', [...r.subarray(0, 8)].map(x => x.toString(16).padStart(2, '0')).join(' '));
    const d = r.subarray(8, 8 + len);
    let line = '';
    for (let i = 0; i < 126; i++) { line += i + ':' + [...d.subarray(i * 4, i * 4 + 4)].map(x => x.toString(16).padStart(2, '0')).join('') + ' '; }
    console.log(line);
  }
  h.close();
})();

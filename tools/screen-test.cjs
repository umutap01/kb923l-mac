// Ekrana GIF yükleme protokolü denemesi (21 Kas 2026). DeviceDriver.exe'den çıkarılan akış:
//   1) SetGIFParam (komut 0x0D, 5 bayt: [bayrak<<6 | dizin, kare LE16, gecikme LE16]) bayrak=1 "başla":
//      önce klavyeye (0217, rapor 9), sonra ekran aygıtına (01B4, rapor 9); her biri onay (giriş raporu 9) bekler.
//   2) Her kare: 240x240 RGB565 büyük uçlu (115200 bayt), 512 baytlık sayfalar:
//      [09, 0C, 00, kare, sayfa, sağlama(0), boyLo, boyHi, veri×512]; her sayfadan sonra onay ([3]!=0, [4]==sayfa).
//   3) SetGIFParam bayrak=0 "bitir" (2 = iptal).
// Kullanım: node tools/screen-test.cjs [kareSayısı=1] [gecikmeMs=100] [ham.bin ...]
const HID = require('node-hid');
const fs = require('fs');

const VID = 0x258a;
const W = 240, H = 240;
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function find(pid, page) {
  return HID.devices().find((d) => d.vendorId === VID && d.productId === pid && d.usagePage === page);
}

class Dev {
  constructor(name, info) {
    this.name = name;
    this.h = new HID.HID(info.path, { nonExclusive: true });
    this.q = [];
    this.h.on('data', (b) => {
      const a = [...b];
      if (a[0] === 9) this.q.push(a);
    });
    this.h.on('error', (e) => log(name, 'hata', e.message));
  }
  async ack(pred, ms = 1500) {
    const t = Date.now();
    while (Date.now() - t < ms) {
      const i = this.q.findIndex(pred);
      if (i >= 0) return this.q.splice(i, 1)[0];
      await sleep(2);
    }
    return null;
  }
  send(buf) {
    this.h.sendFeatureReport(buf);
  }
}

function cmdPacket(cmd, data, sub = 0) {
  const p = Buffer.alloc(520);
  p[0] = 9; p[1] = cmd; p[2] = sub; p[3] = 0; p[4] = 1; p[5] = 0;
  p[6] = data.length & 0xff; p[7] = data.length >> 8;
  Buffer.from(data).copy(p, 8);
  return p;
}

async function gifParam(devs, flag, frames, delay) {
  const d = [(flag << 6) | 0, frames & 0xff, frames >> 8, delay & 0xff, delay >> 8];
  for (const dev of devs) {
    dev.q.length = 0;
    dev.send(cmdPacket(0x0d, d));
    const a = await dev.ack(() => true, 2000);
    log(dev.name, 'GIF ayarı bayrak', flag, '→', a ? hex(a) : 'onay yok');
    await sleep(25);
  }
}

function testFrame(n, total) {
  const buf = Buffer.alloc(W * H * 2);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let r = Math.round((x / (W - 1)) * 255), g = Math.round((y / (H - 1)) * 255), b = Math.round((n / Math.max(1, total - 1)) * 255);
      if (x < 60 && y < 60) [r, g, b] = [255, 0, 0];
      const v = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
      buf.writeUInt16BE(v, (y * W + x) * 2);
    }
  return buf;
}

async function sendFrame(scr, frame, data) {
  const pages = Math.ceil(data.length / 512);
  for (let pg = 0; pg < pages; pg++) {
    const chunk = data.subarray(pg * 512, pg * 512 + 512);
    const p = Buffer.alloc(520);
    p[0] = 9; p[1] = 0x0c; p[2] = 0; p[3] = frame; p[4] = pg & 0xff; p[5] = 0;
    p[6] = chunk.length & 0xff; p[7] = chunk.length >> 8;
    chunk.copy(p, 8);
    let ok = null;
    for (let tries = 0; tries < 3 && !ok; tries++) {
      scr.send(p);
      ok = await scr.ack((a) => a[3] !== 0 && a[4] === (pg & 0xff), 1000);
      if (!ok) log('sayfa', pg, 'onay yok, tekrar', tries + 1, 'kuyruk:', scr.q.slice(-3).map(hex).join(' | '));
    }
    if (!ok) throw new Error(`kare ${frame} sayfa ${pg} onaylanmadı`);
    if (pg === 0 || pg === pages - 1) log('kare', frame, 'sayfa', pg, 'onay', hex(ok));
  }
}

(async () => {
  const frames = Number(process.argv[2] || 1);
  const delay = Number(process.argv[3] || 100);
  const files = process.argv.slice(4);
  const kbI = find(0x0217, 0xff02), scrI = find(0x01b4, 0xff03);
  if (!kbI || !scrI) throw new Error('aygıt yok: klavye ' + !!kbI + ', ekran ' + !!scrI);
  const kb = new Dev('klavye', kbI), scr = new Dev('ekran', scrI);
  // psd (0x82) ile iki aygıtla da konuşabildiğimizi doğrula
  for (const d of [kb, scr]) {
    d.send(cmdPacket(0x82, [], 1));
    await sleep(30);
    const r = d.h.getFeatureReport(9, 520);
    log(d.name, 'psd', hex(r.slice(0, 14)));
  }
  await gifParam([kb, scr], 1, frames, delay);
  await sleep(120);
  const t0 = Date.now();
  for (let i = 0; i < frames; i++) {
    const data = files[i] ? fs.readFileSync(files[i]) : testFrame(i, frames);
    await sendFrame(scr, i, data);
  }
  log('kareler gitti', ((Date.now() - t0) / 1000).toFixed(1), 'sn');
  await sleep(50);
  await gifParam([kb, scr], 0, frames, delay);
  kb.h.close();
  scr.h.close();
})().catch((e) => {
  log('HATA', e.message);
  process.exit(1);
});

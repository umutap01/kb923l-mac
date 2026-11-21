// Klavye ekranına (240x240) GIF / resim yükleme. Protokol DeviceDriver.exe'den çıkarıldı ve 21 Kas 2026'da
// klavyede doğrulandı (tools/screen-test.cjs: test görüntüsü ve 3 karelik canlandırma doğru göründü).
//   Ekran ayrı bir HID aygıtı: 258A:01B4, usage 0xFF03/2, rapor 9 (520 bayt özellik, 7 bayt giriş = onay).
//   1) SetGIFParam (komut 0x0D, 5 bayt [bayrak<<6 | dizin, kare LE16, gecikme LE16]); bayrak 1 = başla,
//      0 = bitir, 2 = iptal. Önce klavyeye (0217 if1), sonra ekrana gider; her biri onay bekler.
//   2) Kare: 240x240 RGB565 büyük uçlu = 115200 bayt = 225 sayfa. Sayfa paketi:
//      [09, 0C, 00, kare, sayfa, sağlama(0: ScreenCRC=0), boyLo, boyHi, veri×512].
//      Onay: giriş raporu [09, 0A, 06, 01, sayfa, ...] ([3] != 0, [4] == sayfa). Kare başına ~3,5 sn.
//   KB.ini: MaxScreenFrame=35, DataUnitSize=512, siScreen=240,240, DrawFrameTime=0.

const HID = require('node-hid');
const { VID } = require('./keyboard.cjs');

const SCREEN_PID = 0x01b4;
const W = 240;
const H = 240;
const FRAME_BYTES = W * H * 2;
const MAX_FRAMES = 35;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findScreen() {
  return HID.devices().find((d) => d.vendorId === VID && d.productId === SCREEN_PID && d.usagePage === 0xff03);
}

// Giriş raporu 9'ları biriktirip koşula uyanı bekler
function acker(h) {
  const q = [];
  const on = (b) => {
    if (b[0] === 9) q.push([...b]);
  };
  h.on('data', on);
  return {
    clear: () => (q.length = 0),
    off: () => h.removeListener('data', on),
    async wait(pred, ms) {
      const t = Date.now();
      while (Date.now() - t < ms) {
        const i = q.findIndex(pred);
        if (i >= 0) return q.splice(i, 1)[0];
        await sleep(2);
      }
      return null;
    },
  };
}

// Yazma hatasında (IOHIDDeviceSetReport "general error", 21 Kas 2026'da 35 karelik yüklemede bir kez görüldü)
// Windows sürücüsü gibi 100 ms bekleyip yeniden dener.
async function sendRetry(h, pkt, what) {
  for (let t = 0; ; t++) {
    try {
      h.sendFeatureReport(pkt);
      return;
    } catch (e) {
      if (t >= 4) throw new Error(`${what}: ${e.message}`);
      await sleep(100 * (t + 1));
    }
  }
}

function cmdPacket(cmd, data) {
  const p = Buffer.alloc(520);
  p[0] = 9;
  p[1] = cmd;
  p[4] = 1;
  p[6] = data.length & 0xff;
  p[7] = data.length >> 8;
  Buffer.from(data).copy(p, 8);
  return [...p];
}

// frames: Buffer[] (her biri 115200 bayt RGB565 BE), delay: ms
// opts.progress(done, total), opts.cancelled() → true ise iptal
async function upload(kb, frames, delay, opts = {}) {
  if (!frames.length || frames.length > MAX_FRAMES) throw new Error(`Kare sayısı 1–${MAX_FRAMES} olmalı`);
  for (const f of frames) if (f.length !== FRAME_BYTES) throw new Error('Kare boyutu hatalı');
  delay = Math.max(10, Math.min(65535, Math.round(delay)));
  const info = findScreen();
  if (!info) throw new Error('Ekran aygıtı bulunamadı');

  return kb.run(async () => {
    const scr = new HID.HID(info.path, { nonExclusive: true });
    scr.on('error', () => {});
    const kbAck = acker(kb.h);
    const scrAck = acker(scr);
    const param = async (flag) => {
      const d = [(flag << 6) | 0, frames.length & 0xff, frames.length >> 8, delay & 0xff, delay >> 8];
      for (const [h, a, name] of [[kb.h, kbAck, 'klavye'], [scr, scrAck, 'ekran']]) {
        let ok = null;
        for (let t = 0; t < 3 && !ok; t++) {
          a.clear();
          await sendRetry(h, cmdPacket(0x0d, d), name + ' GIF ayarı');
          ok = await a.wait(() => true, 1500);
          if (!ok) await sleep(200);
        }
        if (!ok) throw new Error(`${name} GIF ayarını onaylamadı`);
        await sleep(25);
      }
    };
    const total = frames.length * Math.ceil(FRAME_BYTES / 512);
    let done = 0;
    let cancelled = false;
    try {
      await param(1);
      await sleep(120);
      for (let fi = 0; fi < frames.length && !cancelled; fi++) {
        const data = frames[fi];
        for (let pg = 0; pg * 512 < data.length; pg++) {
          if (opts.cancelled && opts.cancelled()) {
            cancelled = true;
            break;
          }
          const chunk = data.subarray(pg * 512, pg * 512 + 512);
          const p = Buffer.alloc(520);
          p[0] = 9;
          p[1] = 0x0c;
          p[3] = fi;
          p[4] = pg & 0xff;
          p[6] = chunk.length & 0xff;
          p[7] = chunk.length >> 8;
          chunk.copy(p, 8);
          let ok = null;
          for (let t = 0; t < 3 && !ok; t++) {
            await sendRetry(scr, [...p], `kare ${fi + 1} sayfa ${pg + 1}`);
            ok = await scrAck.wait((a) => a[3] !== 0 && a[4] === (pg & 0xff), 1000);
          }
          if (!ok) throw new Error(`Kare ${fi + 1}, sayfa ${pg + 1} onaylanmadı`);
          done++;
          if (opts.progress && (done % 8 === 0 || done === total)) opts.progress(done, total);
        }
      }
      await sleep(50);
      await param(cancelled ? 2 : 0);
      return { cancelled, frames: frames.length, delay };
    } catch (e) {
      // Yarıda kalırsa ekranı eski hâline döndürmek için iptal bayrağı gönder
      try {
        const d = [2 << 6, frames.length & 0xff, frames.length >> 8, delay & 0xff, delay >> 8];
        kb.h.sendFeatureReport(cmdPacket(0x0d, d));
        await sleep(30);
        scr.sendFeatureReport(cmdPacket(0x0d, d));
      } catch {}
      throw e;
    } finally {
      kbAck.off();
      scrAck.off();
      try {
        scr.close();
      } catch {}
    }
  });
}

module.exports = { upload, findScreen, W, H, FRAME_BYTES, MAX_FRAMES };

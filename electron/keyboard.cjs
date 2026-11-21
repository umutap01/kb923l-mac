// KB923L Pro (Sinowealth VID 0x258A / PID 0x0217) HID protokolü.
// Windows sürücüsündeki (DeviceDriver.exe, CDevG5KB sınıfı) paket yapısından çıkarıldı.
//
// Her paket feature rapor 9, 520 bayt:
//   [0]=0x09  [1]=komut  [2]=alt  [3]=0  [4]=toplam paket  [5]=paket no  [6..7]=bu paketteki veri boyu (LE)  [8..519]=veri
// Yazma: SetFeature.  Okuma: SetFeature (komut|0x80) ardından GetFeature, yanıtta [1] aynı komut olmalı.

const HID = require('node-hid');

const VID = 0x258a;
const PID = 0x0217;
const REPORT = 9;
const PKT = 520;
const CHUNK = 512;

const CMD = {
  READ_PSD: 0x82,
  READ_LED: 0x84,
  WRITE_KEYMAP: 0x03,
  WRITE_LED: 0x04,
  WRITE_MACRO: 0x05,
  WRITE_CUSTOM_RGB: 0x06,
  WRITE_SYSPARAM: 0x0b,
  RESET: 0x11,
};

const LED_LEN = 128;
const LED_COUNT = 126; // m_nLedNum (0x7e)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findDevice() {
  return HID.devices().find(
    (d) => d.vendorId === VID && d.productId === PID && d.usagePage === 0xff02 && d.usage === 2,
  );
}

class Keyboard {
  constructor() {
    this.h = null;
    this.queue = Promise.resolve();
  }

  get connected() {
    return !!this.h;
  }

  open() {
    if (this.h) return true;
    const d = findDevice();
    if (!d) return false;
    // macOS: klavye arayüzü özel (exclusive) açılamaz; paylaşımlı açılır. Giriş İzleme izni gerekir.
    this.h = new HID.HID(d.path, { nonExclusive: true });
    this.h.on('error', () => this.close());
    return true;
  }

  close() {
    try {
      this.h && this.h.close();
    } catch {}
    this.h = null;
  }

  // Bütün HID işlemleri sıraya girer; aynı anda iki komut gitmez.
  run(fn) {
    const p = this.queue.then(async () => {
      if (!this.h && !this.open()) throw new Error('Klavye bulunamadı');
      try {
        return await fn();
      } catch (e) {
        this.close();
        throw e;
      }
    });
    this.queue = p.catch(() => {});
    return p;
  }

  packets(cmd, data, len, sub = 0) {
    const total = Math.max(1, Math.ceil(len / CHUNK));
    const out = [];
    for (let i = 0; i < total; i++) {
      const size = Math.min(CHUNK, len - i * CHUNK);
      const p = Buffer.alloc(PKT);
      p[0] = REPORT;
      p[1] = cmd;
      p[2] = sub;
      p[4] = total;
      p[5] = i;
      p[6] = size & 0xff;
      p[7] = size >> 8;
      if (data) Buffer.from(data).copy(p, 8, i * CHUNK, i * CHUNK + size);
      out.push(p);
    }
    return out;
  }

  async _write(cmd, data, sub = 0, delay = 25) {
    for (const p of this.packets(cmd, data, data.length, sub)) {
      await sleep(delay);
      this.h.sendFeatureReport([...p]);
    }
  }

  async _read(cmd, len, sub = 0) {
    const out = Buffer.alloc(len);
    let off = 0;
    for (const p of this.packets(cmd, null, len, sub)) {
      await sleep(25);
      this.h.sendFeatureReport([...p]);
      await sleep(25);
      const r = Buffer.from(this.h.getFeatureReport(REPORT, PKT));
      if (r[1] !== cmd) throw new Error(`Yanıt komutu uyuşmadı (0x${r[1].toString(16)})`);
      const size = Math.min(CHUNK, len - off);
      r.copy(out, off, 8, 8 + size);
      off += size;
    }
    return out;
  }

  readPsd() {
    return this.run(() => this._read(CMD.READ_PSD, 6, 1));
  }

  // 128 baytlık LED/ayar profili. Son iki bayt 5A A5 imzası.
  readLed() {
    return this.run(async () => {
      for (let i = 0; i < 5; i++) {
        const b = await this._read(CMD.READ_LED, LED_LEN);
        if (b[126] === 0x5a && b[127] === 0xa5) return b;
        await sleep(100);
      }
      throw new Error('LED profili okunamadı (imza yok)');
    });
  }

  writeLed(buf) {
    const b = Buffer.from(buf);
    if (b.length !== LED_LEN || b[126] !== 0x5a || b[127] !== 0xa5) {
      return Promise.reject(new Error('Geçersiz LED profili'));
    }
    return this.run(() => this._write(CMD.WRITE_LED, b));
  }

  // Özel (Kendi tanımlama) mod renkleri: R[126] G[126] B[126], LED numarasına göre.
  writeCustomRgb(colors, group = 0) {
    const b = Buffer.alloc(LED_COUNT * 3);
    for (let i = 0; i < LED_COUNT; i++) {
      const c = colors[i] || [0, 0, 0];
      b[i] = c[0];
      b[LED_COUNT + i] = c[1];
      b[LED_COUNT * 2 + i] = c[2];
    }
    return this.run(() => this._write(CMD.WRITE_CUSTOM_RGB, b, group));
  }

  // Tuş matrisi: katman başına 126 × 4 bayt; alt bayt = katman (0 = varsayılan katman).
  writeMatrix(bytes, layer = 0) {
    const b = Buffer.from(bytes);
    if (b.length !== LED_COUNT * 4) return Promise.reject(new Error('Geçersiz matris boyu'));
    if (layer !== 0) return Promise.reject(new Error('Yalnız varsayılan katman yazılır'));
    return this.run(() => this._write(CMD.WRITE_KEYMAP, b, layer));
  }

  // Fabrika ayarları (sürücüdeki ResetDevice: komut 0x11, 1 bayt 00).
  factoryReset() {
    return this.run(() => this._write(CMD.RESET, Buffer.from([0])));
  }

  // Ekran: [0]=ses [1]=CPU [2]=bellek [3..4]=yıl [5]=ay [6]=gün [7]=saat [8]=dk [9]=sn [10]=haftanın günü
  writeSysParam({ volume = 0, cpu = 0, mem = 0, date = new Date() } = {}) {
    const b = Buffer.alloc(14);
    b[0] = volume;
    b[1] = cpu;
    b[2] = mem;
    b.writeUInt16LE(date.getFullYear(), 3);
    b[5] = date.getMonth() + 1;
    b[6] = date.getDate();
    b[7] = date.getHours();
    b[8] = date.getMinutes();
    b[9] = date.getSeconds();
    b[10] = date.getDay();
    return this.run(() => this._write(CMD.WRITE_SYSPARAM, b));
  }
}

module.exports = { Keyboard, findDevice, LED_COUNT, VID, PID };

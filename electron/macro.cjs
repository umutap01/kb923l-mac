// Makrolar, macOS tarafında (21 Kas 2026). Firmware'e makro yazımı tuş matrisine bağlı; matris yazımı
// klavyede uygulanmadığı için (bkz. remap.cjs) makrolar da Mac'te çalışır:
//   - Tetik tuşu hidutil ile F24'e yönlendirilir (kendi karakterini yazmasın diye; remap.cjs).
//   - Bu modül klavyenin giriş raporlarını (Giriş İzleme izniyle) okur; hidutil öncesi fiziksel kodu görür.
//   - Tetik basılınca adımlar yardımcı programa (helper/kbmacro.swift, Erişilebilirlik izni) gönderilir.
// Giriş raporları (rapor tanımlayıcısından, 21 Kas 2026):
//   arayüz 0  boot klavye, rapor no yok: [değiştiriciler, 00, k1..k6]
//   arayüz 1  rapor 4 = NKRO: [04, değiştiriciler, 13 bayt bit alanı (kullanım 0x00..0x67), 1 bayt (0x85,87,88,89,8a,8b,91,92)]

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const HID = require('node-hid');
const { VID, PID } = require('./keyboard.cjs');

const PAGE_KB = 0x700000000;
const NKRO_EXTRA = [0x85, 0x87, 0x88, 0x89, 0x8a, 0x8b, 0x91, 0x92];

// HID klavye kullanımı → macOS sanal tuş kodu (kVK, konuma göre; çıkan karakter Mac'in klavye düzenine bağlı)
const HID2KVK = {
  0x04: 0, 0x05: 11, 0x06: 8, 0x07: 2, 0x08: 14, 0x09: 3, 0x0a: 5, 0x0b: 4, 0x0c: 34, 0x0d: 38, 0x0e: 40, 0x0f: 37,
  0x10: 46, 0x11: 45, 0x12: 31, 0x13: 35, 0x14: 12, 0x15: 15, 0x16: 1, 0x17: 17, 0x18: 32, 0x19: 9, 0x1a: 13,
  0x1b: 7, 0x1c: 16, 0x1d: 6, 0x1e: 18, 0x1f: 19, 0x20: 20, 0x21: 21, 0x22: 23, 0x23: 22, 0x24: 26, 0x25: 28,
  0x26: 25, 0x27: 29, 0x28: 36, 0x29: 53, 0x2a: 51, 0x2b: 48, 0x2c: 49, 0x2d: 27, 0x2e: 24, 0x2f: 33, 0x30: 30,
  0x31: 42, 0x32: 42, 0x33: 41, 0x34: 39, 0x35: 50, 0x36: 43, 0x37: 47, 0x38: 44, 0x39: 57, 0x3a: 122, 0x3b: 120,
  0x3c: 99, 0x3d: 118, 0x3e: 96, 0x3f: 97, 0x40: 98, 0x41: 100, 0x42: 101, 0x43: 109, 0x44: 103, 0x45: 111,
  0x46: 105, 0x47: 107, 0x48: 113, 0x49: 114, 0x4a: 115, 0x4b: 116, 0x4c: 117, 0x4d: 119, 0x4e: 121, 0x4f: 124,
  0x50: 123, 0x51: 125, 0x52: 126, 0x53: 71, 0x54: 75, 0x55: 67, 0x56: 78, 0x57: 69, 0x58: 76, 0x59: 83, 0x5a: 84,
  0x5b: 85, 0x5c: 86, 0x5d: 87, 0x5e: 88, 0x5f: 89, 0x60: 91, 0x61: 92, 0x62: 82, 0x63: 65, 0x64: 10, 0x65: 110,
  0x67: 81, 0x68: 105, 0x69: 107, 0x6a: 113, 0x6b: 106, 0x6c: 64, 0x6d: 79, 0x6e: 80, 0x6f: 90, 0x87: 94, 0x89: 93,
  0xe0: 59, 0xe1: 56, 0xe2: 58, 0xe3: 55, 0xe4: 62, 0xe5: 60, 0xe6: 61, 0xe7: 54,
};

// Tüketici (medya) kullanımı → NX_KEYTYPE (Fn katmanında medya tuşu için)
const CONSUMER2NX = { 0xe9: 0, 0xea: 1, 0x6f: 2, 0x70: 3, 0xe2: 7, 0xcd: 16, 0xb5: 17, 0xb6: 18 };
// HID değiştirici bitleri (0x01 Ctrl, 0x02 Shift, 0x04 Alt, 0x08 Win/⌘; sağdakiler <<4) → CGEventFlags
function modsToFlags(m) {
  const b = (m | (m >> 4)) & 0x0f;
  return (b & 1 ? 0x40000 : 0) | (b & 2 ? 0x20000 : 0) | (b & 4 ? 0x80000 : 0) | (b & 8 ? 0x100000 : 0);
}
const LAYER_KVK = 90; // katman tuşu hidutil ile F20'ye (HID 0x6f) yönlendirilir

function helperPath(app) {
  return app.isPackaged ? path.join(process.resourcesPath, 'kbmacro') : path.join(__dirname, '..', 'build', 'kbmacro');
}

// Bir giriş raporundan basılı kullanım kodları (sayfa 7 kodu, 0x04..0xe7)
function pressed(iface, b) {
  const s = new Set();
  let mods;
  if (iface === 0 && b.length >= 8 && b[0] !== 9) {
    mods = b[0];
    for (let i = 2; i < 8; i++) if (b[i] > 3) s.add(b[i]);
  } else if (b[0] === 4 && b.length >= 16) {
    mods = b[1];
    for (let i = 0; i < 13; i++) for (let j = 0; j < 8; j++) if (b[2 + i] & (1 << j)) s.add(i * 8 + j);
    for (let j = 0; j < 8; j++) if (b[15] & (1 << j)) s.add(NKRO_EXTRA[j]);
    s.delete(0);
  } else return null;
  for (let j = 0; j < 8; j++) if (mods & (1 << j)) s.add(0xe0 + j);
  return s;
}

class MacroEngine {
  constructor(app, log, send) {
    this.app = app;
    this.log = log;
    this.send = send;
    this.macros = [];
    this.binds = new Map(); // kullanım → makro id ya da 'mouse:<tuş>' (fare tuşu / tekerlek)
    this.scrollTimers = new Map();
    this.layer = null; // { src, tap, entries:[{src, act}] } (keymap.js buildLayerCfg)
    this.remap = new Map(); // kayıtta fiziksel kod → hidutil hedefi
    this.handles = new Map(); // yol → { h, iface, down:Set }
    this.recording = false;
    this.recStart = 0;
    this.playing = null; // { id, mode }
    this.playSeq = 0;
    this.trusted = null;
    this.helper = null;
    this.helperBuf = '';
    this.load();
  }

  file() {
    return path.join(this.app.getPath('userData'), 'macros.json');
  }

  load() {
    try {
      const j = JSON.parse(fs.readFileSync(this.file(), 'utf8'));
      this.macros = Array.isArray(j.macros) ? j.macros : [];
      this.binds = new Map((j.binds || []).map((b) => [b.src, b.macro]));
      this.layer = j.layer || null;
    } catch {}
  }

  save() {
    fs.mkdirSync(path.dirname(this.file()), { recursive: true });
    fs.writeFileSync(
      this.file(),
      JSON.stringify(
        { macros: this.macros, binds: [...this.binds].map(([src, macro]) => ({ src, macro })), layer: this.layer },
        null,
        1,
      ),
    );
  }

  state() {
    return { trusted: this.trusted, recording: this.recording, playing: this.playing && this.playing.id };
  }

  emitState() {
    this.send('kb:macroState', this.state());
  }

  setMacros(list) {
    this.macros = Array.isArray(list) ? list : [];
    this.save();
    this.sync();
  }

  setBinds(binds) {
    this.binds = new Map((binds || []).map((b) => [b.src, b.macro]));
    this.save();
    this.sync();
  }

  setRemap(pairs) {
    this.remap = new Map((pairs || []).filter((p) => Math.floor(p.dst / 2 ** 32) === 7).map((p) => [p.src, p.dst]));
  }

  // Yardımcı program
  startHelper() {
    if (this.helper) return;
    const p = helperPath(this.app);
    if (!fs.existsSync(p)) return this.log('makro yardımcısı yok', p);
    const h = spawn(p, [], { stdio: ['pipe', 'pipe', 'ignore'] });
    this.helper = h;
    if (this.layer) h.stdin.write(JSON.stringify(this.layerCmd()) + '\n');
    h.stdout.on('data', (d) => {
      this.helperBuf += d;
      let i;
      while ((i = this.helperBuf.indexOf('\n')) >= 0) {
        const line = this.helperBuf.slice(0, i);
        this.helperBuf = this.helperBuf.slice(i + 1);
        try {
          this.onHelper(JSON.parse(line));
        } catch {}
      }
    });
    h.on('exit', (code) => {
      this.log('makro yardımcısı kapandı', code);
      if (this.helper === h) this.helper = null;
      this.playing = null;
      this.emitState();
    });
    h.stdin.on('error', () => {});
  }

  cmd(o) {
    this.startHelper();
    if (this.helper) this.helper.stdin.write(JSON.stringify(o) + '\n');
  }

  onHelper(m) {
    if (m.ev === 'trust') {
      if (this.trusted !== m.v) this.log('erişilebilirlik izni', m.v);
      this.trusted = m.v;
      this.emitState();
    } else if (m.ev === 'layerMacro') {
      this.triggerMacro(m.id, !!m.d);
    } else if (m.ev === 'layer') {
      this.log('fn katmanı', m.v ? 'açık' : 'kapalı', 'olay dinleyicisi', m.tap);
    } else if (m.ev === 'listen') {
      this.log('giriş izleme izni', m.v);
    } else if (m.ev === 'done' && this.playing && this.playing.seq === m.id) {
      this.playing = null;
      this.emitState();
    }
  }

  checkTrust(prompt) {
    // AXIsProcessTrusted bazı sürümlerde süreç boyunca önbelleğe alınır; izin verildiyse yardımcı yeniden başlatılır.
    if (this.helper && this.trusted === false) {
      this.helper.kill();
      this.helper = null;
    }
    this.cmd({ op: 'trust', prompt: prompt ? 1 : 0 });
  }

  // Makro adımları → yardımcının biçimi
  compile(steps) {
    const out = [];
    for (const s of steps || []) {
      if (s.u != null) {
        const k = HID2KVK[s.u];
        if (k != null) out.push({ k, d: s.d ? 1 : 0 });
      } else if (s.w != null) out.push({ w: Math.max(0, Math.min(60000, Math.round(s.w))) });
      else if (s.t) out.push({ t: String(s.t) });
      else if (s.m) out.push({ m: s.m, d: s.d ? 1 : 0 });
    }
    return out;
  }

  play(id, forceTimes) {
    const m = this.macros.find((x) => x.id === id);
    if (!m) return false;
    const mode = m.mode || 'once';
    const times = forceTimes ?? (mode === 'once' ? Math.max(1, Math.min(99, m.times || 1)) : 0);
    this.playing = { id, mode, seq: ++this.playSeq };
    this.cmd({ op: 'play', id: this.playing.seq, times, steps: this.compile(m.steps) });
    this.emitState();
    return true;
  }

  stop() {
    this.cmd({ op: 'stop' });
    this.playing = null;
    this.emitState();
  }

  // Klavye dinleme: bağlı makro varsa ya da kayıt sürüyorsa açık tutulur.
  needListen() {
    return this.recording || [...this.binds.values()].some((id) => id.startsWith('mouse:') || this.macros.some((m) => m.id === id));
  }

  sync() {
    if ([...this.binds.values()].length || this.layer) this.startHelper();
    if (!this.needListen()) return this.closeAll();
    let list = [];
    try {
      list = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
    } catch {}
    const seen = new Set();
    for (const d of list) {
      if (seen.has(d.path) || this.handles.has(d.path)) continue;
      seen.add(d.path);
      // Arayüz 1'de klavye (1/6) koleksiyonu yoksa dinlemeye gerek yok
      if (d.interface === 1 && !list.some((x) => x.path === d.path && x.usagePage === 1 && x.usage === 6)) continue;
      try {
        const h = new HID.HID(d.path, { nonExclusive: true });
        const rec = { h, iface: d.interface, down: new Set() };
        this.handles.set(d.path, rec);
        h.on('data', (b) => this.onReport(rec, b));
        h.on('error', () => this.closeOne(d.path));
        this.log('makro dinleme açıldı, arayüz', d.interface);
      } catch (e) {
        this.log('makro dinleme açılamadı', e.message);
      }
    }
  }

  closeOne(p) {
    const r = this.handles.get(p);
    if (!r) return;
    for (const u of r.down) this.onKey(u, false);
    try {
      r.h.close();
    } catch {}
    this.handles.delete(p);
  }

  closeAll() {
    for (const p of [...this.handles.keys()]) this.closeOne(p);
  }

  onReport(rec, b) {
    const now = pressed(rec.iface, [...b]);
    if (!now) return;
    for (const u of rec.down) if (!now.has(u)) this.onKey(u, false);
    for (const u of now) if (!rec.down.has(u)) this.onKey(u, true);
    rec.down = now;
  }

  onKey(code, down) {
    const usage = PAGE_KB + code;
    if (this.recording) {
      // Kayıt, Mac'te görünen tuşla yapılır: kullanıcının tuş atamaları uygulanır.
      const dst = this.remap.get(usage) ?? usage;
      this.send('kb:macroKey', { u: dst - PAGE_KB, d: down, t: Date.now() - this.recStart });
      return;
    }
    const id = this.binds.get(usage);
    if (id == null) return;
    if (id.startsWith('mouse:')) return this.onMouseKey(usage, id.slice(6), down);
    this.triggerMacro(id, down);
  }

  triggerMacro(id, down) {
    const m = this.macros.find((x) => x.id === id);
    if (!m) return;
    const mode = m.mode || 'once';
    const mine = this.playing && this.playing.id === id;
    if (down) {
      if (mode === 'toggle' && mine) return this.stop();
      if (mode === 'once' && mine) return; // sürüyorsa yeniden başlatma
      this.play(id);
    } else if (mode === 'hold' && mine) this.stop();
  }

  // Fare tuşu: basma ve bırakma ayrı gider (sürükleme çalışsın). Tekerlek: basılı tuttukça tekrar eder.
  onMouseKey(usage, b, down) {
    const wheel = { wheelUp: [1, 0], wheelDown: [-1, 0], wheelLeft: [0, 1], wheelRight: [0, -1] }[b];
    if (!wheel) return this.cmd({ op: 'mouse', b, d: down ? 1 : 0 });
    clearTimeout(this.scrollTimers.get(usage));
    clearInterval(this.scrollTimers.get(usage));
    this.scrollTimers.delete(usage);
    if (!down) return;
    const tick = () => this.cmd({ op: 'scroll', dy: wheel[0] * 3, dx: wheel[1] * 3 });
    tick();
    this.scrollTimers.set(
      usage,
      setTimeout(() => this.scrollTimers.set(usage, setInterval(tick, 60)), 350),
    );
  }

  // Fn katmanı: tuş olayları yardımcının olay dinleyicisinde çevrilir (sıra bozulmasın diye uygulamada değil).
  setLayer(layer) {
    this.layer = layer && layer.entries ? layer : null;
    this.save();
    if (this.layer) this.startHelper();
    if (this.helper) this.cmd(this.layerCmd());
  }

  layerCmd() {
    const L = this.layer;
    if (!L) return { op: 'layer', key: -1, tap: -1, map: {} };
    const kvk = (u) => (u == null ? undefined : HID2KVK[u - PAGE_KB]);
    const map = {};
    for (const { src, act } of L.entries) {
      const c = kvk(src);
      if (c == null || !act) continue;
      if (act.key != null && HID2KVK[act.key] != null) map[c] = { k: HID2KVK[act.key], f: modsToFlags(act.mods || 0) };
      else if (act.media != null && CONSUMER2NX[act.media] != null) map[c] = { media: CONSUMER2NX[act.media] };
      else if (act.mouse) map[c] = { b: act.mouse };
      else if (act.macro) map[c] = { macro: act.macro };
    }
    return { op: 'layer', key: LAYER_KVK, tap: kvk(L.tap) ?? -1, map };
  }

  record(on) {
    this.recording = !!on;
    this.recStart = Date.now();
    if (on && this.playing) this.stop();
    this.sync();
    this.emitState();
  }
}

module.exports = { MacroEngine, HID2KVK };

// Tuş atama. 21 Kas 2026: firmware matris yazımını (komut 0x03) kabul ediyor ama uygulamıyor (ölçüldü);
// uygulama atamaları macOS'ta hidutil ile yapar (buildPairs). Matris kodlaması kayıt için duruyor.
//
// Firmware matris biçimi (komut 0x03, katman 0 = varsayılan katman):
// Katman = 126 giriş × 4 bayt; giriş yeri tuşun KB.ini'deki son alanı (matris no = LED no).
// Bir girişin baytları (sürücüdeki keyinfo_to_hardware_code):
//   normal tuş   [00, değiştiriciler, ikinci HID, HID]
//   tüketici     [02, 00, kodHi, kodLo]      (medya, uygulama tuşları)
//   Fn           [0D, 00, 00, 00]
//   tip 9 (ini)  değer bayt sırası ters: 0xAABBCCDD → [AA, BB, CC, DD]
//   devre dışı   [00, 00, 00, 00]
// Firmware matrisi geri okumayı desteklemiyor (0x83 → 0A 06); bu yüzden katman her yazımda
// KB.ini varsayılanları + kullanıcı atamalarından baştan kurulur (Windows yazılımı da böyle yapar).

export const MATRIX_LEN = 126;
export const FN_LED = 59;

// DeviceDriver.exe 0x5D4028 tablosu: Windows VK → HID kullanım kodu
const VK2HID = {
  0xe2: 0x64, 0x1b: 0x29, 0x70: 0x3a, 0x71: 0x3b, 0x72: 0x3c, 0x73: 0x3d, 0x74: 0x3e, 0x75: 0x3f, 0x76: 0x40,
  0x77: 0x41, 0x78: 0x42, 0x79: 0x43, 0x7a: 0x44, 0x7b: 0x45, 0x41: 0x04, 0x42: 0x05, 0x43: 0x06, 0x44: 0x07,
  0x45: 0x08, 0x46: 0x09, 0x47: 0x0a, 0x48: 0x0b, 0x49: 0x0c, 0x4a: 0x0d, 0x4b: 0x0e, 0x4c: 0x0f, 0x4d: 0x10,
  0x4e: 0x11, 0x4f: 0x12, 0x50: 0x13, 0x51: 0x14, 0x52: 0x15, 0x53: 0x16, 0x54: 0x17, 0x55: 0x18, 0x56: 0x19,
  0x57: 0x1a, 0x58: 0x1b, 0x59: 0x1c, 0x5a: 0x1d, 0x31: 0x1e, 0x32: 0x1f, 0x33: 0x20, 0x34: 0x21, 0x35: 0x22,
  0x36: 0x23, 0x37: 0x24, 0x38: 0x25, 0x39: 0x26, 0x30: 0x27, 0x09: 0x2b, 0x14: 0x39, 0x0d: 0x28, 0x08: 0x2a,
  0x20: 0x2c, 0xdb: 0x2f, 0xdd: 0x30, 0xdc: 0x31, 0xba: 0x33, 0xde: 0x34, 0xbc: 0x36, 0xbe: 0x37, 0xbf: 0x38,
  0xc0: 0x35, 0xbb: 0x2e, 0xbd: 0x2d, 0x2c: 0x46, 0x91: 0x47, 0x13: 0x48, 0x2d: 0x49, 0x24: 0x4a, 0x21: 0x4b,
  0x2e: 0x4c, 0x23: 0x4d, 0x22: 0x4e, 0x26: 0x52, 0x28: 0x51, 0x25: 0x50, 0x27: 0x4f, 0x61: 0x59, 0x62: 0x5a,
  0x63: 0x5b, 0x64: 0x5c, 0x65: 0x5d, 0x66: 0x5e, 0x67: 0x5f, 0x68: 0x60, 0x69: 0x61, 0x60: 0x62, 0x6b: 0x57,
  0x6d: 0x56, 0x6a: 0x55, 0x6f: 0x54, 0x90: 0x53, 0xfd: 0x58, 0x6e: 0x63, 0xa2: 0xe0, 0xa0: 0xe1, 0xa4: 0xe2,
  0x5b: 0xe3, 0xa3: 0xe4, 0xa1: 0xe5, 0xa5: 0xe6, 0x5c: 0xe7, 0x5d: 0x65, 0xc2: 0x85, 0xc1: 0x87, 0xc3: 0x89,
  0xd8: 0x32, 0xda: 0x8a, 0xd7: 0x88, 0xeb: 0x8b, 0xc4: 0x90, 0xc5: 0x91,
};

// Değiştirici tuş VK → HID değiştirici biti (KB.ini ayrıştırmasındaki gibi tuş baytı 0 kalır)
const VK_MOD = { 0x10: 2, 0xa0: 2, 0x11: 1, 0xa2: 1, 0x12: 4, 0xa4: 4, 0x5b: 8, 0x5c: 0x80, 0xa1: 0x20, 0xa3: 0x10, 0xa5: 0x40 };

export const MODS = [
  { bit: 0x01, label: 'Sol Ctrl', short: 'Ctrl' },
  { bit: 0x02, label: 'Sol Shift', short: 'Shift' },
  { bit: 0x04, label: 'Sol Alt (⌥)', short: 'Alt' },
  { bit: 0x08, label: 'Sol Win (⌘)', short: 'Win' },
  { bit: 0x10, label: 'Sağ Ctrl', short: 'RCtrl' },
  { bit: 0x20, label: 'Sağ Shift', short: 'RShift' },
  { bit: 0x40, label: 'Sağ Alt (⌥)', short: 'RAlt' },
  { bit: 0x80, label: 'Sağ Win (⌘)', short: 'RWin' },
];

// Kodlama yardımcıları
export const keyBytes = (hid, mods = 0) => [0, mods & 0xff, 0, hid & 0xff];
export const modBytes = (bit) => [0, bit, 0, 0];
export const consumerBytes = (u) => [2, 0, (u >> 8) & 0xff, u & 0xff];
export const FN_BYTES = [0x0d, 0, 0, 0];
export const OFF_BYTES = [0, 0, 0, 0];
const bswap = (v) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];

// KB.ini [KEY] satırından varsayılan kod (sürücüdeki ayrıştırma + dönüşüm)
export function defaultBytes(k) {
  if (k.type === 9) return bswap(k.ext >>> 0);
  if (k.type !== 2) return null;
  if (k.vk === 0xfa) return FN_BYTES;
  if (k.vk === 0xfb) return [0x0d, 1, 0, 0];
  if (VK_MOD[k.vk] !== undefined) return modBytes(VK_MOD[k.vk]);
  const hid = VK2HID[k.vk];
  if (hid === undefined) return null;
  return keyBytes(hid, k.ext);
}

// Seçilebilir işlevler. id kalıcı kayıtta kullanılır.
// macOS hidutil kullanım kodu: sayfa << 32 | kod (klavye sayfası 7, tüketici sayfası 0x0C)
const PAGE_KB = 0x700000000;
const PAGE_CONSUMER = 0xc00000000;
const modUsage = (bit) => PAGE_KB + 0xe0 + Math.log2(bit);

const K = (id, label, hid, group) => ({ id: 'k' + hid.toString(16), label, group, bytes: keyBytes(hid), usage: PAGE_KB + hid });
const C = (label, u, group = 'Medya') => ({ id: 'c' + u.toString(16), label, group, bytes: consumerBytes(u), usage: PAGE_CONSUMER + u });

const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c, i) => K(c, c, 0x04 + i, 'Harfler'));
const digits = '1234567890'.split('').map((c, i) => K(c, c, 0x1e + i, 'Rakamlar'));
const fkeys = Array.from({ length: 12 }, (_, i) => K('F' + (i + 1), 'F' + (i + 1), 0x3a + i, 'F tuşları'));
const fkeys2 = Array.from({ length: 12 }, (_, i) => K('F' + (i + 13), 'F' + (i + 13), 0x68 + i, 'F tuşları'));

export const ACTIONS = [
  ...letters,
  ...digits,
  ...fkeys,
  ...fkeys2,
  ...[
    ['Esc', 0x29], ['Tab', 0x2b], ['Caps Lock', 0x39], ['Boşluk', 0x2c], ['Enter', 0x28], ['Backspace', 0x2a],
    ['Insert', 0x49], ['Delete', 0x4c], ['Home', 0x4a], ['End', 0x4d], ['Page Up', 0x4b], ['Page Down', 0x4e],
    ['Yukarı', 0x52], ['Aşağı', 0x51], ['Sol', 0x50], ['Sağ', 0x4f], ['Print Screen', 0x46], ['Scroll Lock', 0x47],
    ['Pause', 0x48], ['Menü (Uygulama)', 0x65],
  ].map(([l, h]) => K(l, l, h, 'Düzenleme ve gezinme')),
  ...[
    ['` / "', 0x35], ['- / *', 0x2d], ['= / -', 0x2e], ['[ / Ğ', 0x2f], ['] / Ü', 0x30], ['\\ / ,', 0x31],
    ['; / Ş', 0x33], ["' / İ", 0x34], [', / Ö', 0x36], ['. / Ç', 0x37], ['/ / .', 0x38], ['< > (ISO)', 0x64],
  ].map(([l, h]) => K(l, l, h, 'Noktalama (ABD / TR-Q)')),
  ...[
    ['Num Lock', 0x53], ['Num /', 0x54], ['Num *', 0x55], ['Num -', 0x56], ['Num +', 0x57], ['Num Enter', 0x58],
    ['Num 1', 0x59], ['Num 2', 0x5a], ['Num 3', 0x5b], ['Num 4', 0x5c], ['Num 5', 0x5d], ['Num 6', 0x5e],
    ['Num 7', 0x5f], ['Num 8', 0x60], ['Num 9', 0x61], ['Num 0', 0x62], ['Num .', 0x63],
  ].map(([l, h]) => K(l, l, h, 'Sayısal tuş takımı')),
  ...MODS.map((m) => ({ id: 'm' + m.bit.toString(16), label: m.label, group: 'Değiştiriciler', bytes: modBytes(m.bit), usage: modUsage(m.bit) })),
  C('Oynat / Duraklat', 0xcd),
  C('Durdur', 0xb7),
  C('Önceki parça', 0xb6),
  C('Sonraki parça', 0xb5),
  C('Ses +', 0xe9),
  C('Ses −', 0xea),
  C('Sessiz', 0xe2),
  C('Ekran parlaklığı +', 0x6f),
  C('Ekran parlaklığı −', 0x70),
  C('Medya oynatıcı', 0x183, 'Uygulama'),
  C('E-posta', 0x18a, 'Uygulama'),
  C('Hesap makinesi', 0x192, 'Uygulama'),
  C('Bilgisayarım', 0x194, 'Uygulama'),
  C('Ara', 0x221, 'Tarayıcı'),
  C('Ana sayfa', 0x223, 'Tarayıcı'),
  C('Geri', 0x224, 'Tarayıcı'),
  C('İleri', 0x225, 'Tarayıcı'),
  C('Durdur (tarayıcı)', 0x226, 'Tarayıcı'),
  C('Yenile', 0x227, 'Tarayıcı'),
  C('Sık kullanılanlar', 0x22a, 'Tarayıcı'),
  // macOS'ta "hiçbir şey" hedefi yok; F24 hiçbir uygulamada atanmamış olduğundan devre dışı yerine kullanılır.
  { id: 'off', label: 'Devre dışı', group: 'Diğer', bytes: OFF_BYTES, usage: PAGE_KB + 0x73 },
];

export const ACTION_BY_ID = Object.fromEntries(ACTIONS.map((a) => [a.id, a]));

// Kısayol: değiştiriciler + bir tuş, ör. ⌘+C
export function comboAction(mods, hid) {
  const key = ACTIONS.find((a) => a.id === 'k' + hid.toString(16));
  const names = MODS.filter((m) => mods & m.bit).map((m) => m.short);
  return { id: `x${mods.toString(16)}_${hid.toString(16)}`, label: [...names, key ? key.label : hid].join('+'), group: 'Kısayol', bytes: keyBytes(hid, mods) };
}

export function resolveAction(id) {
  if (ACTION_BY_ID[id]) return ACTION_BY_ID[id];
  const m = /^x([0-9a-f]+)_([0-9a-f]+)$/.exec(id || '');
  return m ? comboAction(parseInt(m[1], 16), parseInt(m[2], 16)) : null;
}

// Varsayılanlar + atamalar → 504 baytlık katman
export function buildLayer(keys, remap = {}) {
  const buf = new Array(MATRIX_LEN * 4).fill(0);
  const problems = [];
  for (const k of keys) {
    if (k.led >= MATRIX_LEN) continue;
    let b = defaultBytes(k);
    if (!b) {
      problems.push(k.name);
      continue;
    }
    const a = k.led !== FN_LED && remap[k.led] ? resolveAction(remap[k.led]) : null;
    if (a) b = a.bytes;
    for (let i = 0; i < 4; i++) buf[k.led * 4 + i] = b[i];
  }
  return { buf, problems };
}

// Hazır düzen: Mac için Alt ↔ Win (⌥ ↔ ⌘) yer değiştirme
export function macSwapPreset(keys) {
  const out = {};
  for (const k of keys) {
    if (k.type !== 2) continue;
    if (k.vk === 0x5b) out[k.led] = 'm4'; // LWin → LAlt
    if (k.vk === 0xa4 || k.vk === 0x12) out[k.led] = 'm8'; // LAlt → LWin
    if (k.vk === 0x5c) out[k.led] = 'm40';
    if (k.vk === 0xa5) out[k.led] = 'm80';
  }
  return out;
}

// Tuşun klavyeden gelen (varsayılan) kodu, hidutil kaynağı olarak
export function srcUsage(k) {
  const b = defaultBytes(k);
  if (!b || b[0] !== 0) return null;
  if (b[3]) return PAGE_KB + b[3];
  if (b[1] && !b[2]) return modUsage(b[1]);
  return null;
}

// Makro ataması: remap değeri 'macro:<id>'. Tetik tuşu kendi karakterini yazmasın diye F24'e yönlendirilir.
export const MACRO_PREFIX = 'macro:';
export const isMacro = (id) => typeof id === 'string' && id.startsWith(MACRO_PREFIX);
const OFF_USAGE = PAGE_KB + 0x73;

// Atamalar → hidutil çiftleri + makro bağları
export function buildPairs(keys, remap = {}) {
  const pairs = [];
  for (const k of keys) {
    const id = remap[k.led];
    if (!id || k.led === FN_LED) continue;
    const src = srcUsage(k);
    if (src == null) continue;
    if (isMacro(id)) {
      pairs.push({ src, dst: OFF_USAGE });
      continue;
    }
    const a = resolveAction(id);
    if (!a || a.usage == null) continue;
    pairs.push({ src, dst: a.usage });
  }
  return pairs;
}

export function buildBinds(keys, remap = {}) {
  const binds = [];
  for (const k of keys) {
    const id = remap[k.led];
    if (!isMacro(id) || k.led === FN_LED) continue;
    const src = srcUsage(k);
    if (src != null) binds.push({ src, macro: id.slice(MACRO_PREFIX.length) });
  }
  return binds;
}

// Klavye kullanım kodunun (sayfa 7, 0x04..0xe7) okunur adı
export function usageLabel(u) {
  if (u >= 0xe0 && u <= 0xe7) return MODS[u - 0xe0].label;
  const a = ACTION_BY_ID['k' + u.toString(16)];
  return a ? a.label : '0x' + u.toString(16);
}

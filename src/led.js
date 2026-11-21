// 128 baytlık LED/ayar profilinin yapısı (Fw=1, sürücüdeki FillCfg):
//   [3]     tuş tepki süresi (debounce)
//   [9]     1 = "Kendi tanımlama" modu seçili
//   [10]    efekt numarası (1..18), 0 = kapalı
//   [0x18]  uyku süresi (dk; 0 = kapalı)
//   [0x3A + 2i]  efekt i'nin parlaklığı (0,4,8,12,16,20)
//   [0x3B + 2i]  (hız << 4) | renk   renk 0..6 sabit, 7 = renkli
//   [0x5E]  özel mod parlaklığı
//   [126..127] = 5A A5 imza

export const LIGHT_HW = [0, 4, 8, 12, 16, 20];
export const SPEED_MAX = 5;
export const CUSTOM = 17;
export const OFF = 18;

// Sırasıyla tc_eft1..19; opts: hız, parlaklık, renk seçimi (KB.ini LedOpt)
const all = { speed: true, light: true, color: true };
const noColor = { speed: true, light: true, color: false };
export const EFFECTS = [
  { name: 'Sabit', ...all, speed: false },
  { name: 'Nefes Alma', ...all },
  { name: 'Gökkuşağı', ...noColor },
  { name: 'Parlayıp Sönme', ...all },
  { name: 'Yağmur Damlaları', ...all },
  { name: 'Gökkuşağı Çarkı', ...all },
  { name: 'Dalgalanma', ...all },
  { name: 'Yıldızlar', ...all },
  { name: 'Gölge Kaybolma', ...all },
  { name: 'Retro Yılan', ...all },
  { name: 'Neon Akış', ...all },
  { name: 'Tepki', ...all },
  { name: 'Sinüs Dalgası', ...all },
  { name: 'Takipçi Tarama', ...all },
  { name: 'Dönen Pervane', ...noColor },
  { name: 'Renkli Şelale', ...noColor },
  { name: 'Çiçek Açma', ...noColor },
  { name: 'Kendi Tanımlama', speed: false, light: true, color: false },
  { name: 'Kapalı', speed: false, light: false, color: false },
];

export const COLORS = [
  { name: 'Kırmızı', css: '#ff2a2a' },
  { name: 'Yeşil', css: '#2aff5a' },
  { name: 'Mavi', css: '#2a6bff' },
  { name: 'Sarı', css: '#ffe02a' },
  { name: 'Mor', css: '#e02aff' },
  { name: 'Camgöbeği', css: '#2affee' },
  { name: 'Beyaz', css: '#ffffff' },
  { name: 'Renkli', css: 'conic-gradient(#f33,#fd3,#3f6,#3df,#36f,#d3f,#f33)' },
];

export const SLEEP = [
  { label: '10 dk', v: 10 },
  { label: '20 dk', v: 20 },
  { label: '40 dk', v: 40 },
  { label: '60 dk', v: 60 },
  { label: 'Kapalı', v: 0 },
];

const near = (v) => {
  let best = 0;
  LIGHT_HW.forEach((x, i) => {
    if (Math.abs(x - v) < Math.abs(LIGHT_HW[best] - v)) best = i;
  });
  return best;
};

export function decode(b) {
  const mode = b[10] === 0 ? OFF : b[9] === 1 ? CUSTOM : Math.min(b[10] - 1, OFF);
  const per = EFFECTS.map((_, i) => {
    const lo = b[0x3a + i * 2];
    const hi = b[0x3b + i * 2];
    return { light: near(lo), speed: Math.min(hi >> 4, SPEED_MAX), color: Math.min(hi & 0x0f, 7) };
  });
  per[CUSTOM].light = near(b[0x5e]);
  return { mode, per, sleep: b[0x18] };
}

export function encode(orig, { mode, per, sleep }) {
  const b = [...orig];
  b[9] = mode === CUSTOM ? 1 : 0;
  b[10] = mode === OFF ? 0 : mode + 1;
  if (mode !== OFF) {
    const p = per[mode];
    if (mode === CUSTOM) {
      b[0x5e] = LIGHT_HW[p.light];
    } else {
      b[0x3a + mode * 2] = LIGHT_HW[p.light];
      b[0x3b + mode * 2] = ((p.speed & 0x0f) << 4) | (p.color & 0x0f);
    }
  }
  if (typeof sleep === 'number') b[0x18] = sleep;
  b[126] = 0x5a;
  b[127] = 0xa5;
  return b;
}

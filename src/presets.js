// Hazır ekran görüntüleri: canvas'ta kare kare çizilir, ScreenGif'in kare listesine ({ bmp, ms }) dönüşür.
// Hepsi kesintisiz döngü yapar. Ekran 240x240 ve yuvarlak.

const S = 240;
const TAU = Math.PI * 2;

async function frames(n, ms, draw) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = new OffscreenCanvas(S, S);
    const g = c.getContext('2d');
    draw(g, i / n, i);
    out.push({ bmp: await createImageBitmap(c), ms });
  }
  return out;
}

// ---- Apple logosu: macOS yazı tipindeki  (U+F8FF) işareti, 1977 gökkuşağı şeritleri, üzerinden geçen parıltı ----
const RAINBOW = ['#61BB46', '#FDB827', '#F5821F', '#E03A3E', '#963D97', '#009DDC'];

// Yazı tipi ilk kullanımda geç yüklenebiliyor (OffscreenCanvas'ta ilk çizim boş çıktı); önce yükle, belge canvas'ı kullan.
async function appleMask() {
  const font = '190px -apple-system, "Helvetica Neue", Helvetica, sans-serif';
  try {
    await document.fonts.load(font, '\uF8FF');
  } catch {}
  for (let attempt = 0; attempt < 3; attempt++) {
    const m = drawMask(font);
    if (m.ok) return m;
    await new Promise((r) => setTimeout(r, 100));
  }
  return drawMask(font);
}

function drawMask(font) {
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  g.font = font;
  const t = '';
  const m = g.measureText(t);
  const w = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
  const h = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  g.fillStyle = '#fff';
  g.fillText(t, (S - w) / 2 + m.actualBoundingBoxLeft, (S - h) / 2 + m.actualBoundingBoxAscent);
  const d = g.getImageData(0, 0, S, S).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 128) n++;
  return { c, top: (S - h) / 2, h, ok: n > 2000 };
}

export async function apple() {
  const mask = await appleMask();
  return frames(24, 70, (g, p) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, S, S);
    // logo: önce şeritler, sonra maske (destination-in). Not: şeritleri source-in ile tek tek çizmek
    // her fillRect'te alanı dışını sildiği için logoyu boşaltıyordu.
    const l = new OffscreenCanvas(S, S);
    const lg = l.getContext('2d');
    const band = mask.h / RAINBOW.length;
    RAINBOW.forEach((col, i) => {
      lg.fillStyle = col;
      lg.fillRect(0, mask.top + i * band - 0.5, S, band + 1);
    });
    lg.globalCompositeOperation = 'destination-in';
    lg.drawImage(mask.c, 0, 0);
    // parıltı: çapraz beyaz bant, döngünün ilk %60'ında soldan sağa geçer
    const x = -120 + (p / 0.6) * 480;
    if (p < 0.6) {
      lg.globalCompositeOperation = 'source-atop';
      const gr = lg.createLinearGradient(x - 50, 0, x + 50, 60);
      gr.addColorStop(0, 'rgba(255,255,255,0)');
      gr.addColorStop(0.5, 'rgba(255,255,255,0.75)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      lg.fillStyle = gr;
      lg.fillRect(0, 0, S, S);
    }
    // hafif parlama
    g.shadowColor = 'rgba(255,255,255,0.25)';
    g.shadowBlur = 18;
    g.drawImage(l, 0, 0);
    g.shadowBlur = 0;
  });
}

// ---- Türk bayrağı (2994 sayılı Türk Bayrağı Kanunu ölçüleri; G = genişlik/yükseklik) ----
//   dış daire merkezi gönderden 1/2 G, çapı 1/2 G; iç daire merkezler arası 1/16 G, çapı 2/5 G;
//   iç daire ile yıldız dairesi arası 1/3 × dış çap; yıldız dairesi çapı 1/4 G; boy 1,5 G. Yıldızın bir ucu aya bakar.
function flagCanvas(G) {
  const L = Math.round(1.5 * G);
  const c = new OffscreenCanvas(L, G);
  const g = c.getContext('2d');
  g.fillStyle = '#E30A17';
  g.fillRect(0, 0, L, G);
  const cy = G / 2;
  const ox = 0.5 * G, oR = 0.25 * G;
  const ix = ox + G / 16, iR = 0.2 * G;
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(ox, cy, oR, 0, TAU);
  g.fill();
  g.fillStyle = '#E30A17';
  g.beginPath();
  g.arc(ix, cy, iR, 0, TAU);
  g.fill();
  const sR = G / 8;
  const sx = ix + iR + (0.5 * G) / 3 + sR;
  g.fillStyle = '#fff';
  g.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = Math.PI + (k * TAU) / 10; // ilk uç sola (aya) bakar
    const r = k % 2 === 0 ? sR : sR * 0.382;
    g.lineTo(sx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  g.closePath();
  g.fill();
  return { c, L, G, center: (ox - oR + sx + sR) / 2 };
}

export function turkishFlag() {
  const f = flagCanvas(230);
  const ox = S / 2 - f.center; // ay-yıldız ortada
  const oy = (S - f.G) / 2;
  return frames(20, 80, (g, p) => {
    g.fillStyle = '#B00812';
    g.fillRect(0, 0, S, S);
    // dikey dilimlerle dalga + gölge
    const step = 2;
    for (let x = 0; x < S; x += step) {
      const sx = x - ox;
      const ph = TAU * p - sx * 0.035;
      const dy = Math.sin(ph) * 7 * (0.3 + Math.max(0, sx) / f.L);
      g.drawImage(f.c, Math.max(0, sx), 0, step, f.G, x, oy + dy - 12, step, f.G + 24);
      const shade = Math.cos(ph) * 0.18;
      g.fillStyle = shade > 0 ? `rgba(255,255,255,${shade})` : `rgba(0,0,0,${-shade})`;
      g.fillRect(x, 0, step, S);
    }
  });
}

// ---- Radar: dönen ışın, iz bırakan hedefler ----
const BLIPS = [
  [0.7, 0.55], [2.1, 0.8], [3.4, 0.35], [4.3, 0.68], [5.5, 0.45], [1.3, 0.25],
];

export function radar() {
  return frames(30, 60, (g, p) => {
    const c = S / 2, R = 112;
    g.fillStyle = '#020a04';
    g.fillRect(0, 0, S, S);
    const beam = TAU * p - Math.PI / 2;
    // iz (ışının arkasında sönen yelpaze)
    for (let k = 0; k < 40; k++) {
      const a0 = beam - (k + 1) * 0.035, a1 = beam - k * 0.035;
      g.fillStyle = `rgba(40,255,120,${0.28 * (1 - k / 40) ** 2})`;
      g.beginPath();
      g.moveTo(c, c);
      g.arc(c, c, R, a0, a1 + 0.002);
      g.closePath();
      g.fill();
    }
    // halkalar ve eksenler
    g.strokeStyle = 'rgba(60,255,140,0.35)';
    g.lineWidth = 1;
    for (const r of [R * 0.33, R * 0.66, R]) {
      g.beginPath();
      g.arc(c, c, r, 0, TAU);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(c - R, c); g.lineTo(c + R, c);
    g.moveTo(c, c - R); g.lineTo(c, c + R);
    g.stroke();
    // hedefler: ışın geçince parlar, sonra söner
    for (const [a, d] of BLIPS) {
      const ang = a - Math.PI / 2;
      const since = (((beam - ang) % TAU) + TAU) % TAU; // ışın geçeli kaç radyan
      const life = Math.max(0, 1 - since / 4);
      if (life <= 0) continue;
      const x = c + Math.cos(ang) * d * R, y = c + Math.sin(ang) * d * R;
      g.fillStyle = `rgba(120,255,170,${life})`;
      g.shadowColor = 'rgba(80,255,150,0.9)';
      g.shadowBlur = 10 * life;
      g.beginPath();
      g.arc(x, y, 3.5 + 1.5 * life, 0, TAU);
      g.fill();
      g.shadowBlur = 0;
    }
    // ışın çizgisi
    g.strokeStyle = 'rgba(150,255,190,0.95)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(c, c);
    g.lineTo(c + Math.cos(beam) * R, c + Math.sin(beam) * R);
    g.stroke();
    g.fillStyle = '#9fffc0';
    g.beginPath();
    g.arc(c, c, 3, 0, TAU);
    g.fill();
  });
}

export const PRESETS = [
  { id: 'apple', label: 'Apple logosu', make: apple },
  { id: 'flag', label: 'Türk bayrağı', make: turkishFlag },
  { id: 'radar', label: 'Radar', make: radar },
];

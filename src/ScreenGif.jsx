import { useEffect, useRef, useState } from 'react';
import defaultGif from './assets/screen-default.gif';

// Klavye ekranı: 240x240, yuvarlak, en fazla 35 kare, tek gecikme (tüm kareler için). Bkz. electron/screen.cjs
const api = window.kb;
const S = 240;
const MAX = 35;
const SEC_PER_FRAME = 3.6; // ölçüldü: kare başına ~3,5 sn (225 sayfa, her biri onaylı)

// Dosyadaki tüm kareleri (birleştirilmiş hâlleriyle) ve sürelerini çözer
async function decodeAll(blob) {
  const type = blob.type || 'image/gif';
  if ('ImageDecoder' in window && (await ImageDecoder.isTypeSupported(type))) {
    const dec = new ImageDecoder({ data: await blob.arrayBuffer(), type });
    await dec.tracks.ready;
    await dec.completed;
    const n = dec.tracks.selectedTrack?.frameCount || 1;
    const out = [];
    for (let i = 0; i < n; i++) {
      const { image } = await dec.decode({ frameIndex: i });
      const bmp = await createImageBitmap(image);
      out.push({ bmp, ms: image.duration ? image.duration / 1000 : 100 });
      image.close();
    }
    dec.close();
    return out;
  }
  return [{ bmp: await createImageBitmap(blob), ms: 100 }];
}

// Kareyi 240x240 tuvale çizer (doldur: kırparak, sığdır: kenar boşluklu)
function render(bmp, fit, bg) {
  const c = new OffscreenCanvas(S, S);
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, S, S);
  const k = fit === 'cover' ? Math.max(S / bmp.width, S / bmp.height) : Math.min(S / bmp.width, S / bmp.height);
  const w = bmp.width * k, h = bmp.height * k;
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, (S - w) / 2, (S - h) / 2, w, h);
  return g.getImageData(0, 0, S, S);
}

// RGBA → RGB565 büyük uçlu (DeviceDriver.exe 0x466475: ((R>>3)<<11 | (G>>2)<<5 | B>>3), bayt sırası ters)
function toRgb565(img) {
  const d = img.data;
  const out = new Uint8Array(S * S * 2);
  for (let i = 0, j = 0; i < d.length; i += 4, j += 2) {
    const v = ((d[i] >> 3) << 11) | ((d[i + 1] >> 2) << 5) | (d[i + 2] >> 3);
    out[j] = v >> 8;
    out[j + 1] = v & 0xff;
  }
  return out;
}

const eta = (m) => {
  const s = Math.ceil(m * SEC_PER_FRAME);
  return s < 60 ? s + ' sn' : Math.round(s / 60) + ' dk';
};

// n kareden m tanesini eşit aralıkla seç
const pick = (n, m) => Array.from({ length: m }, (_, j) => Math.floor((j * n) / m));

export default function ScreenGif({ say }) {
  const [src, setSrc] = useState(null); // { name, frames:[{bmp, ms}] }
  const [fit, setFit] = useState('cover');
  const [bg, setBg] = useState('#000000');
  const [count, setCount] = useState(MAX);
  const [delay, setDelay] = useState(100);
  const [prog, setProg] = useState(null);
  const [drag, setDrag] = useState(false);
  const canvas = useRef(null);
  const frames = useRef([]); // ImageData[]
  const fileRef = useRef(null);

  const load = async (blob, name) => {
    try {
      const fr = await decodeAll(blob);
      const m = Math.min(MAX, fr.length);
      const total = fr.reduce((s, f) => s + f.ms, 0);
      setCount(m);
      setDelay(Math.max(20, Math.round(total / m)));
      setSrc({ name, frames: fr });
    } catch (e) {
      say('Görüntü açılamadı: ' + e.message, true);
    }
  };

  // Seçilen kareleri hazırla
  useEffect(() => {
    if (!src) return;
    frames.current = pick(src.frames.length, Math.min(count, src.frames.length)).map((i) => render(src.frames[i].bmp, fit, bg));
  }, [src, fit, bg, count]);

  // Önizleme canlandırması
  useEffect(() => {
    if (!src) return;
    let i = 0;
    const draw = () => {
      const f = frames.current;
      if (f.length && canvas.current) canvas.current.getContext('2d').putImageData(f[i++ % f.length], 0, 0);
    };
    draw();
    const t = setInterval(draw, Math.max(20, delay));
    return () => clearInterval(t);
  }, [src, fit, bg, count, delay]);

  useEffect(() => api.onScreenProgress((p) => setProg(p)), []);

  const upload = async () => {
    const list = frames.current.map(toRgb565);
    setProg({ done: 0, total: list.length * 225 });
    const r = await api.uploadScreen(list, delay);
    setProg(null);
    if (!r.ok) return say('Yüklenemedi: ' + r.error, true);
    say(r.data.cancelled ? 'Yükleme iptal edildi; ekran eski görüntüsünde kaldı.' : `Ekrana yüklendi (${r.data.frames} kare).`);
  };

  const n = src ? src.frames.length : 0;
  const m = Math.min(count, n);
  const busy = !!prog;

  return (
    <section
      className={'card' + (drag ? ' dropping' : '')}
      onDragOver={(e) => (e.preventDefault(), setDrag(true))}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files[0];
        if (f) load(f, f.name);
      }}
    >
      <h3>Ekran görüntüsü (GIF / resim)</h3>
      <p className="hint">
        GIF, PNG, JPG ya da WebP seçin veya buraya sürükleyin. Ekran 240×240 ve yuvarlak; en fazla {MAX} kare, tüm kareler
        aynı süreyle oynar. Yükleme kare başına yaklaşık 3,5 saniye sürer.
      </p>
      <div className="row">
        <button className="primary" disabled={busy} onClick={() => fileRef.current.click()}>
          Dosya seç…
        </button>
        <button
          disabled={busy}
          onClick={async () => load(await (await fetch(defaultGif)).blob(), 'Fabrika görüntüsü')}
        >
          Fabrika görüntüsü
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/gif,image/png,image/jpeg,image/webp,image/bmp"
          hidden
          onChange={(e) => {
            const f = e.target.files[0];
            if (f) load(f, f.name);
            e.target.value = '';
          }}
        />
      </div>

      {src && (
        <div className="gifbox">
          <div className="round">
            <canvas ref={canvas} width={S} height={S} />
          </div>
          <div className="gifopts">
            <div className="sub">
              {src.name} — {n} kare
            </div>
            <div className="seg">
              <button className={fit === 'cover' ? 'on' : ''} onClick={() => setFit('cover')}>
                Doldur
              </button>
              <button className={fit === 'contain' ? 'on' : ''} onClick={() => setFit('contain')}>
                Sığdır
              </button>
            </div>
            {fit === 'contain' && (
              <label className="check">
                Arka plan <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} />
              </label>
            )}
            {n > 1 && (
              <>
                <label className="lbl">
                  Kare sayısı: <b>{m}</b> / {n}
                  {n > MAX && <span className="hint"> (en fazla {MAX}; kareler eşit aralıkla seçilir)</span>}
                </label>
                <input type="range" min={1} max={Math.min(MAX, n)} value={m} onChange={(e) => setCount(+e.target.value)} />
                <label className="lbl">
                  Kare süresi:{' '}
                  <input
                    type="number"
                    className="num"
                    min={20}
                    max={5000}
                    step={10}
                    value={delay}
                    onChange={(e) => setDelay(Math.max(20, Math.min(5000, +e.target.value || 100)))}
                  />{' '}
                  ms
                </label>
              </>
            )}
            {busy ? (
              <>
                <div className="bar">
                  <div style={{ width: `${(100 * prog.done) / prog.total}%` }} />
                </div>
                <div className="row">
                  <span className="sub">
                    Yükleniyor… %{Math.floor((100 * prog.done) / prog.total)}
                  </span>
                  <button onClick={() => api.cancelScreen()}>İptal</button>
                </div>
              </>
            ) : (
              <button className="primary" onClick={upload}>
                Klavyeye yükle (~{eta(m)})
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

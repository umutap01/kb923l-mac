import { useEffect, useRef, useState, useCallback } from 'react';
import KeyboardView, { ALL_LEDS } from './KeyboardView.jsx';
import Remap from './Remap.jsx';
import Macro from './Macro.jsx';
import Layer from './Layer.jsx';
import { EFFECTS, COLORS, SLEEP, LIGHT_HW, SPEED_MAX, CUSTOM, OFF, decode, encode } from './led.js';

const api = window.kb;
const TABS = [
  { id: 'light', label: 'Aydınlatma' },
  { id: 'custom', label: 'Özel Renkler' },
  { id: 'remap', label: 'Tuş Atama' },
  { id: 'layer', label: 'Fn Katmanı' },
  { id: 'macro', label: 'Makro' },
  { id: 'screen', label: 'Ekran ve Saat' },
  { id: 'settings', label: 'Klavye' },
];

const LS_CUSTOM = 'kb923l.custom';
const LS_SYNC = 'kb923l.autoSync';

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export default function App() {
  const [status, setStatus] = useState({ present: false, connected: false });
  const [tab, setTab] = useState('light');
  const [raw, setRaw] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const pending = useRef(null);
  const timer = useRef(null);

  const say = (msg, err) => {
    setToast({ msg, err });
    clearTimeout(say.t);
    say.t = setTimeout(() => setToast(null), 2600);
  };

  const load = useCallback(async () => {
    const r = await api.readLed();
    if (r.ok) {
      setRaw(r.data);
      setCfg(decode(r.data));
    } else if (r.error !== 'PERMISSION') say('Klavyeden okunamadı: ' + r.error, true);
  }, []);

  useEffect(() => {
    api.getStatus().then(setStatus);
    return api.onStatus(setStatus);
  }, []);

  useEffect(() => {
    if (status.connected) load();
    else {
      setRaw(null);
      setCfg(null);
    }
  }, [status.connected, load]);

  // Değişiklikler 250 ms içinde toplanıp tek yazmayla gönderilir.
  const apply = (next) => {
    setCfg(next);
    pending.current = next;
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const c = pending.current;
      if (!raw || !c) return;
      setBusy(true);
      const bytes = encode(raw, c);
      const r = await api.writeLed(bytes);
      setBusy(false);
      if (r.ok) setRaw(bytes);
      else say('Gönderilemedi: ' + r.error, true);
    }, 250);
  };

  const setPer = (mode, patch) => {
    const per = cfg.per.map((p, i) => (i === mode ? { ...p, ...patch } : p));
    apply({ ...cfg, per });
  };

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo">⌨</span>
          <div>
            <div className="title">KB923L Pro</div>
            <div className="sub">Mac yapılandırıcı</div>
          </div>
        </div>
        <Status status={status} busy={busy} />
      </header>

      <div className="body">
        <nav className="side">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
          <div className="grow" />
          <button className="ghost" onClick={load} disabled={!status.connected}>
            Klavyeden yeniden oku
          </button>
        </nav>

        <main className="main">
          {status.error === 'PERMISSION' ? (
            <Permission />
          ) : !status.present ? (
            <Empty text="Klavye bulunamadı. KB923L Pro'yu USB kablosuyla bağlayın." />
          ) : !cfg ? (
            <Empty text="Klavye ayarları okunuyor…" />
          ) : tab === 'light' ? (
            <Lighting cfg={cfg} apply={apply} setPer={setPer} />
          ) : tab === 'custom' ? (
            <Custom cfg={cfg} apply={apply} setPer={setPer} say={say} />
          ) : tab === 'remap' ? (
            <Remap say={say} />
          ) : tab === 'layer' ? (
            <Layer say={say} />
          ) : tab === 'macro' ? (
            <Macro say={say} />
          ) : tab === 'screen' ? (
            <Screen say={say} />
          ) : (
            <Settings cfg={cfg} apply={apply} say={say} reload={load} />
          )}
        </main>
      </div>
      {toast && <div className={'toast' + (toast.err ? ' err' : '')}>{toast.msg}</div>}
    </div>
  );
}

function Status({ status, busy }) {
  const [cls, text] = status.connected
    ? ['ok', busy ? 'Gönderiliyor…' : 'Bağlı']
    : status.present
      ? ['warn', 'Erişim yok']
      : ['off', 'Bağlı değil'];
  return (
    <div className={'status ' + cls}>
      <span className="dot" />
      {text}
    </div>
  );
}

function Empty({ text }) {
  return (
    <div className="empty">
      <KeyboardView />
      <p>{text}</p>
    </div>
  );
}

function Permission() {
  return (
    <div className="empty">
      <h2>Giriş İzleme izni gerekiyor</h2>
      <p>
        macOS, klavyeye ayar gönderen uygulamalardan <b>Giriş İzleme</b> izni ister. Sistem Ayarları → Gizlilik ve Güvenlik →
        Giriş İzleme'de "KB923L Pro"yu açın, sonra uygulamayı yeniden başlatın. Listede zaten açık görünüyorsa
        kapatıp yeniden açın.
      </p>
      <div className="row center">
        <button className="primary" onClick={() => api.openPrivacy()}>
          Ayarları aç
        </button>
        <button onClick={() => api.relaunch()}>Uygulamayı yeniden başlat</button>
      </div>
    </div>
  );
}

function Slider({ label, value, max, onChange, left, right }) {
  return (
    <div className="slider">
      <div className="slabel">
        <span>{label}</span>
        <b>{value}</b>
      </div>
      <input type="range" min={0} max={max} step={1} value={value} onChange={(e) => onChange(+e.target.value)} />
      {(left || right) && (
        <div className="ends">
          <span>{left}</span>
          <span>{right}</span>
        </div>
      )}
    </div>
  );
}

function Lighting({ cfg, apply, setPer }) {
  const m = cfg.mode;
  const eff = EFFECTS[m];
  const p = cfg.per[m];
  return (
    <div className="panel">
      <div className="preview">
        <KeyboardView />
      </div>
      <div className="cols">
        <section className="card grow">
          <h3>Efekt</h3>
          <div className="effects">
            {EFFECTS.map((e, i) => (
              <button key={i} className={'eff' + (i === m ? ' on' : '')} onClick={() => apply({ ...cfg, mode: i })}>
                {e.name}
              </button>
            ))}
          </div>
        </section>
        <section className="card side-card">
          <h3>{eff.name}</h3>
          {eff.light && (
            <Slider label="Parlaklık" value={p.light} max={LIGHT_HW.length - 1} onChange={(v) => setPer(m, { light: v })} />
          )}
          {eff.speed && (
            <Slider label="Hız" value={p.speed} max={SPEED_MAX} onChange={(v) => setPer(m, { speed: v })} />
          )}
          {eff.color && (
            <div className="colors">
              <div className="slabel">
                <span>Renk</span>
                <b>{COLORS[p.color].name}</b>
              </div>
              <div className="swatches">
                {COLORS.map((c, i) => (
                  <button
                    key={i}
                    title={c.name}
                    className={'sw' + (p.color === i ? ' on' : '')}
                    style={{ background: c.css }}
                    onClick={() => setPer(m, { color: i })}
                  />
                ))}
              </div>
            </div>
          )}
          {m === CUSTOM && <p className="hint">Tuş renklerini "Özel Renkler" sekmesinde düzenleyin.</p>}
          {m === OFF && <p className="hint">Klavye ışıkları kapalı.</p>}
        </section>
      </div>
    </div>
  );
}

function Custom({ cfg, apply, setPer, say }) {
  const [colors, setColors] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(LS_CUSTOM)) || {};
    } catch {
      return {};
    }
  });
  const [selected, setSelected] = useState(new Set());
  const [pick, setPick] = useState('#3a8bff');
  const drag = useRef(null);

  useEffect(() => {
    const up = () => (drag.current = null);
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  const toggle = (led, on) =>
    setSelected((s) => {
      const n = new Set(s);
      on ? n.add(led) : n.delete(led);
      return n;
    });

  const onKeyDown = (k, e) => {
    const on = !selected.has(k.led) || e.shiftKey;
    drag.current = on;
    if (!e.metaKey && !e.shiftKey && on) setSelected(new Set([k.led]));
    else toggle(k.led, on);
  };
  const onKeyEnter = (k) => drag.current !== null && toggle(k.led, drag.current);

  const paint = (rgb) => {
    if (!selected.size) return say('Önce tuş seçin (sürükleyerek çoklu seçim, ⌘ ile ekleme).', true);
    const next = { ...colors };
    selected.forEach((l) => (next[l] = rgb));
    setColors(next);
    localStorage.setItem(LS_CUSTOM, JSON.stringify(next));
  };

  const send = async () => {
    const arr = [];
    for (const l of ALL_LEDS) arr[l] = colors[l] || [0, 0, 0];
    const r = await api.writeCustom(arr);
    if (!r.ok) return say('Gönderilemedi: ' + r.error, true);
    if (cfg.mode !== CUSTOM) apply({ ...cfg, mode: CUSTOM });
    say('Özel renkler klavyeye yazıldı.');
  };

  const quick = ['#ff2a2a', '#ff8a00', '#ffe02a', '#2aff5a', '#2affee', '#2a6bff', '#9a2aff', '#ff2ad4', '#ffffff', '#000000'];

  return (
    <div className="panel">
      <div className="preview">
        <KeyboardView colors={colors} selected={selected} interactive onKeyDown={onKeyDown} onKeyEnter={onKeyEnter} />
      </div>
      <div className="cols">
        <section className="card grow">
          <h3>Seçim</h3>
          <p className="hint">
            Tuşa tıklayın; sürükleyerek birden fazla seçin, ⌘ veya ⇧ ile seçime ekleyin. {selected.size} tuş seçili.
          </p>
          <div className="row">
            <button onClick={() => setSelected(new Set(ALL_LEDS))}>Tümünü seç</button>
            <button onClick={() => setSelected(new Set())}>Seçimi kaldır</button>
            <button
              onClick={() => {
                setColors({});
                localStorage.removeItem(LS_CUSTOM);
              }}
            >
              Tüm renkleri sil
            </button>
          </div>
        </section>
        <section className="card side-card">
          <h3>Renk</h3>
          <div className="pickrow">
            <input type="color" value={pick} onChange={(e) => setPick(e.target.value)} />
            <button className="primary" onClick={() => paint(hexToRgb(pick))}>
              Seçili tuşlara uygula
            </button>
          </div>
          <div className="swatches">
            {quick.map((h) => (
              <button
                key={h}
                className="sw"
                style={{ background: h }}
                onClick={() => {
                  setPick(h);
                  paint(hexToRgb(h));
                }}
              />
            ))}
          </div>
          <Slider
            label="Parlaklık"
            value={cfg.per[CUSTOM].light}
            max={LIGHT_HW.length - 1}
            onChange={(v) => setPer(CUSTOM, { light: v })}
          />
          <button className="primary wide" onClick={send}>
            Klavyeye gönder
          </button>
        </section>
      </div>
    </div>
  );
}

function Screen({ say }) {
  const [auto, setAuto] = useState(() => localStorage.getItem(LS_SYNC) !== '0');
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    api.setAutoSync(auto);
    localStorage.setItem(LS_SYNC, auto ? '1' : '0');
  }, [auto]);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="panel narrow">
      <section className="card">
        <h3>Ekran saati</h3>
        <div className="clock">{now.toLocaleTimeString('tr-TR')}</div>
        <div className="sub center">{now.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
        <label className="check">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          Saati ve ses seviyesini klavye ekranına otomatik gönder
        </label>
        <p className="hint">
          Uygulama açıkken (pencere kapalı olsa bile menü çubuğunda) Mac'in saati ve ses seviyesi klavyenin ekranına aktarılır.
        </p>
        <button
          className="primary"
          onClick={async () => {
            const r = await api.syncNow();
            say(r.ok ? 'Saat eşitlendi.' : 'Gönderilemedi: ' + r.error, !r.ok);
          }}
        >
          Şimdi eşitle
        </button>
      </section>
    </div>
  );
}

function Settings({ cfg, apply, say, reload }) {
  return (
    <div className="panel narrow">
      <section className="card">
        <h3>Fabrika ayarları</h3>
        <p className="hint">
          Işık, tuş atama ve diğer tüm ayarları klavyenin üretici varsayılanlarına döndürür. Tuşlar beklenmedik davranırsa
          buradan (fareyle) kurtarabilirsiniz.
        </p>
        <button
          onClick={async () => {
            if (!window.confirm('Klavyedeki tüm ayarlar fabrika varsayılanına dönsün mü?')) return;
            const r = await api.factoryReset();
            if (!r.ok) return say('Gönderilemedi: ' + r.error, true);
            localStorage.removeItem('kb923l.remap');
            localStorage.removeItem('kb923l.remapApplied');
            localStorage.removeItem('kb923l.layer');
            localStorage.removeItem('kb923l.layerApplied');
            await api.applyRemap({ pairs: [], binds: [], layer: null });
            say('Fabrika ayarları yüklendi.');
            setTimeout(reload, 1500);
          }}
        >
          Fabrika ayarlarına dön
        </button>
      </section>
      <section className="card">
        <h3>Uyku süresi</h3>
        <p className="hint">Klavye bu süre kullanılmazsa ışıklarını kapatır.</p>
        <div className="seg">
          {SLEEP.map((s) => (
            <button key={s.v} className={cfg.sleep === s.v ? 'on' : ''} onClick={() => apply({ ...cfg, sleep: s.v })}>
              {s.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

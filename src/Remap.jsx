import { useEffect, useMemo, useState } from 'react';
import layout from './data/layout.json';
import KeyboardView from './KeyboardView.jsx';
import { applyAll } from './apply.js';
import { ACTIONS, FN_LED, resolveAction, buildPairs, buildBinds, macSwapPreset, isMacro, isHostAction, MACRO_PREFIX } from './keymap.js';

const api = window.kb;
const LS_REMAP = 'kb923l.remap';
const LS_SENT = 'kb923l.remapApplied'; // eski 'remapSent' firmware denemelerinden kaldı, kullanılmaz

const KEY_BY_LED = Object.fromEntries(layout.keys.filter((k) => k.x2 > k.x1).map((k) => [k.led, k]));

// KeyboardEvent.code → HID kullanım kodu (fiziksel tuşa basarak seçmek için)
const CODE2HID = (() => {
  const m = {};
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((c, i) => (m['Key' + c] = 0x04 + i));
  '1234567890'.split('').forEach((c, i) => (m['Digit' + c] = 0x1e + i));
  for (let i = 1; i <= 24; i++) m['F' + i] = i <= 12 ? 0x3a + i - 1 : 0x68 + i - 13;
  Object.assign(m, {
    Enter: 0x28, Escape: 0x29, Backspace: 0x2a, Tab: 0x2b, Space: 0x2c, Minus: 0x2d, Equal: 0x2e, BracketLeft: 0x2f,
    BracketRight: 0x30, Backslash: 0x31, Semicolon: 0x33, Quote: 0x34, Backquote: 0x35, Comma: 0x36, Period: 0x37,
    Slash: 0x38, CapsLock: 0x39, PrintScreen: 0x46, ScrollLock: 0x47, Pause: 0x48, Insert: 0x49, Home: 0x4a,
    PageUp: 0x4b, Delete: 0x4c, End: 0x4d, PageDown: 0x4e, ArrowRight: 0x4f, ArrowLeft: 0x50, ArrowDown: 0x51,
    ArrowUp: 0x52, NumLock: 0x53, NumpadDivide: 0x54, NumpadMultiply: 0x55, NumpadSubtract: 0x56, NumpadAdd: 0x57,
    NumpadEnter: 0x58, Numpad1: 0x59, Numpad2: 0x5a, Numpad3: 0x5b, Numpad4: 0x5c, Numpad5: 0x5d, Numpad6: 0x5e,
    Numpad7: 0x5f, Numpad8: 0x60, Numpad9: 0x61, Numpad0: 0x62, NumpadDecimal: 0x63, IntlBackslash: 0x64,
    ContextMenu: 0x65,
  });
  return m;
})();
const CODE2MOD = {
  ControlLeft: 0x01, ShiftLeft: 0x02, AltLeft: 0x04, MetaLeft: 0x08,
  ControlRight: 0x10, ShiftRight: 0x20, AltRight: 0x40, MetaRight: 0x80,
};

function load(key, def) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? def;
  } catch {
    return def;
  }
}

export default function Remap({ say }) {
  const [remap, setRemap] = useState(() => load(LS_REMAP, {}));
  const [sent, setSent] = useState(() => load(LS_SENT, {}));
  const [sel, setSel] = useState(null);
  const [q, setQ] = useState('');
  const [login, setLogin] = useState(false);
  const [macros, setMacros] = useState([]);
  const [trusted, setTrusted] = useState(null);
  useEffect(() => {
    api.getLogin().then(setLogin);
    api.getMacros().then((m) => setMacros(m || []));
    api.macroState().then((s) => setTrusted(s.trusted));
    api.macroTrust(false);
    return api.onMacroState((s) => setTrusted(s.trusted));
  }, []);
  const macroActions = useMemo(
    () => macros.map((m) => ({ id: MACRO_PREFIX + m.id, label: '⚡ ' + m.name, group: 'Makrolar' })),
    [macros],
  );
  const resolve = (id) => (isMacro(id) ? macroActions.find((a) => a.id === id) || null : resolveAction(id));
  const [capture, setCapture] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = (r) => {
    setRemap(r);
    localStorage.setItem(LS_REMAP, JSON.stringify(r));
  };
  const assign = (id) => {
    if (sel == null) return say('Önce klavyeden bir tuş seçin.', true);
    const r = { ...remap };
    if (id) r[sel] = id;
    else delete r[sel];
    save(r);
  };

  // Fiziksel tuşa basarak hedef işlev seçimi
  useEffect(() => {
    if (!capture) return;
    const down = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const mod = CODE2MOD[e.code];
      if (mod) {
        assign('m' + mod.toString(16));
      } else {
        const hid = CODE2HID[e.code];
        if (!hid) return say('Bu tuş tanınmadı: ' + e.code, true);
        assign('k' + hid.toString(16));
      }
      setCapture(false);
    };
    window.addEventListener('keydown', down, true);
    return () => window.removeEventListener('keydown', down, true);
  }, [capture, sel, remap]);

  const labels = useMemo(() => {
    const l = {};
    for (const [led, id] of Object.entries(remap)) {
      const a = resolve(id);
      if (a) l[led] = a.label;
    }
    return l;
  }, [remap, macroActions]);

  const dirty = JSON.stringify(remap) !== JSON.stringify(sent);
  const groups = useMemo(() => {
    const f = q.trim().toLocaleLowerCase('tr');
    const g = {};
    if (!f && !macroActions.length) g['Makrolar'] = [];
    for (const a of [...macroActions, ...ACTIONS]) {
      if (f && !a.label.toLocaleLowerCase('tr').includes(f) && !a.group.toLocaleLowerCase('tr').includes(f)) continue;
      (g[a.group] ||= []).push(a);
    }
    return g;
  }, [q, macroActions]);

  const send = async (r = remap) => {
    setBusy(true);
    const res = await applyAll({ remap: r });
    setBusy(false);
    if (!res.ok) return say('Uygulanamadı: ' + res.error, true);
    setSent(r);
    localStorage.setItem(LS_SENT, JSON.stringify(r));
    say(res.data ? `${res.data} tuş ataması uygulandı.` : 'Tuş atamaları kaldırıldı.');
  };

  const selKey = sel != null ? KEY_BY_LED[sel] : null;
  const cur = sel != null && remap[sel] ? resolve(remap[sel]) : null;

  return (
    <div className="panel">
      <div className="preview">
        <KeyboardView
          interactive
          selected={sel != null ? new Set([sel]) : null}
          labels={labels}
          locked={new Set([FN_LED])}
          onKeyDown={(k) => {
            if (k.led === FN_LED) return say('Fn tuşu değiştirilemez (Fn katmanı kaybolur).', true);
            setSel(k.led);
            setCapture(false);
          }}
        />
      </div>
      {trusted === false && Object.values(remap).some(isHostAction) && (
        <section className="card warn">
          <h3>Erişilebilirlik izni gerekli</h3>
          <p className="hint">
            Fare ve makro atamaları Mac'e tıklama / tuş gönderir; bunun için Sistem Ayarları → Gizlilik ve Güvenlik →
            Erişilebilirlik'te "KB923L Pro" açık olmalı.
          </p>
          <div className="row">
            <button className="primary" onClick={() => (api.macroTrust(true), api.openAccessibility())}>
              İzin iste
            </button>
            <button onClick={() => api.macroTrust(false)}>Yeniden denetle</button>
          </div>
        </section>
      )}
      <div className="cols">
        <section className="card grow">
          {!selKey ? (
            <>
              <h3>Tuş atama</h3>
              <p className="hint">
                Değiştirmek istediğiniz tuşa klavye görselinde tıklayın, sonra sağdan yeni işlevini seçin. Değiştirilmiş tuşlar
                kırmızı çerçeveyle gösterilir. Atamalar macOS tarafında yalnız bu klavyeye uygulanır (klavyenin hafızasına
                yazılmaz; başka bilgisayarda geçerli olmaz). Fn tuşu ve Fn ile açılan işlevler olduğu gibi kalır. Klavyenin
                Win/Mac modu (Fn+A / Fn+S) Alt ve Win tuşlarının yerini değiştirebilir; atamayı kullandığınız modda yapın. Fare
                ve makro atamaları uygulama açıkken (menü çubuğunda) çalışır.
              </p>
            </>
          ) : (
            <>
              <h3>
                Seçili tuş: <span className="tag">{selKey.name}</span> → <span className="tag on">{cur ? cur.label : 'varsayılan'}</span>
              </h3>
              <div className="row">
                <button className={capture ? 'primary' : ''} onClick={() => setCapture(!capture)}>
                  {capture ? 'Bir tuşa basın… (iptal)' : 'Tuşa basarak seç'}
                </button>
                <button onClick={() => assign(null)} disabled={!cur}>
                  Varsayılana döndür
                </button>
              </div>
            </>
          )}
          <div className="row bottom">
            <button className="primary" disabled={busy || !dirty} onClick={() => send()}>
              {busy ? 'Uygulanıyor…' : dirty ? 'Uygula' : 'Uygulandı'}
            </button>
            <button
              onClick={() => {
                save(macSwapPreset(layout.keys));
                say('Alt ↔ Win değişimi hazırlandı; etkinleştirmek için "Uygula".');
              }}
            >
              Mac düzeni (Alt ↔ Win)
            </button>
            <button
              disabled={busy}
              onClick={() => {
                if (!window.confirm('Tüm tuş atamaları kaldırılsın mı?')) return;
                save({});
                send({});
              }}
            >
              Tümünü kaldır
            </button>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={login}
              onChange={async (e) => setLogin(await api.setLogin(e.target.checked))}
            />
            Mac açılınca uygulamayı arka planda başlat (atamalar her açılışta ve klavye takılınca yeniden uygulanır)
          </label>
        </section>
        <section className="card side-card actions">
          <h3>Yeni işlev</h3>
          <input className="search" placeholder="Ara (ör. ses, F13, tık)…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="alist">
            {Object.entries(groups).map(([g, list]) => (
              <div key={g}>
                <div className="agroup">{g}</div>
                {!list.length && g === 'Makrolar' && <div className="hint">Henüz makro yok; Makro sekmesinde oluşturun.</div>}
                <div className="achips">
                  {list.map((a) => (
                    <button
                      key={a.id}
                      className={'chip' + (cur && cur.id === a.id ? ' on' : '')}
                      disabled={sel == null}
                      onClick={() => assign(a.id)}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

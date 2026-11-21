import { useEffect, useMemo, useState } from 'react';
import layout from './data/layout.json';
import KeyboardView from './KeyboardView.jsx';
import { ACTIONS, FN_LED, resolveAction, isHostAction, MACRO_PREFIX, layerActionOk, srcUsage, vimPreset } from './keymap.js';
import { applyAll, lsLoad, LS_LAYER, LS_LAYER_SENT, LS_REMAP_SENT } from './apply.js';

const api = window.kb;
const KEY_BY_LED = Object.fromEntries(layout.keys.filter((k) => k.x2 > k.x1).map((k) => [k.led, k]));
const CAPS_LED = layout.keys.find((k) => srcUsage(k) === 0x700000039)?.led;
const MODS = [
  { bit: 0x08, sym: '⌘', label: 'Komut' },
  { bit: 0x04, sym: '⌥', label: 'Seçenek' },
  { bit: 0x01, sym: '⌃', label: 'Kontrol' },
  { bit: 0x02, sym: '⇧', label: 'Shift' },
];
const modText = (m) => MODS.filter((x) => m & x.bit).map((x) => x.sym).join('');
const isKeyAction = (a) => a && a.usage != null && Math.floor(a.usage / 2 ** 32) === 7;
const TAP_ACTIONS = ACTIONS.filter((a) => isKeyAction(a) && a.id !== 'off');

export default function Layer({ say }) {
  const [layer, setLayer] = useState(() => lsLoad(LS_LAYER, null) || { key: null, tap: null, map: {} });
  const [sentJson, setSentJson] = useState(() => JSON.stringify(lsLoad(LS_LAYER_SENT, null) || { key: null, tap: null, map: {} }));
  const [sel, setSel] = useState(null);
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [macros, setMacros] = useState([]);
  const [trusted, setTrusted] = useState(null);
  const baseRemap = useMemo(() => lsLoad(LS_REMAP_SENT, {}), []);

  useEffect(() => {
    api.getMacros().then((m) => setMacros(m || []));
    api.macroState().then((s) => setTrusted(s.trusted));
    api.macroTrust(false);
    return api.onMacroState((s) => setTrusted(s.trusted));
  }, []);

  const macroActions = useMemo(
    () => macros.map((m) => ({ id: MACRO_PREFIX + m.id, label: '⚡ ' + m.name, group: 'Makrolar' })),
    [macros],
  );
  const resolve = (id) => (id?.startsWith(MACRO_PREFIX) ? macroActions.find((a) => a.id === id) : resolveAction(id));

  const save = (l) => {
    setLayer(l);
    localStorage.setItem(LS_LAYER, JSON.stringify(l));
  };
  const dirty = JSON.stringify(layer) !== sentJson;

  const setKey = (led) => {
    const k = KEY_BY_LED[led];
    if (!k || srcUsage(k) == null) return say('Bu tuş katman tuşu olamaz.', true);
    const map = { ...layer.map };
    delete map[led];
    const tap = led === CAPS_LED ? 'k29' : srcUsage(k) < 0x7000000e0 ? 'k' + (srcUsage(k) - 0x700000000).toString(16) : null;
    save({ ...layer, key: led, tap, map });
    setPicking(false);
    setSel(null);
  };

  const onKey = (k) => {
    if (k.led === FN_LED) return say('Klavyenin Fn tuşu kullanılamaz (Mac\'e kod göndermiyor).', true);
    if (picking) return setKey(k.led);
    if (layer.key == null) return say('Önce katman tuşunu seçin.', true);
    if (k.led === layer.key) return say('Bu, katman tuşunun kendisi.', true);
    if (isHostAction(baseRemap[k.led])) return say('Bu tuşa Tuş Atama\'da makro / fare atanmış; katmanda kullanılamaz.', true);
    setSel(k.led);
  };

  const assign = (id) => {
    if (sel == null) return say('Önce klavyeden bir tuş seçin.', true);
    const map = { ...layer.map };
    if (id) map[sel] = { id, mods: map[sel]?.id === id ? map[sel].mods || 0 : 0 };
    else delete map[sel];
    save({ ...layer, map });
  };
  const toggleMod = (bit) => {
    const cur = layer.map[sel];
    if (!cur) return;
    save({ ...layer, map: { ...layer.map, [sel]: { ...cur, mods: (cur.mods || 0) ^ bit } } });
  };

  const send = async (l = layer) => {
    setBusy(true);
    const res = await applyAll({ layer: l.key == null ? null : l });
    setBusy(false);
    if (!res.ok) return say('Uygulanamadı: ' + res.error, true);
    setSentJson(JSON.stringify(l));
    say(l.key == null ? 'Fn katmanı kapatıldı.' : `Fn katmanı uygulandı (${Object.keys(l.map).length} tuş).`);
  };

  const labels = useMemo(() => {
    const out = {};
    if (layer.key != null) out[layer.key] = 'KATMAN';
    for (const [led, v] of Object.entries(layer.map || {})) {
      const a = resolve(v.id);
      if (a) out[led] = modText(v.mods || 0) + a.label;
    }
    return out;
  }, [layer, macroActions]);

  const groups = useMemo(() => {
    const f = q.trim().toLocaleLowerCase('tr');
    const g = {};
    for (const a of [...macroActions, ...ACTIONS]) {
      if (!layerActionOk(a)) continue;
      if (f && !a.label.toLocaleLowerCase('tr').includes(f) && !a.group.toLocaleLowerCase('tr').includes(f)) continue;
      (g[a.group] ||= []).push(a);
    }
    return g;
  }, [q, macroActions]);

  const lk = layer.key != null ? KEY_BY_LED[layer.key] : null;
  const selKey = sel != null ? KEY_BY_LED[sel] : null;
  const cur = sel != null ? layer.map[sel] : null;
  const curA = cur ? resolve(cur.id) : null;

  return (
    <div className="panel">
      {trusted === false && (
        <section className="card warn">
          <h3>Erişilebilirlik izni gerekli</h3>
          <p className="hint">Fn katmanı tuş olaylarını çevirir; Erişilebilirlik'te "KB923L Pro" açık olmalı.</p>
          <div className="row">
            <button className="primary" onClick={() => (api.macroTrust(true), api.openAccessibility())}>
              İzin iste
            </button>
            <button onClick={() => api.macroTrust(false)}>Yeniden denetle</button>
          </div>
        </section>
      )}
      <div className="preview">
        <KeyboardView
          interactive
          selected={picking ? null : sel != null ? new Set([sel]) : null}
          labels={labels}
          locked={new Set([FN_LED])}
          onKeyDown={onKey}
        />
      </div>
      <div className="cols">
        <section className="card grow">
          {picking ? (
            <>
              <h3>Katman tuşunu seçin</h3>
              <p className="hint">Klavye görselinde katman tuşu olacak tuşa tıklayın.</p>
              <div className="row">
                {CAPS_LED != null && <button onClick={() => setKey(CAPS_LED)}>Caps Lock'u kullan</button>}
                <button onClick={() => setPicking(false)}>Vazgeç</button>
              </div>
            </>
          ) : !lk ? (
            <>
              <h3>Fn katmanı</h3>
              <p className="hint">
                Klavyenin kendi Fn tuşu klavyenin içinde işlenir ve Mac'e bir kod göndermez; Fn ile gelen işlevler (Fn+F1 medya,
                ışık ayarları…) olduğu gibi kalır. Kendi katmanınız için bir <b>katman tuşu</b> seçin (ör. Caps Lock): o tuş
                basılıyken atadığınız tuşlar başka iş görür (H J K L → oklar gibi), tek başına kısa basınca seçtiğiniz tuş
                gider (Caps Lock için Esc).
              </p>
              <div className="row">
                {CAPS_LED != null && (
                  <button className="primary" onClick={() => setKey(CAPS_LED)}>
                    Caps Lock'u kullan
                  </button>
                )}
                <button onClick={() => setPicking(true)}>Başka tuş seç</button>
              </div>
            </>
          ) : (
            <>
              <h3>
                Katman tuşu: <span className="tag on">{lk.name}</span>{' '}
                <button className="chip" onClick={() => setPicking(true)}>
                  değiştir
                </button>
              </h3>
              <div className="row tools">
                <span className="hint" style={{ margin: 0 }}>
                  Tek başına kısa basınca:
                </span>
                <select value={layer.tap || ''} onChange={(e) => save({ ...layer, tap: e.target.value || null })}>
                  <option value="">Hiçbir şey</option>
                  {TAP_ACTIONS.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </div>
              {selKey ? (
                <>
                  <h4>
                    Katman + {selKey.name} → {curA ? modText(cur.mods || 0) + curA.label : 'atanmadı'}
                  </h4>
                  <div className="row tools">
                    {MODS.map((m) => (
                      <label key={m.bit} className="check inline">
                        <input
                          type="checkbox"
                          disabled={!isKeyAction(curA)}
                          checked={!!(cur && cur.mods & m.bit)}
                          onChange={() => toggleMod(m.bit)}
                        />
                        {m.sym} {m.label}
                      </label>
                    ))}
                    <button onClick={() => assign(null)} disabled={!cur}>
                      Kaldır
                    </button>
                  </div>
                  <p className="hint">
                    Sağdan işlev seçin. Tuş işlevlerine ⌘ ⌥ ⌃ ⇧ eklenebilir (ör. Katman+H → ⌘←). Katman basılıyken elle
                    tuttuğunuz değiştiriciler de eklenir (⇧ ile seçerek ilerleme gibi).
                  </p>
                </>
              ) : (
                <p className="hint">
                  Katmanda değiştirmek istediğiniz tuşa klavye görselinde tıklayın. Atanmamış tuşlar katman basılıyken de
                  normal çalışır.
                </p>
              )}
            </>
          )}
          <div className="row bottom">
            <button className="primary" disabled={busy || !dirty} onClick={() => send()}>
              {busy ? 'Uygulanıyor…' : dirty ? 'Uygula' : 'Uygulandı'}
            </button>
            <button
              disabled={!lk}
              onClick={() => {
                save({ ...layer, map: { ...layer.map, ...vimPreset(layout.keys) } });
                say('H J K L oklar, U/O Home/End, Y/P Page Up/Down eklendi; etkinleştirmek için "Uygula".');
              }}
            >
              Hazır: H J K L oklar
            </button>
            <button
              disabled={busy || !lk}
              onClick={() => {
                if (!window.confirm('Fn katmanı kapatılsın mı? (katman tuşu eski işlevine döner)')) return;
                const l = { key: null, tap: null, map: {} };
                save(l);
                setSel(null);
                send(l);
              }}
            >
              Katmanı kapat
            </button>
          </div>
        </section>
        <section className="card side-card actions">
          <h3>Katmanda işlev</h3>
          <input className="search" placeholder="Ara (ör. sol, ses, tık)…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="alist">
            {Object.entries(groups).map(([g, list]) => (
              <div key={g}>
                <div className="agroup">{g}</div>
                <div className="achips">
                  {list.map((a) => (
                    <button
                      key={a.id}
                      className={'chip' + (cur && cur.id === a.id ? ' on' : '')}
                      disabled={sel == null || picking}
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

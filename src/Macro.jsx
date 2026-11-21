import { useEffect, useMemo, useRef, useState } from 'react';
import layout from './data/layout.json';
import { ACTIONS, usageLabel, buildPairs, buildBinds } from './keymap.js';

const api = window.kb;

const MODES = [
  { id: 'once', label: 'Bir kez', hint: 'Tuşa her basışta makro baştan sona (tekrar sayısı kadar) oynar.' },
  { id: 'hold', label: 'Basılı tuttukça', hint: 'Tuş basılı kaldıkça makro tekrar eder; bırakınca durur.' },
  { id: 'toggle', label: 'Aç / kapa', hint: 'Bir basış tekrarı başlatır, ikinci basış durdurur.' },
];
const MOUSE = { left: 'Sol tık', right: 'Sağ tık', middle: 'Orta tık' };
const KEY_ACTIONS = ACTIONS.filter((a) => a.usage != null && Math.floor(a.usage / 2 ** 32) === 7 && a.id !== 'off');

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const round10 = (ms) => Math.max(10, Math.round(ms / 10) * 10);

function stepText(s) {
  if (s.u != null) return `${usageLabel(s.u)} ${s.d ? '↓' : '↑'}`;
  if (s.m) return `${MOUSE[s.m] || s.m} ${s.d ? '↓' : '↑'}`;
  if (s.t != null) return `Metin: “${s.t}”`;
  return null;
}

export default function Macro({ say }) {
  const [macros, setMacros] = useState([]);
  const [selId, setSelId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [state, setState] = useState({ trusted: null, recording: false, playing: null });
  const [keepDelays, setKeepDelays] = useState(true);
  const [addKey, setAddKey] = useState('');
  const [text, setText] = useState('');
  const lastT = useRef(null);
  const testRef = useRef(null);

  useEffect(() => {
    api.getMacros().then((list) => {
      setMacros(list || []);
      if (list && list.length) {
        setSelId(list[0].id);
        setDraft(structuredClone(list[0]));
      }
    });
    api.macroState().then(setState);
    api.macroTrust(false);
    const off = api.onMacroState(setState);
    return () => {
      off();
      api.macroRecord(false);
    };
  }, []);

  // Kayıt: klavyeden gelen basma / bırakmalar adımlara eklenir.
  useEffect(() => {
    if (!state.recording) return;
    return api.onMacroKey((k) => {
      const w = keepDelays && lastT.current != null ? round10(k.t - lastT.current) : 20;
      lastT.current = k.t;
      setDraft((d) => (d ? { ...d, steps: [...d.steps, ...(d.steps.length ? [{ w }] : []), { u: k.u, d: k.d }] } : d));
    });
  }, [state.recording, keepDelays]);

  const dirty = useMemo(() => {
    if (!draft) return false;
    const m = macros.find((x) => x.id === draft.id);
    return !m || JSON.stringify(m) !== JSON.stringify(draft);
  }, [draft, macros]);

  const persist = async (list) => {
    setMacros(list);
    await api.setMacros(list);
  };

  const select = (m) => {
    if (dirty && !window.confirm('Kaydedilmemiş değişiklikler kaybolsun mu?')) return;
    if (state.recording) api.macroRecord(false);
    setSelId(m.id);
    setDraft(structuredClone(m));
  };

  const create = () => {
    if (dirty && !window.confirm('Kaydedilmemiş değişiklikler kaybolsun mu?')) return;
    const m = { id: newId(), name: 'Makro ' + (macros.length + 1), mode: 'once', times: 1, steps: [] };
    setSelId(m.id);
    setDraft(m);
  };

  const saveDraft = async () => {
    if (state.recording) await api.macroRecord(false);
    const list = macros.some((x) => x.id === draft.id)
      ? macros.map((x) => (x.id === draft.id ? draft : x))
      : [...macros, draft];
    await persist(list);
    say('Makro kaydedildi. Bir tuşa bağlamak için: Tuş Atama → tuşu seçin → Makrolar.');
  };

  const remove = async () => {
    if (!window.confirm(`"${draft.name}" silinsin mi? Bağlı olduğu tuş varsayılana döner.`)) return;
    const list = macros.filter((x) => x.id !== draft.id);
    await persist(list);
    // Bağlı olduğu tuşları varsayılana döndür ve atamaları yeniden uygula
    let freed = 0;
    for (const key of ['kb923l.remap', 'kb923l.remapApplied']) {
      try {
        const r = JSON.parse(localStorage.getItem(key)) || {};
        for (const k of Object.keys(r)) if (r[k] === 'macro:' + draft.id) delete r[k], freed++;
        localStorage.setItem(key, JSON.stringify(r));
        if (key === 'kb923l.remapApplied' && freed)
          await api.applyRemap({ pairs: buildPairs(layout.keys, r), binds: buildBinds(layout.keys, r) });
      } catch {}
    }
    setSelId(list[0]?.id ?? null);
    setDraft(list[0] ? structuredClone(list[0]) : null);
    say('Makro silindi.');
  };

  const toggleRecord = async () => {
    if (state.recording) return api.macroRecord(false);
    document.activeElement?.blur();
    lastT.current = null;
    await api.macroRecord(true);
  };

  const patch = (p) => setDraft((d) => ({ ...d, ...p }));
  const setSteps = (fn) => setDraft((d) => ({ ...d, steps: fn(d.steps) }));
  const push = (...items) =>
    setSteps((st) => {
      const out = [...st];
      for (const it of items) {
        if (out.length && it.w == null && out[out.length - 1].w == null) out.push({ w: 20 });
        out.push(it);
      }
      return out;
    });

  const test = async () => {
    if (dirty) await saveDraft();
    testRef.current?.focus();
    setTimeout(() => api.macroPlay(draft.id), 300);
  };

  const mode = draft ? MODES.find((m) => m.id === (draft.mode || 'once')) : null;

  return (
    <div className="panel">
      {state.trusted === false && (
        <section className="card warn">
          <h3>Erişilebilirlik izni gerekli</h3>
          <p className="hint">
            Makroların tuş ve fare olayı gönderebilmesi için Sistem Ayarları → Gizlilik ve Güvenlik → Erişilebilirlik'te
            "KB923L Pro"yu açın. Listede yoksa "İzin iste"ye basın; izin verdikten sonra "Yeniden denetle".
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
        <section className="card side-card mside">
          <h3>Makrolar</h3>
          <div className="mlist">
            {macros.map((m) => (
              <button key={m.id} className={'mitem' + (selId === m.id ? ' on' : '')} onClick={() => select(m)}>
                <span>{m.name}</span>
                <small>{m.steps.filter((s) => s.w == null).length} adım</small>
              </button>
            ))}
            {draft && !macros.some((m) => m.id === draft.id) && (
              <button className="mitem on">
                <span>{draft.name}</span>
                <small>kaydedilmedi</small>
              </button>
            )}
          </div>
          <button className="wide" style={{ marginTop: 0 }} onClick={create}>
            + Yeni makro
          </button>
          <p className="hint">
            Makrolar Mac'te çalışır: uygulama açık olmalı (menü çubuğunda durması yeterli). Bir tuşa bağlamak için Tuş
            Atama sekmesinde tuşu seçip "Makrolar" grubundan seçin.
          </p>
        </section>

        {!draft ? (
          <section className="card grow">
            <p className="hint">Soldan bir makro seçin ya da yeni makro oluşturun.</p>
          </section>
        ) : (
          <section className="card grow">
            <div className="row">
              <input className="name" value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
            </div>

            <h4>Çalışma biçimi</h4>
            <div className="seg">
              {MODES.map((m) => (
                <button key={m.id} className={mode.id === m.id ? 'on' : ''} onClick={() => patch({ mode: m.id })}>
                  {m.label}
                </button>
              ))}
            </div>
            <p className="hint">
              {mode.hint}
              {mode.id === 'once' && (
                <>
                  {' '}
                  Tekrar:{' '}
                  <input
                    type="number"
                    className="num"
                    min={1}
                    max={99}
                    value={draft.times || 1}
                    onChange={(e) => patch({ times: Math.max(1, Math.min(99, +e.target.value || 1)) })}
                  />
                </>
              )}
            </p>

            <h4>Adımlar</h4>
            <div className="row tools">
              <button className={state.recording ? 'primary rec' : ''} onClick={toggleRecord}>
                {state.recording ? '■ Kaydı durdur' : '● Klavyeden kaydet'}
              </button>
              <label className="check inline">
                <input type="checkbox" checked={keepDelays} onChange={(e) => setKeepDelays(e.target.checked)} />
                Gecikmeleri kaydet
              </label>
              <button onClick={() => setSteps(() => [])} disabled={!draft.steps.length}>
                Adımları temizle
              </button>
            </div>
            {state.recording && (
              <p className="hint">
                Kayıt sürüyor: KB923L Pro'da basılan tuşlar sırayla ekleniyor (basılan tuşlar Mac'e de gider; bu pencere
                önde kalsın). Bitince "Kaydı durdur".
              </p>
            )}

            <div className="steps">
              {draft.steps.length === 0 && <div className="hint">Henüz adım yok.</div>}
              {draft.steps.map((s, i) =>
                s.w != null ? (
                  <div key={i} className="step wait">
                    ⏱
                    <input
                      type="number"
                      className="num"
                      min={0}
                      max={60000}
                      step={10}
                      value={s.w}
                      onChange={(e) =>
                        setSteps((st) => st.map((x, j) => (j === i ? { w: Math.max(0, Math.min(60000, +e.target.value || 0)) } : x)))
                      }
                    />
                    ms
                    <button className="x" onClick={() => setSteps((st) => st.filter((_, j) => j !== i))}>
                      ×
                    </button>
                  </div>
                ) : (
                  <div key={i} className={'step' + (s.d === false || s.d === 0 ? ' up' : '')}>
                    {stepText(s)}
                    <button className="x" onClick={() => setSteps((st) => st.filter((_, j) => j !== i))}>
                      ×
                    </button>
                  </div>
                ),
              )}
            </div>

            <h4>Elle ekle</h4>
            <div className="row">
              <select value={addKey} onChange={(e) => setAddKey(e.target.value)}>
                <option value="">Tuş seçin…</option>
                {KEY_ACTIONS.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.group} — {a.label}
                  </option>
                ))}
              </select>
              <button
                disabled={!addKey}
                onClick={() => {
                  const a = KEY_ACTIONS.find((x) => x.id === addKey);
                  const u = a.usage - 0x700000000;
                  push({ u, d: true }, { u, d: false });
                }}
              >
                Bas-bırak
              </button>
              <button
                disabled={!addKey}
                onClick={() => push({ u: KEY_ACTIONS.find((x) => x.id === addKey).usage - 0x700000000, d: true })}
              >
                Bas
              </button>
              <button
                disabled={!addKey}
                onClick={() => push({ u: KEY_ACTIONS.find((x) => x.id === addKey).usage - 0x700000000, d: false })}
              >
                Bırak
              </button>
            </div>
            <div className="row">
              <input className="grow" placeholder="Yazılacak metin (Türkçe karakter olur)" value={text} onChange={(e) => setText(e.target.value)} />
              <button
                disabled={!text}
                onClick={() => {
                  push({ t: text });
                  setText('');
                }}
              >
                Metin ekle
              </button>
            </div>
            <div className="row">
              <button onClick={() => setSteps((st) => [...st, { w: 100 }])}>Bekleme ekle</button>
              {Object.entries(MOUSE).map(([b, l]) => (
                <button key={b} onClick={() => push({ m: b, d: true }, { m: b, d: false })}>
                  {l}
                </button>
              ))}
            </div>

            <div className="row bottom">
              <button className="primary" disabled={!dirty} onClick={saveDraft}>
                {dirty ? 'Kaydet' : 'Kaydedildi'}
              </button>
              {state.playing === draft.id ? (
                <button onClick={() => api.macroStop()}>Durdur</button>
              ) : (
                <button disabled={!draft.steps.length || state.recording} onClick={test}>
                  Dene
                </button>
              )}
              <div className="grow" />
              <button onClick={remove}>Sil</button>
            </div>
            <textarea ref={testRef} className="testarea" placeholder="Deneme alanı: “Dene” makroyu buraya oynatır." />
          </section>
        )}
      </div>
    </div>
  );
}

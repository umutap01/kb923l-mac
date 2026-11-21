import { useEffect, useState } from 'react';

// Ses çıkışının kendi ses ayarı yoksa (HDMI / DisplayPort monitör) sesi yazılımla ayarlama (helper/softvol.swift)
const api = window.kb;

export default function SoftVol() {
  const [s, setS] = useState(null);
  useEffect(() => {
    api.getSoftvol().then(setS);
    return api.onSoftvol(setS);
  }, []);
  if (!s) return null;
  const set = async (p) => setS(await api.setSoftvol(p));
  const perm = s.error && /izin|-1|560947818|2003332927/i.test(s.error);

  return (
    <section className="card">
      <h3>Monitör sesi (HDMI / DisplayPort)</h3>
      <p className="hint">
        Mac'in sesi bir monitöre giderken macOS ses seviyesini ayarlayamaz; klavyenin ses düğmesi ve Mac'in ses tuşları
        etkisiz kalır. Bu seçenek açıkken uygulama sesi Windows'taki gibi yazılımla ayarlar. Çıkışın kendi ses ayarı varsa
        (MacBook hoparlörü, kulaklık) devreye girmez.
      </p>
      <label className="check">
        <input type="checkbox" checked={s.on} onChange={(e) => set({ on: e.target.checked })} />
        Gerektiğinde sesi yazılımla ayarla
      </label>
      {s.on && (
        <>
          <div className="sub">
            {s.error
              ? 'Çalışmıyor: ' + s.error
              : s.active
                ? `Devrede: ${s.device}`
                : `Devrede değil${s.device ? ` — ${s.device} kendi ses ayarını kullanıyor` : ''}`}
          </div>
          {s.active && (
            <div className="row tools" style={{ marginTop: 10 }}>
              <button className="chip" onClick={() => set({ muted: !s.muted })}>
                {s.muted ? '🔇 Sessiz' : '🔊'}
              </button>
              <input
                type="range"
                min={0}
                max={100}
                value={s.v}
                style={{ flex: 1 }}
                onChange={(e) => set({ v: +e.target.value, muted: false })}
              />
              <b style={{ width: 44, textAlign: 'right' }}>%{s.muted ? 0 : s.v}</b>
            </div>
          )}
          {perm && (
            <div className="row" style={{ marginTop: 10 }}>
              <button className="primary" onClick={() => api.openAudioPrivacy()}>
                Sistem Sesi Kaydı iznini aç
              </button>
              <button onClick={() => set({ on: true })}>Yeniden dene</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

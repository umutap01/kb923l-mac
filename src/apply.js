// Tuş atama + makro / fare bağları + Fn katmanı tek seferde uygulanır (hidutil tek bir eşleme listesi tutar).
import layout from './data/layout.json';
import { buildPairs, buildBinds, buildLayerCfg, LAYER_USAGE } from './keymap.js';

export const LS_REMAP = 'kb923l.remap';
export const LS_REMAP_SENT = 'kb923l.remapApplied';
export const LS_LAYER = 'kb923l.layer';
export const LS_LAYER_SENT = 'kb923l.layerApplied';

export function lsLoad(key, def) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? def;
  } catch {
    return def;
  }
}

// remap / layer verilmezse son uygulanan kullanılır
export async function applyAll({ remap, layer } = {}) {
  const r = remap ?? lsLoad(LS_REMAP_SENT, {});
  const l = layer !== undefined ? layer : lsLoad(LS_LAYER_SENT, null);
  const cfg = buildLayerCfg(layout.keys, r, l);
  let pairs = buildPairs(layout.keys, r);
  let binds = buildBinds(layout.keys, r);
  if (cfg) {
    pairs = pairs.filter((p) => p.src !== cfg.src).concat({ src: cfg.src, dst: LAYER_USAGE });
    binds = binds.filter((b) => b.src !== cfg.src);
  }
  const res = await window.kb.applyRemap({ pairs, binds, layer: cfg });
  if (res.ok) {
    localStorage.setItem(LS_REMAP_SENT, JSON.stringify(r));
    localStorage.setItem(LS_LAYER_SENT, JSON.stringify(l));
  }
  return res;
}

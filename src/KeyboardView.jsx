import layout from './data/layout.json';
import keyimg from './assets/keyimg.png';

const W = 870;
const H = 313;

// KB.ini UnRectKey: L biçimli Enter (LED 81) çokgeni
const UNRECT = { 81: [[570, 125], [570, 153], [580, 153], [580, 193], [615, 193], [615, 125]] };
const KEYS = layout.keys
  .filter((k) => k.x2 > k.x1)
  .map((k) => {
    const poly = UNRECT[k.led];
    if (!poly) return k;
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    const x1 = Math.min(...xs), x2 = Math.max(...xs), y1 = Math.min(...ys), y2 = Math.max(...ys);
    const clip = 'polygon(' + poly.map(([x, y]) => ((x - x1) / (x2 - x1)) * 100 + '% ' + ((y - y1) / (y2 - y1)) * 100 + '%').join(',') + ')';
    return { ...k, x1, x2, y1, y2, clip };
  });

const css = (c) => (c ? `rgb(${c[0]},${c[1]},${c[2]})` : 'transparent');

// KB.ini'deki koordinatlarla tuşları görselin üstüne yerleştirir.
export default function KeyboardView({ colors, selected, labels, locked, onKeyDown, onKeyEnter, interactive }) {
  return (
    <div className={'kbd' + (interactive ? ' interactive' : '')}>
      <img src={keyimg} alt="KB923L Pro" draggable={false} />
      {KEYS.map((k) => {
        const c = colors && colors[k.led];
        const sel = selected && selected.has(k.led);
        const lab = labels && labels[k.led];
        const lock = locked && locked.has(k.led);
        return (
          <div
            key={k.id}
            title={lab ? `${k.name} → ${lab}` : k.name}
            className={'key' + (sel ? ' sel' : '') + (c && (c[0] || c[1] || c[2]) ? ' lit' : '') + (lab ? ' mapped' : '') + (lock ? ' locked' : '')}
            style={{
              left: (k.x1 / W) * 100 + '%',
              top: (k.y1 / H) * 100 + '%',
              width: ((k.x2 - k.x1) / W) * 100 + '%',
              height: ((k.y2 - k.y1) / H) * 100 + '%',
              '--c': css(c),
              clipPath: k.clip,
            }}
            onMouseDown={(e) => interactive && onKeyDown && onKeyDown(k, e)}
            onMouseEnter={(e) => interactive && onKeyEnter && onKeyEnter(k, e)}
          >
            {lab && <span className="klabel">{lab}</span>}
          </div>
        );
      })}
    </div>
  );
}

export const ALL_LEDS = KEYS.map((k) => k.led);

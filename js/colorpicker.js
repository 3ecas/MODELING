// An inline colour picker in the After Effects style: a saturation/value square next to a hue strip.
// No pop-ups: it lives in the panel, updates live while dragging and reports a final value on release.

export function createColorPicker(root, { onInput, onChange }) {
  root.classList.add('cp');
  root.innerHTML = '<div class="cp-sv"><div class="cp-cursor"></div></div><div class="cp-hue"><div class="cp-hue-cursor"></div></div>';
  const sv = root.querySelector('.cp-sv');
  const cursor = root.querySelector('.cp-cursor');
  const hue = root.querySelector('.cp-hue');
  const hueCursor = root.querySelector('.cp-hue-cursor');

  let h = 30, s = 0.7, v = 0.9;
  let dragging = null;

  const hex = () => rgbToHex(hsvToRgb(h, s, v));

  function render() {
    sv.style.background = `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, hsl(${h}, 100%, 50%))`;
    cursor.style.left = `${s * 100}%`;
    cursor.style.top = `${(1 - v) * 100}%`;
    cursor.style.background = hex();
    hueCursor.style.top = `${(h / 360) * 100}%`;
  }

  const clamp01 = x => Math.max(0, Math.min(1, x));
  function pickSV(e) {
    const r = sv.getBoundingClientRect();
    s = clamp01((e.clientX - r.left) / r.width);
    v = 1 - clamp01((e.clientY - r.top) / r.height);
  }
  function pickHue(e) {
    const r = hue.getBoundingClientRect();
    h = Math.min(359.99, clamp01((e.clientY - r.top) / r.height) * 360);
  }

  function begin(el, fn) {
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      dragging = fn;
      el.setPointerCapture(e.pointerId);
      fn(e);
      render();
      onInput(hex());
    });
    el.addEventListener('pointermove', e => {
      if (dragging !== fn) return;
      fn(e);
      render();
      onInput(hex());
    });
    const end = e => {
      if (dragging !== fn) return;
      dragging = null;
      try { el.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      onChange(hex());
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
  begin(sv, pickSV);
  begin(hue, pickHue);

  render();
  return {
    /** Shows a colour. Keeps the current hue for greys and the saturation for black, so the cursors do not jump. */
    set(hexStr) {
      const rgb = hexToRgb(hexStr);
      if (!rgb) return;
      const [nh, ns, nv] = rgbToHsv(rgb);
      if (nv > 0.0001 && ns > 0.0001) h = nh;
      if (nv > 0.0001) s = ns;
      v = nv;
      render();
    },
    get: hex,
    get dragging() { return dragging !== null; },
  };
}

// ----- conversions -----

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map(c => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('');
}

export function rgbToHsv([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

export function hsvToRgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

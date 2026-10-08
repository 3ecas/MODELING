// DOM wiring: toolbar, outliner, properties panel, palette, status bar.

import { PART_TYPES, PALETTE } from './parts.js';

const $ = id => document.getElementById(id);
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

export function initUI(app) {
  const { model, history, viewport } = app;

  // ----- toolbar -----
  document.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => app.addPart(b.dataset.add)));
  document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => app.setMode(b.dataset.mode)));
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => viewport.setView(b.dataset.view)));

  $('btn-new').addEventListener('click', () => app.newModel());
  $('btn-open').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) await app.openFile(file);
  });
  $('btn-save').addEventListener('click', () => app.save());
  $('btn-export-glb').addEventListener('click', () => app.exportGLB());
  $('btn-export-obj').addEventListener('click', () => app.exportOBJ());
  $('btn-humanoid').addEventListener('click', () => app.addHumanoid());
  $('btn-random').addEventListener('click', () => app.addRandomNPC());
  $('btn-undo').addEventListener('click', () => app.undo());
  $('btn-redo').addEventListener('click', () => app.redo());

  $('chk-snap').addEventListener('change', e => viewport.setSnap(e.target.checked));
  $('chk-pixel').addEventListener('change', e => viewport.setPixel(e.target.checked));
  $('chk-wire').addEventListener('change', e => model.setWireframe(e.target.checked));
  $('chk-grid').addEventListener('change', e => viewport.setGrid(e.target.checked));

  $('m-name').addEventListener('change', e => { model.name = e.target.value.trim() || 'untitled'; app.commit(); });

  // ----- properties -----
  const form = $('props');
  const fields = {
    position: ['p-px', 'p-py', 'p-pz'],
    rotation: ['p-rx', 'p-ry', 'p-rz'],
    size: ['p-sx', 'p-sy', 'p-sz'],
    offset: ['p-ox', 'p-oy', 'p-oz'],
  };

  for (const [key, ids] of Object.entries(fields)) {
    ids.forEach(id => $(id).addEventListener('change', () => {
      const p = app.selected(); if (!p) return;
      model.update(p.id, { [key]: ids.map(i => num($(i).value)) });
      app.commit();
    }));
  }

  $('p-name').addEventListener('change', e => {
    const p = app.selected(); if (!p) return;
    model.update(p.id, { name: e.target.value.trim() || p.name });
    app.commit();
  });
  $('p-sides').addEventListener('change', e => {
    const p = app.selected(); if (!p) return;
    model.update(p.id, { sides: num(e.target.value) });
    app.commit();
  });
  $('p-visible').addEventListener('change', e => {
    const p = app.selected(); if (!p) return;
    model.update(p.id, { visible: e.target.checked });
    app.commit();
  });
  $('p-parent').addEventListener('change', e => {
    const p = app.selected(); if (!p) return;
    const v = e.target.value === '' ? null : Number(e.target.value);
    if (!model.setParent(p.id, v)) refreshProps();
    app.commit();
  });

  $('p-color').addEventListener('input', e => {
    const p = app.selected(); if (!p) return;
    model.update(p.id, { color: e.target.value });
    $('p-color-hex').value = e.target.value;
  });
  $('p-color').addEventListener('change', () => app.commit());
  $('p-color-hex').addEventListener('change', e => {
    const p = app.selected(); if (!p) return;
    let v = e.target.value.trim();
    if (/^[0-9a-f]{6}$/i.test(v)) v = '#' + v;
    if (!/^#[0-9a-f]{6}$/i.test(v)) { e.target.value = p.color; return; }
    model.update(p.id, { color: v.toLowerCase() });
    app.commit();
  });

  const palette = $('palette');
  PALETTE.forEach(c => {
    const sw = document.createElement('div');
    sw.className = 'sw';
    sw.style.background = c;
    sw.title = c;
    sw.addEventListener('click', () => {
      const p = app.selected(); if (!p) return;
      model.update(p.id, { color: c });
      app.commit();
    });
    palette.appendChild(sw);
  });

  $('btn-duplicate').addEventListener('click', () => app.duplicate());
  $('btn-mirror').addEventListener('click', () => app.duplicate({ mirrorX: true }));
  $('btn-delete').addEventListener('click', () => app.deleteSelected());
  form.addEventListener('submit', e => e.preventDefault());

  // ----- refreshers -----

  function refreshProps() {
    const p = app.selected();
    $('props-empty').hidden = !!p;
    form.hidden = !p;
    if (!p) return;
    if (document.activeElement && form.contains(document.activeElement)) return; // don't clobber typing
    $('p-name').value = p.name;
    $('p-type').textContent = PART_TYPES[p.type].label;
    for (const [key, ids] of Object.entries(fields)) ids.forEach((id, i) => { $(id).value = p[key][i]; });
    $('row-sides').hidden = !PART_TYPES[p.type].hasSides;
    $('p-sides').value = p.sides || '';
    $('p-color').value = p.color;
    $('p-color-hex').value = p.color;
    $('p-visible').checked = p.visible;

    const sel = $('p-parent');
    sel.innerHTML = '';
    sel.appendChild(new Option('(none)', ''));
    for (const { part, depth } of model.ordered()) {
      if (part.id === p.id || model.isDescendant(part.id, p.id)) continue;
      sel.appendChild(new Option(`${'  '.repeat(depth)}${part.name}`, String(part.id)));
    }
    sel.value = p.parent == null ? '' : String(p.parent);
  }

  function refreshOutliner() {
    const list = $('part-list');
    list.innerHTML = '';
    const sel = app.selected();
    for (const { part, depth } of model.ordered()) {
      const li = document.createElement('li');
      li.style.paddingLeft = `${6 + depth * 14}px`;
      if (sel && sel.id === part.id) li.classList.add('selected');
      if (!part.visible) li.classList.add('hidden');
      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.background = part.color;
      const name = document.createElement('span');
      name.textContent = part.name;
      const type = document.createElement('span');
      type.className = 'type';
      type.textContent = PART_TYPES[part.type].label.toLowerCase();
      li.append(sw, name, type);
      li.addEventListener('click', () => app.select(part.id));
      li.addEventListener('dblclick', () => { app.select(part.id); viewport.focus(); });
      list.appendChild(li);
    }
    $('part-count').textContent = model.parts.size ? `(${model.parts.size})` : '';
  }

  function refreshToolbar() {
    document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === viewport.mode));
    $('btn-undo').disabled = !history.canUndo;
    $('btn-redo').disabled = !history.canRedo;
    $('m-name').value = model.name;
  }

  function refreshStatus() {
    const p = app.selected();
    const tris = Math.round(viewport.triangleCount());
    const sel = p ? `${p.name}  ·  ${PART_TYPES[p.type].label}  ·  ` : '';
    $('status').textContent = `${sel}${model.parts.size} parts  ·  ${tris} triangles`;
  }

  function refreshAll() { refreshOutliner(); refreshProps(); refreshToolbar(); refreshStatus(); }

  model.onChange(kind => {
    if (kind === 'update') { refreshProps(); refreshStatus(); const sel = app.selected(); if (sel) updateOutlinerRow(sel); }
    else refreshAll();
  });
  history.onChange(refreshToolbar);

  function updateOutlinerRow(part) {
    // Cheap refresh of name/colour/visibility for the selected row.
    const rows = [...$('part-list').children];
    const ordered = model.ordered();
    const idx = ordered.findIndex(o => o.part.id === part.id);
    const li = rows[idx];
    if (!li) return refreshOutliner();
    li.children[0].style.background = part.color;
    li.children[1].textContent = part.name;
    li.classList.toggle('hidden', !part.visible);
  }

  return { refreshAll, refreshProps, refreshOutliner, refreshToolbar, refreshStatus };
}

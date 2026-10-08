// DOM wiring: toolbar, outliner, properties panel (with sliders), palette, status bar.

import { PART_TYPES, PALETTE, isBone } from './parts.js';

const $ = id => document.getElementById(id);
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

export function initUI(app) {
  const { model, history, viewport, animator } = app;

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
  const menu = $('export-menu');
  const menuList = menu.querySelector('.menu-list');
  $('btn-export').addEventListener('click', e => { e.stopPropagation(); menuList.hidden = !menuList.hidden; });
  menuList.querySelectorAll('[data-export]').forEach(b => b.addEventListener('click', () => { menuList.hidden = true; app.export(b.dataset.export); }));
  document.addEventListener('click', e => { if (!menu.contains(e.target)) menuList.hidden = true; });
  $('btn-humanoid').addEventListener('click', () => app.addHumanoid());
  $('btn-random').addEventListener('click', () => app.addRandomNPC());
  $('btn-undo').addEventListener('click', () => app.undo());
  $('btn-redo').addEventListener('click', () => app.redo());

  $('chk-snap').addEventListener('change', e => viewport.setSnap(e.target.checked));
  $('chk-pixel').addEventListener('change', e => viewport.setPixel(e.target.checked));
  $('chk-wire').addEventListener('change', e => model.setWireframe(e.target.checked));
  $('chk-grid').addEventListener('change', e => viewport.setGrid(e.target.checked));
  $('chk-bones').addEventListener('change', e => viewport.setBones(e.target.checked));

  $('m-name').addEventListener('change', e => { model.name = e.target.value.trim() || 'untitled'; app.commit(); });

  // Buttons and checkboxes give focus back after a click, so keyboard shortcuts keep reaching the app.
  document.addEventListener('click', e => {
    const t = e.target.closest('button, input[type="checkbox"]');
    if (t) t.blur();
  });

  // ----- properties -----
  const form = $('props');
  const transformFields = {
    position: ['p-px', 'p-py', 'p-pz'],
    rotation: ['p-rx', 'p-ry', 'p-rz'],
    size: ['p-sx', 'p-sy', 'p-sz'],
  };
  const offsetFields = ['p-ox', 'p-oy', 'p-oz'];
  const rotSliders = ['p-rsx', 'p-rsy', 'p-rsz'];

  for (const [key, ids] of Object.entries(transformFields)) {
    ids.forEach(id => $(id).addEventListener('change', () => {
      const p = app.selected(); if (!p) return;
      app.setTransform(p, { [key]: ids.map(i => num($(i).value)) });
    }));
  }
  offsetFields.forEach(id => $(id).addEventListener('change', () => {
    const p = app.selected(); if (!p) return;
    model.update(p.id, { offset: offsetFields.map(i => num($(i).value)) });
    app.commit();
  }));

  // Rotation sliders: live while dragging, one undo step on release.
  rotSliders.forEach((id, axis) => {
    const slider = $(id);
    slider.addEventListener('input', () => {
      const p = app.selected(); if (!p) return;
      const rot = app.poseOf(p).rotation;
      rot[axis] = num(slider.value);
      $(transformFields.rotation[axis]).value = rot[axis];
      app.setTransform(p, { rotation: rot }, { commit: false });
    });
    slider.addEventListener('change', () => app.commit());
  });

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
  $('p-sides-range').addEventListener('input', e => {
    const p = app.selected(); if (!p) return;
    model.update(p.id, { sides: num(e.target.value) });
    $('p-sides').value = p.sides;
  });
  $('p-sides-range').addEventListener('change', () => app.commit());
  // Visibility, parent and colour apply to every selected part.
  $('p-visible').addEventListener('change', e => {
    if (!app.selected()) return;
    for (const p of app.selectedParts()) model.update(p.id, { visible: e.target.checked });
    app.commit();
  });
  $('p-parent').addEventListener('change', e => {
    if (!app.selected()) return;
    const v = e.target.value === '' ? null : Number(e.target.value);
    let ok = true;
    for (const p of app.selectedParts()) if (!model.setParent(p.id, v)) ok = false;
    if (!ok) refreshProps();
    app.commit();
  });

  $('p-color').addEventListener('input', e => {
    if (!app.selected()) return;
    for (const p of app.selectedParts()) model.update(p.id, { color: e.target.value });
    $('p-color-hex').value = e.target.value;
  });
  $('p-color').addEventListener('change', () => app.commit());
  $('p-color-hex').addEventListener('change', e => {
    const p = app.selected(); if (!p) return;
    let v = e.target.value.trim();
    if (/^[0-9a-f]{6}$/i.test(v)) v = '#' + v;
    if (!/^#[0-9a-f]{6}$/i.test(v)) { e.target.value = p.color; return; }
    for (const q of app.selectedParts()) model.update(q.id, { color: v.toLowerCase() });
    app.commit();
  });

  const palette = $('palette');
  PALETTE.forEach(c => {
    const sw = document.createElement('div');
    sw.className = 'sw';
    sw.style.background = c;
    sw.title = c;
    sw.addEventListener('click', () => {
      if (!app.selected()) return;
      for (const p of app.selectedParts()) model.update(p.id, { color: c });
      app.commit();
    });
    palette.appendChild(sw);
  });

  $('btn-duplicate').addEventListener('click', () => app.duplicate());
  $('btn-mirror').addEventListener('click', () => app.duplicate({ mirrorX: true }));
  $('btn-delete').addEventListener('click', () => app.deleteSelected());
  $('btn-select-children').addEventListener('click', () => app.selectChildren());
  form.addEventListener('submit', e => e.preventDefault());

  // ----- refreshers -----

  function formBusy() {
    const a = document.activeElement;
    return a && form.contains(a) && a.tagName !== 'BUTTON';
  }

  /** Updates only position / rotation / size fields from the current pose (cheap, used during playback). */
  function refreshPose() {
    const p = app.selected();
    if (!p || form.hidden || formBusy()) return;
    const pose = app.poseOf(p);
    for (const [key, ids] of Object.entries(transformFields)) ids.forEach((id, i) => { $(id).value = round3(pose[key][i]); });
    rotSliders.forEach((id, i) => { $(id).value = Math.round(pose.rotation[i]); });
  }

  function refreshProps() {
    const p = app.selected();
    const count = app.selectedIds().length;
    $('props-empty').hidden = !!p;
    form.hidden = !p;
    const multi = $('props-multi');
    multi.hidden = count < 2;
    if (count >= 2) multi.textContent = `${count} selected · fields edit "${p.name}"; colour, parent, visibility and delete apply to all`;
    app.characterPanel?.refresh();
    if (!p) return;
    if (formBusy()) return; // don't clobber typing
    $('p-name').value = p.name;
    $('p-type').textContent = PART_TYPES[p.type].label + (isBone(p) ? ' (joint of the skeleton)' : '');
    refreshPose();
    offsetFields.forEach((id, i) => { $(id).value = p.offset[i]; });
    const bone = isBone(p);
    $('sec-size').textContent = bone ? 'Marker thickness' : 'Size';
    $('p-sy').hidden = bone; $('p-sz').hidden = bone;
    $('sec-offset').firstChild.textContent = bone ? 'Tip (where the bone points) ' : 'Pivot offset ';
    $('row-sides').hidden = !PART_TYPES[p.type].hasSides;
    $('p-sides').value = p.sides || '';
    $('p-sides-range').value = p.sides || 3;
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
    const selIds = new Set(app.selectedIds());
    const clip = animator.clip;
    for (const { part, depth } of model.ordered()) {
      const li = document.createElement('li');
      li.style.paddingLeft = `${6 + depth * 14}px`;
      if (selIds.has(part.id)) li.classList.add('selected');
      if (sel && sel.id === part.id) li.classList.add('active');
      if (!part.visible) li.classList.add('hidden');
      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.background = part.color;
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = part.name;
      name.title = part.name;
      const type = document.createElement('span');
      type.className = 'type' + (isBone(part) ? ' bone' : '');
      type.textContent = PART_TYPES[part.type].label.toLowerCase();
      li.append(sw, name);
      if (clip && clip.tracks[part.id]) {
        const mark = document.createElement('span');
        mark.className = 'key-mark';
        mark.textContent = '◆';
        mark.title = 'Has keyframes in the current clip';
        li.appendChild(mark);
      }
      li.appendChild(type);
      li.addEventListener('click', e => {
        if (e.shiftKey) app.selectRange(part.id);
        else if (e.ctrlKey || e.metaKey) app.toggleSelect(part.id);
        else app.select(part.id);
      });
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
    const n = app.selectedIds().length;
    const sel = n > 1 ? `${n} selected (${p.name})  ·  ` : p ? `${p.name}  ·  ${PART_TYPES[p.type].label}  ·  ` : '';
    const clip = animator.clip;
    const anim = clip ? `  ·  ${clip.name} @ ${Math.round(animator.frame)}/${clip.length}` : '';
    const bones = [...model.parts.values()].filter(isBone).length;
    const boneTxt = bones ? `  ·  ${bones} bones` : '';
    $('status').textContent = `${sel}${model.parts.size - bones} parts${boneTxt}  ·  ${tris} triangles${anim}`;
  }

  function refreshAll() { refreshOutliner(); refreshProps(); refreshToolbar(); refreshStatus(); }

  model.onChange(kind => {
    if (kind === 'update') { refreshProps(); refreshStatus(); const sel = app.selected(); if (sel) updateOutlinerRow(sel); }
    else refreshAll();
  });
  history.onChange(refreshToolbar);
  animator.onChange(kind => {
    if (kind === 'frame') { refreshPose(); refreshStatus(); }
    else refreshAll();
  });

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

  return { refreshAll, refreshProps, refreshPose, refreshOutliner, refreshToolbar, refreshStatus };
}

function round3(v) { return Math.round(v * 1000) / 1000; }

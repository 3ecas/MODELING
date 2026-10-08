// DOM wiring: header menus, objects list (with folders), properties panel, colour picker, corners, status.

import { PART_TYPES, PALETTE, isBone, isGroup, hasMesh } from './parts.js';
import { createColorPicker } from './colorpicker.js';

const $ = id => document.getElementById(id);
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

const ICON_FOLDER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/></svg>';
const ICON_BONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 18l12-12"/><circle cx="5" cy="19" r="2.2"/><circle cx="19" cy="5" r="2.2"/></svg>';
const ICON_LINK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.3 1.3"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.3-1.3"/></svg>';
const ICON_EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/></svg>';
const ICON_EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 6.3A10 10 0 0 1 12 6c6.5 0 10 6 10 6a16 16 0 0 1-3 3.6M6.4 7.7A15 15 0 0 0 2 12s3.5 6 10 6a10 10 0 0 0 3.6-.7"/></svg>';

export function initUI(app) {
  const { model, history, viewport, animator } = app;

  // ----- menus (File, Add, Kit, Help) -----
  const menus = [...document.querySelectorAll('.menu')];
  function closeMenus(except) {
    for (const m of menus) if (m !== except) { m.classList.remove('open'); m.querySelector('.menu-list').hidden = true; }
  }
  for (const m of menus) {
    const btn = m.querySelector('.menu-btn');
    const list = m.querySelector('.menu-list');
    if (!btn || !list) continue;
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const open = list.hidden;
      closeMenus(m);
      list.hidden = !open;
      m.classList.toggle('open', open);
    });
    // Hovering across the bar switches menus like a desktop app.
    btn.addEventListener('pointerenter', () => { if (menus.some(x => x !== m && x.classList.contains('open'))) { closeMenus(m); list.hidden = false; m.classList.add('open'); } });
    list.addEventListener('click', e => { if (e.target.closest('button')) closeMenus(); });
  }
  document.addEventListener('click', e => { if (!e.target.closest('.menu')) closeMenus(); });
  window.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenus(); });

  document.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => app.addPart(b.dataset.add)));
  document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => app.setMode(b.dataset.mode)));
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => viewport.setView(b.dataset.view)));
  document.querySelectorAll('[data-export]').forEach(b => b.addEventListener('click', () => app.export(b.dataset.export)));

  $('btn-new').addEventListener('click', () => app.newModel());
  $('btn-open').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) await app.openFile(file);
  });
  $('btn-save').addEventListener('click', () => app.save());
  $('btn-group').addEventListener('click', () => app.groupSelection());
  $('btn-humanoid').addEventListener('click', () => app.addHumanoid());
  $('btn-random').addEventListener('click', () => app.addRandomNPC());
  $('btn-undo').addEventListener('click', () => app.undo());
  $('btn-redo').addEventListener('click', () => app.redo());

  $('chk-snap').addEventListener('change', e => viewport.setSnap(e.target.checked));
  $('chk-pixel').addEventListener('change', e => viewport.setPixel(e.target.checked));
  $('chk-wire').addEventListener('change', e => model.setWireframe(e.target.checked));
  $('chk-grid').addEventListener('change', e => viewport.setGrid(e.target.checked));
  $('chk-bones').addEventListener('change', e => viewport.setBones(e.target.checked));
  $('chk-mouse').addEventListener('change', e => app.setMouseSwap(e.target.checked));

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

  // Visibility, parent and colour apply to every selected object.
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

  function applyColor(hex, commit) {
    if (!app.selected()) return;
    for (const p of app.selectedParts()) model.update(p.id, { color: hex });
    $('p-color-hex').value = hex;
    $('p-swatch').style.background = hex;
    if (commit) app.commit();
  }
  const picker = createColorPicker($('picker'), {
    onInput: hex => applyColor(hex, false),
    onChange: () => app.commit(),
  });
  $('p-color-hex').addEventListener('change', e => {
    const p = app.selected(); if (!p) return;
    let v = e.target.value.trim();
    if (/^[0-9a-f]{6}$/i.test(v)) v = '#' + v;
    if (!/^#[0-9a-f]{6}$/i.test(v)) { e.target.value = p.color; return; }
    applyColor(v.toLowerCase(), true);
    picker.set(v);
  });

  const palette = $('palette');
  PALETTE.forEach(c => {
    const sw = document.createElement('div');
    sw.className = 'sw';
    sw.style.background = c;
    sw.title = c;
    sw.addEventListener('click', () => { applyColor(c, true); picker.set(c); });
    palette.appendChild(sw);
  });

  $('btn-duplicate').addEventListener('click', () => app.duplicate());
  $('btn-mirror').addEventListener('click', () => app.duplicate({ mirrorX: true }));
  $('btn-delete').addEventListener('click', () => app.deleteSelected());
  $('btn-select-children').addEventListener('click', () => app.selectChildren());
  $('btn-group-sel').addEventListener('click', () => app.groupSelection());
  $('btn-link').addEventListener('click', () => app.linkSelection());
  document.querySelectorAll('[data-anchor]').forEach(b => b.addEventListener('click', () => app.anchorPreset(b.dataset.anchor)));
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
    const bone = isBone(p), folder = isGroup(p), mesh = hasMesh(p);
    $('p-name').value = p.name;
    $('p-type').textContent = PART_TYPES[p.type].label + (bone ? ' · joint of the skeleton' : folder ? ' · holds other objects' : '');
    refreshPose();
    offsetFields.forEach((id, i) => { $(id).value = p.offset[i]; });
    $('row-size').hidden = folder;
    $('sec-size').textContent = bone ? 'Thickness' : 'Size';
    $('p-sy').hidden = bone; $('p-sz').hidden = bone;
    $('row-offset').hidden = folder;
    $('sec-offset').textContent = bone ? 'Tip' : 'Offset';
    $('row-anchor').hidden = !mesh;
    $('sec-shape').hidden = !PART_TYPES[p.type].hasSides;
    $('row-sides').hidden = !PART_TYPES[p.type].hasSides;
    $('p-sides').value = p.sides || '';
    $('p-sides-range').value = p.sides || 3;
    $('sec-colour').hidden = folder;
    if (!picker.dragging) picker.set(p.color);
    $('p-color-hex').value = p.color;
    $('p-swatch').style.background = p.color;
    $('p-visible').checked = p.visible;

    const sel = $('p-parent');
    sel.innerHTML = '';
    sel.appendChild(new Option('(none)', ''));
    for (const { part, depth } of model.ordered()) {
      if (part.id === p.id || model.isDescendant(part.id, p.id)) continue;
      sel.appendChild(new Option(`${'  '.repeat(depth)}${part.name}`, String(part.id)));
    }
    sel.value = p.parent == null ? '' : String(p.parent);
  }

  // ----- objects list -----
  const collapsed = new Set(); // ids of folded objects

  // Pick-whip: drag the link handle of a row onto another row to make that row its parent;
  // drop on the empty part of the list to unlink.
  let whip = null;
  const rowAt = (x, y) => document.elementFromPoint(x, y)?.closest('#part-list li') || null;
  function whipMove(e) {
    if (!whip) return;
    $('part-list').querySelectorAll('li.drop').forEach(li => li.classList.remove('drop'));
    const li = rowAt(e.clientX, e.clientY);
    if (li && Number(li.dataset.id) !== whip.from) li.classList.add('drop');
    whip.over = li;
  }
  function whipEnd(e) {
    if (!whip) return;
    const { from } = whip;
    const li = rowAt(e.clientX, e.clientY);
    const inList = !!document.elementFromPoint(e.clientX, e.clientY)?.closest('#outliner');
    whip = null;
    document.body.classList.remove('whipping');
    $('part-list').querySelectorAll('li.drop').forEach(x => x.classList.remove('drop'));
    if (li && Number(li.dataset.id) !== from) app.link(from, Number(li.dataset.id));
    else if (!li && inList) app.link(from, null);
  }

  function foldedAway(part) {
    let q = part.parent != null ? model.parts.get(part.parent) : null;
    while (q) { if (collapsed.has(q.id)) return true; q = q.parent != null ? model.parts.get(q.parent) : null; }
    return false;
  }

  function refreshOutliner() {
    const list = $('part-list');
    list.innerHTML = '';
    const sel = app.selected();
    const selIds = new Set(app.selectedIds());
    const clip = animator.clip;
    for (const { part, depth } of model.ordered()) {
      if (foldedAway(part)) continue;
      const li = document.createElement('li');
      li.dataset.id = part.id;
      li.style.paddingLeft = `${4 + depth * 12}px`;
      if (selIds.has(part.id)) li.classList.add('selected');
      if (sel && sel.id === part.id) li.classList.add('active');
      if (!part.visible) li.classList.add('hidden');

      const tog = document.createElement('span');
      tog.className = 'tog';
      const hasKids = model.childrenOf(part.id).length > 0;
      tog.textContent = hasKids ? (collapsed.has(part.id) ? '▸' : '▾') : '';
      if (hasKids) {
        tog.title = collapsed.has(part.id) ? 'Expand' : 'Collapse';
        tog.addEventListener('click', e => { e.stopPropagation(); if (collapsed.has(part.id)) collapsed.delete(part.id); else collapsed.add(part.id); refreshOutliner(); });
      }

      let icon;
      if (isGroup(part)) { icon = document.createElement('span'); icon.className = 'ico'; icon.innerHTML = ICON_FOLDER; }
      else if (isBone(part)) { icon = document.createElement('span'); icon.className = 'ico'; icon.style.color = 'var(--bone)'; icon.innerHTML = ICON_BONE; }
      else { icon = document.createElement('span'); icon.className = 'swatch'; icon.style.background = part.color; }

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = part.name;
      name.title = part.name;
      const type = document.createElement('span');
      type.className = 'type' + (isBone(part) ? ' bone' : '');
      type.textContent = PART_TYPES[part.type].label.toLowerCase();
      li.append(tog, icon, name);
      if (clip && clip.tracks[part.id]) {
        const mark = document.createElement('span');
        mark.className = 'key-mark';
        mark.textContent = '◆';
        mark.title = 'Has keyframes in the current clip';
        li.appendChild(mark);
      }
      li.appendChild(type);
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'link';
      link.innerHTML = ICON_LINK;
      link.title = 'Drag onto another object to make it the parent (drop on empty space to unlink)';
      link.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        e.stopPropagation(); e.preventDefault();
        link.setPointerCapture(e.pointerId);
        whip = { from: part.id, over: null };
        document.body.classList.add('whipping');
      });
      link.addEventListener('pointermove', whipMove);
      link.addEventListener('pointerup', whipEnd);
      link.addEventListener('pointercancel', whipEnd);
      link.addEventListener('click', e => e.stopPropagation());
      li.appendChild(link);
      const eye = document.createElement('button');
      eye.type = 'button';
      eye.className = 'eye';
      eye.innerHTML = part.visible ? ICON_EYE : ICON_EYE_OFF;
      eye.title = part.visible ? 'Hide' : 'Show';
      eye.addEventListener('click', e => {
        e.stopPropagation();
        model.update(part.id, { visible: !part.visible });
        app.commit();
      });
      li.appendChild(eye);
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

  function updateOutlinerRow(part) {
    // Cheap refresh of name/colour/visibility for one row.
    const li = $('part-list').querySelector(`li[data-id="${part.id}"]`);
    if (!li) return refreshOutliner();
    const sw = li.querySelector('.swatch');
    if (sw) sw.style.background = part.color;
    li.querySelector('.name').textContent = part.name;
    li.classList.toggle('hidden', !part.visible);
    const eye = li.querySelector('.eye');
    if (eye) { eye.innerHTML = part.visible ? ICON_EYE : ICON_EYE_OFF; eye.title = part.visible ? 'Hide' : 'Show'; }
  }

  function refreshToolbar() {
    document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === viewport.mode));
    $('btn-undo').disabled = !history.canUndo;
    $('btn-redo').disabled = !history.canRedo;
    $('m-name').value = model.name;
  }

  function refreshStatus() {
    if ($('status').classList.contains('notice')) return;
    const p = app.selected();
    const tris = Math.round(viewport.triangleCount());
    const n = app.selectedIds().length;
    const sel = n > 1 ? `${n} selected (${p.name})  ·  ` : p ? `${p.name}  ·  ${PART_TYPES[p.type].label}  ·  ` : '';
    const clip = animator.clip;
    const anim = clip ? `  ·  ${clip.name} @ ${Math.round(animator.frame)}/${clip.length}` : '';
    const parts = [...model.parts.values()];
    const bones = parts.filter(isBone).length;
    const folders = parts.filter(isGroup).length;
    const extra = (bones ? `  ·  ${bones} bones` : '') + (folders ? `  ·  ${folders} folders` : '');
    $('status').textContent = `${sel}${parts.length - bones - folders} objects${extra}  ·  ${tris} triangles${anim}`;
  }

  function refreshAll() { refreshOutliner(); refreshProps(); refreshToolbar(); refreshStatus(); }

  let noticeTimer = null;
  /** Shows a short message in the status bar. */
  function notice(text) {
    const el = $('status');
    el.textContent = text;
    el.classList.add('notice');
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { el.classList.remove('notice'); refreshStatus(); }, 3000);
  }

  model.onChange((kind, part) => {
    if (kind === 'update') { refreshProps(); refreshStatus(); if (part) updateOutlinerRow(part); }
    else refreshAll();
  });
  history.onChange(refreshToolbar);
  animator.onChange(kind => {
    if (kind === 'frame') { refreshPose(); refreshStatus(); }
    else refreshAll();
  });

  return { refreshAll, refreshProps, refreshPose, refreshOutliner, refreshToolbar, refreshStatus, notice, collapsed };
}

function round3(v) { return Math.round(v * 1000) / 1000; }

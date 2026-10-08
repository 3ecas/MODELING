// Entry point: builds the app object that ties the model, history, animator, viewport and UI together.

import * as THREE from 'three';
import { Model } from './model.js';
import { History } from './history.js';
import { Viewport } from './viewport.js';
import { Animator, newClip, sanitizeClip, CLIP_PRESETS } from './animation.js';
import { initUI } from './ui.js';
import { initTimeline } from './timeline.js';
import { initCharacterPanel } from './character-panel.js';
import { saveProject, readProjectFile, exportGLB, exportOBJ } from './io.js';
import { addHumanoid, rebuildHumanoid, randomRecipe, DEFAULT_RECIPE, characterRootOf } from './templates.js';
import { PART_TYPES } from './parts.js';

const AUTOSAVE_KEY = 'blocky.autosave';

const model = new Model(new THREE.Group());
model.root.name = 'model';
const history = new History(model);
const viewport = new Viewport(document.getElementById('canvas'), model);
const animator = new Animator(model);

let selectedIds = []; // ordered; the last one is the active part
const selectListeners = [];

function applySelection() {
  selectedIds = selectedIds.filter(id => model.parts.has(id));
  viewport.select(app.selectedParts());
  ui.refreshAll();
  for (const fn of selectListeners) fn(app.selected());
}

const app = {
  model, history, viewport, animator,

  // ----- selection -----

  /** The active part (the last one selected), or null. */
  selected() { return selectedIds.length ? model.parts.get(selectedIds[selectedIds.length - 1]) || null : null; },
  selectedIds() { return selectedIds.filter(id => model.parts.has(id)); },
  selectedParts() { return app.selectedIds().map(id => model.parts.get(id)); },
  isSelected(id) { return selectedIds.includes(id); },

  /** Selects exactly one part (or nothing). */
  select(id) {
    selectedIds = id != null && model.parts.has(id) ? [id] : [];
    applySelection();
  },

  /** Selects several parts; `active` (default: the last id) becomes the active part. */
  selectMany(ids, { active } = {}) {
    const seen = new Set();
    selectedIds = ids.filter(id => model.parts.has(id) && !seen.has(id) && seen.add(id));
    if (active != null && model.parts.has(active)) selectedIds = [...selectedIds.filter(id => id !== active), active];
    applySelection();
  },

  /** Adds a part to the selection, or removes it if already selected. */
  toggleSelect(id) {
    if (!model.parts.has(id)) return;
    selectedIds = selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id];
    applySelection();
  },

  /** Selects the range between the active part and `id` in outliner order (Shift+click in the list). */
  selectRange(id) {
    const order = model.ordered().map(o => o.part.id);
    const a = order.indexOf(app.selected()?.id), b = order.indexOf(id);
    if (a < 0 || b < 0) return app.select(id);
    const range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
    app.selectMany([...selectedIds, ...range], { active: id });
  },

  /** Selects every visible part (bones only when they are shown). */
  selectAll() {
    const ids = model.ordered().map(o => o.part).filter(p => model.isShown(p) && (!p.pivot || model.showBones || p.type !== 'bone')).map(p => p.id);
    app.selectMany(ids, { active: app.selected()?.id });
  },

  /** Puts the selected objects into a new folder placed at their centre (Ctrl+G). */
  groupSelection() {
    const parts = topLevelSelected();
    if (!parts.length) return null;
    const parents = new Set(parts.map(p => p.parent));
    const parent = parents.size === 1 ? parts[0].parent : null;
    const c = new THREE.Vector3(), v = new THREE.Vector3();
    for (const p of parts) c.add(p.pivot.getWorldPosition(v));
    c.divideScalar(parts.length);
    const folder = model.batch(() => {
      const f = model.addPart({ type: 'group', position: c.toArray(), parent: null });
      if (parent != null) model.setParent(f.id, parent);
      for (const p of parts) model.setParent(p.id, f.id);
      return f;
    });
    app.select(folder.id);
    app.commit();
    return folder;
  },

  /** Adds the descendants of every selected part to the selection. */
  selectChildren() {
    const ids = [...selectedIds];
    const walk = id => { for (const c of model.childrenOf(id)) { ids.push(c.id); walk(c.id); } };
    for (const id of app.selectedIds()) walk(id);
    app.selectMany(ids, { active: app.selected()?.id });
  },

  onSelect(fn) { selectListeners.push(fn); },

  commit() {
    history.commit();
    autosave();
  },

  setMode(mode) {
    if (!['translate', 'rotate', 'scale', 'anchor'].includes(mode)) return;
    if (mode === 'anchor' && animator.clip) { ui.notice('The anchor tool edits the rest pose: pick "Rest pose" in the clip menu first.'); return; }
    viewport.setMode(mode);
    ui.refreshToolbar();
  },

  /** Moves the active part's anchor to the centre, bottom or top of its shape. */
  anchorPreset(kind) {
    const p = app.selected();
    if (!p || animator.clip || p.type === 'bone') return;
    const [ox, oy, oz] = p.offset;
    const h = p.size[1] / 2;
    const target = kind === 'bottom' ? [ox, oy - h, oz] : kind === 'top' ? [ox, oy + h, oz] : [ox, oy, oz];
    if (model.moveAnchor(p.id, target)) { model.tidy(p); app.commit(); }
  },

  // ----- transforms: rest pose, or keyframes when a clip is active -----

  /** The transform currently shown for a part (sampled from the active clip, or the rest pose). */
  poseOf(part) { return animator.poseOf(part); },

  /** Sets position / rotation / size. With a clip active this writes keyframes instead of the rest pose. */
  setTransform(part, patch, { commit = true } = {}) {
    if (animator.clip) {
      for (const [prop, value] of Object.entries(patch)) if (value) animator.setKey(part.id, prop, value);
    } else {
      model.update(part.id, patch);
    }
    if (commit) app.commit();
  },

  // ----- parts -----

  addPart(type, data = {}) {
    if (!PART_TYPES[type]) return null;
    const sel = app.selected();
    const part = model.addPart({ type, ...data, parent: data.parent ?? (sel ? sel.id : null) });
    if (sel && data.position == null) model.update(part.id, { position: [0, 0, 0] });
    app.select(part.id);
    app.commit();
    return part;
  },

  addHumanoid(recipe = DEFAULT_RECIPE) {
    const root = model.batch(() => addHumanoid(model, recipe, freeSpot()));
    app.select(root.id);
    app.commit();
    return root;
  },

  addRandomNPC() {
    const root = model.batch(() => addHumanoid(model, randomRecipe(), freeSpot()));
    app.select(root.id);
    app.commit();
    return root;
  },

  /** The character root of the selection (or the first character in the model), if any. */
  characterRoot() {
    return characterRootOf(model, app.selected()) || [...model.parts.values()].find(p => p.recipe) || null;
  },

  /** Regenerates a character from a recipe, keeping ids, keys, position and selection. */
  setRecipe(rootId, recipe, { commit = true } = {}) {
    const root = model.batch(() => rebuildHumanoid(model, rootId, recipe));
    if (!root) return null;
    if (app.selectedIds().length) applySelection(); else app.select(root.id);
    if (commit) app.commit();
    return root;
  },

  /** Duplicates the selection (each selected tree once; selected descendants come along with their parent). */
  duplicate(opts = {}) {
    const targets = topLevelSelected();
    if (!targets.length) return;
    const copies = model.batch(() => targets.map(p => model.duplicate(p.id, opts)).filter(Boolean));
    if (copies.length) { app.selectMany(copies.map(c => c.id)); app.commit(); }
  },

  deleteSelected() {
    const parts = topLevelSelected(); if (!parts.length) return;
    const active = app.selected();
    const next = active && !parts.some(p => p !== active && model.isDescendant(active.id, p.id)) ? active.parent : null;
    model.batch(() => { for (const p of parts) model.removePart(p.id); });
    app.select(next != null && model.parts.has(next) ? next : null);
    app.commit();
  },

  // ----- animation clips -----

  setClip(id) { animator.setClip(id); },

  newClip(name = 'clip', opts) {
    const clip = newClip(name, opts);
    model.animations.push(clip);
    animator.setClip(clip.id);
    app.commit();
    return clip;
  },

  addPresetClip(kind) {
    const make = CLIP_PRESETS[kind];
    const root = app.characterRoot();
    if (!make || !root) { window.alert('Add a humanoid first (Kit → Humanoid), then pick a preset.'); return null; }
    const clip = make(model, root);
    const taken = new Set(model.animations.map(c => c.name));
    let name = clip.name, i = 2;
    while (taken.has(name)) name = `${clip.name} ${i++}`;
    clip.name = name;
    model.animations.push(clip);
    animator.setClip(clip.id);
    app.select(root.id);
    app.commit();
    return clip;
  },

  updateClip(patch) {
    const clip = animator.clip; if (!clip) return;
    const next = sanitizeClip({ ...clip, ...patch });
    Object.assign(clip, { fps: next.fps, length: next.length, interpolation: next.interpolation, name: next.name });
    animator.setFrame(Math.min(animator.frame, clip.length));
    animator._emit('edit');
    app.commit();
  },

  renameClip(id, name) {
    const clip = model.animations.find(c => c.id === id); if (!clip) return;
    clip.name = name;
    animator._emit('edit');
    app.commit();
  },

  duplicateClip(id) {
    const src = model.animations.find(c => c.id === id); if (!src) return null;
    const copy = sanitizeClip(JSON.parse(JSON.stringify({ ...src, id: undefined, name: `${src.name} copy` })));
    model.animations.push(copy);
    animator.setClip(copy.id);
    app.commit();
    return copy;
  },

  deleteClip(id) {
    const i = model.animations.findIndex(c => c.id === id); if (i < 0) return;
    model.animations.splice(i, 1);
    if (animator.clipId === id) animator.setClip(null); else animator._emit('edit');
    app.commit();
  },

  /** Keys every selected part's pose (position, rotation, size) at the current frame. */
  keySelected(props) {
    const parts = app.selectedParts();
    if (!parts.length || !animator.clip) return;
    for (const p of parts) animator.keyPart(p, props);
    app.commit();
  },

  // ----- history / files -----

  undo() { if (history.undo()) afterHistory(); },
  redo() { if (history.redo()) afterHistory(); },

  newModel() {
    if (model.parts.size && !window.confirm('Start a new empty model? Unsaved changes will be lost.')) return;
    animator.setClip(null);
    model.clear();
    model.name = 'untitled';
    app.select(null);
    history.reset();
    autosave();
  },

  async openFile(file) {
    try {
      const json = await readProjectFile(file);
      app.loadJSON(json);
      viewport.focus();
    } catch (e) {
      window.alert(`Could not open file: ${e.message}`);
    }
  },

  loadJSON(json) {
    animator.setClip(null);
    model.fromJSON(json);
    app.select(null);
    history.reset();
    autosave();
  },

  save() { saveProject(model); },
  exportGLB(opts) { return exportGLB(model, opts); },
  exportOBJ(opts) { return exportOBJ(model, opts); },

  /** Export menu entries. */
  export(kind) {
    switch (kind) {
      case 'skinned': return exportGLB(model, { mode: 'skinned' });
      case 'skinned-vc': return exportGLB(model, { mode: 'skinned', vertexColors: true });
      case 'parts': return exportGLB(model, { mode: 'parts' });
      case 'obj': return exportOBJ(model);
      case 'preview': return app.previewInPlayer();
      default: return null;
    }
  },

  /** Opens the example player in a new tab and hands it the skinned GLB. */
  previewInPlayer() {
    const win = window.open('example/player.html?embedded=1', 'blocky-player');
    if (!win) { window.alert('The browser blocked the player window. Allow pop-ups for this page and try again.'); return; }
    const onReady = async e => {
      if (e.source !== win || !e.data || e.data.type !== 'blocky-player-ready') return;
      window.removeEventListener('message', onReady);
      const glb = await exportGLB(model, { silent: true, mode: 'skinned' });
      win.postMessage({ type: 'blocky-glb', data: glb, name: model.name }, '*', [glb]);
    };
    window.addEventListener('message', onReady);
  },
};

function afterHistory() {
  if (animator.clipId && !animator.clip) animator.setClip(null);
  applySelection();
  animator.apply();
  autosave();
}

/** Selected parts that have no selected ancestor. */
function topLevelSelected() {
  const ids = new Set(app.selectedIds());
  return app.selectedParts().filter(p => {
    let q = p.parent != null ? model.parts.get(p.parent) : null;
    while (q) { if (ids.has(q.id)) return false; q = q.parent != null ? model.parts.get(q.parent) : null; }
    return true;
  });
}

// Finds an x position on the ground that is not already occupied by a top-level part.
function freeSpot() {
  const taken = new Set([...model.parts.values()].filter(p => p.parent == null).map(p => Math.round(p.position[0] / 1.2)));
  let i = 0;
  while (taken.has(i)) i = i > 0 ? -i : -i + 1;
  return [i * 1.2, 0];
}

function autosave() {
  try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(model.toJSON())); } catch { /* storage may be unavailable */ }
}

// ----- viewport events -----

viewport.onPick((part, e) => {
  if (e && (e.shiftKey || e.ctrlKey || e.metaKey)) { if (part) app.toggleSelect(part.id); }
  else app.select(part ? part.id : null);
});
viewport.onMarquee(parts => app.selectMany([...app.selectedIds(), ...parts.map(p => p.id)]));
viewport.onDrag((dragging, parts) => { animator.holdParts = dragging ? new Set(parts) : new Set(); });
viewport.onTransformEnd((parts, mode) => {
  if (mode === 'anchor') {
    for (const part of parts) { model.readBack(part); model.tidy(part); }
    app.commit();
    return;
  }
  for (const part of parts) {
    if (animator.clip) {
      const t = model.readTransform(part);
      const prop = mode === 'translate' ? 'position' : mode === 'rotate' ? 'rotation' : 'size';
      animator.setKey(part.id, prop, t[prop]);
      if (mode === 'scale' && parts.length > 1) animator.setKey(part.id, 'position', t.position); // sizes scale about the centre
      if (mode === 'rotate' && parts.length > 1) animator.setKey(part.id, 'position', t.position); // orbits around the centre
    } else {
      model.readBack(part);
    }
  }
  app.commit();
});
viewport.onFrame(dt => animator.tick(dt));
animator.onChange(kind => { if (kind === 'clip' && animator.clip && viewport.mode === 'anchor') app.setMode('translate'); });

// ----- keyboard -----

window.addEventListener('keydown', e => {
  const t = e.target;
  // Let text fields, sliders and menus keep their keys; buttons and checkboxes pass shortcuts through.
  const typing = t && (t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' ||
    (t.tagName === 'INPUT' && !['checkbox', 'button', 'submit'].includes(t.type)));
  if (typing) return;
  const k = e.key.toLowerCase();
  const ctrl = e.ctrlKey || e.metaKey;

  if (ctrl && k === 'z' && e.shiftKey) { e.preventDefault(); app.redo(); return; }
  if (ctrl && k === 'z') { e.preventDefault(); app.undo(); return; }
  if (ctrl && k === 'y') { e.preventDefault(); app.redo(); return; }
  if (ctrl && k === 'd') { e.preventDefault(); app.duplicate(); return; }
  if (ctrl && k === 'a') { e.preventDefault(); app.selectAll(); return; }
  if (ctrl && k === 'g') { e.preventDefault(); app.groupSelection(); return; }
  if (ctrl && k === 's') { e.preventDefault(); app.save(); return; }
  if (ctrl) return;

  const clip = animator.clip;
  const step = e.shiftKey ? 5 : 1;
  switch (k) {
    case 'w': case 'g': app.setMode('translate'); break;
    case 'e': app.setMode('rotate'); break;
    case 'r': app.setMode('scale'); break;
    case 'a': app.setMode('anchor'); break;
    case 'f': viewport.focus(); break;
    case 'escape': app.select(null); break;
    case 'delete': case 'backspace': e.preventDefault(); app.deleteSelected(); break;
    case '1': viewport.setView('front'); break;
    case '3': viewport.setView('side'); break;
    case '7': viewport.setView('top'); break;
    case '5': viewport.setView('persp'); break;
    case ' ': if (clip) { e.preventDefault(); animator.toggle(); } break;
    case 'k': app.keySelected(); break;
    case 'arrowleft': if (clip) { e.preventDefault(); animator.pause(); animator.setFrame(Math.round(animator.frame) - step); } break;
    case 'arrowright': if (clip) { e.preventDefault(); animator.pause(); animator.setFrame(Math.round(animator.frame) + step); } break;
    case 'home': if (clip) { e.preventDefault(); animator.setFrame(0); } break;
    case 'end': if (clip) { e.preventDefault(); animator.setFrame(clip.length); } break;
    default: return;
  }
});

// ----- boot -----

const ui = initUI(app);
app.characterPanel = initCharacterPanel(app);
app.timeline = initTimeline(app);

let restored = false;
try {
  const saved = localStorage.getItem(AUTOSAVE_KEY);
  if (saved) {
    const json = JSON.parse(saved);
    if (json && Array.isArray(json.parts) && json.parts.length) { model.fromJSON(json); restored = true; }
  }
} catch { /* ignore corrupt autosave */ }

if (!restored) model.batch(() => addHumanoid(model, DEFAULT_RECIPE, [0, 0]));
history.reset();
app.select(null);
ui.refreshAll();
app.timeline.refresh();
viewport.focus();

window.app = app; // handy for the console and for tests

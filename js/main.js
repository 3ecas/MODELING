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

let selectedId = null;
const selectListeners = [];

const app = {
  model, history, viewport, animator,

  // ----- selection -----

  selected() { return selectedId != null ? model.parts.get(selectedId) || null : null; },

  select(id) {
    selectedId = id != null && model.parts.has(id) ? id : null;
    viewport.select(app.selected());
    ui.refreshAll();
    for (const fn of selectListeners) fn(app.selected());
  },

  onSelect(fn) { selectListeners.push(fn); },

  commit() {
    history.commit();
    autosave();
  },

  setMode(mode) {
    if (!['translate', 'rotate', 'scale'].includes(mode)) return;
    viewport.setMode(mode);
    ui.refreshToolbar();
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
    app.select(selectedId != null && model.parts.has(selectedId) ? selectedId : root.id);
    if (commit) app.commit();
    return root;
  },

  duplicate(opts = {}) {
    const sel = app.selected(); if (!sel) return;
    const copy = model.batch(() => model.duplicate(sel.id, opts));
    if (copy) { app.select(copy.id); app.commit(); }
  },

  deleteSelected() {
    const sel = app.selected(); if (!sel) return;
    const next = sel.parent;
    model.batch(() => model.removePart(sel.id));
    app.select(next);
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

  /** Keys the selected part's full pose (position, rotation, size) at the current frame. */
  keySelected(props) {
    const sel = app.selected();
    if (!sel || !animator.clip) return;
    animator.keyPart(sel, props);
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
};

function afterHistory() {
  if (animator.clipId && !animator.clip) animator.setClip(null);
  app.select(selectedId);
  animator.apply();
  autosave();
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

viewport.onPick(part => app.select(part ? part.id : null));
viewport.onDrag((dragging, part) => { animator.holdPart = dragging ? part : null; });
viewport.onTransformEnd((part, mode) => {
  if (animator.clip) {
    const t = model.readTransform(part);
    const prop = mode === 'translate' ? 'position' : mode === 'rotate' ? 'rotation' : 'size';
    animator.setKey(part.id, prop, t[prop]);
  } else {
    model.readBack(part);
  }
  app.commit();
});
viewport.onFrame(dt => animator.tick(dt));

// ----- keyboard -----

window.addEventListener('keydown', e => {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
  const k = e.key.toLowerCase();
  const ctrl = e.ctrlKey || e.metaKey;

  if (ctrl && k === 'z' && e.shiftKey) { e.preventDefault(); app.redo(); return; }
  if (ctrl && k === 'z') { e.preventDefault(); app.undo(); return; }
  if (ctrl && k === 'y') { e.preventDefault(); app.redo(); return; }
  if (ctrl && k === 'd') { e.preventDefault(); app.duplicate(); return; }
  if (ctrl && k === 's') { e.preventDefault(); app.save(); return; }
  if (ctrl) return;

  const clip = animator.clip;
  const step = e.shiftKey ? 5 : 1;
  switch (k) {
    case 'w': case 'g': app.setMode('translate'); break;
    case 'e': app.setMode('rotate'); break;
    case 'r': app.setMode('scale'); break;
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

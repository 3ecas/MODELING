// Entry point: builds the app object that ties the model, history, viewport and UI together.

import * as THREE from 'three';
import { Model } from './model.js';
import { History } from './history.js';
import { Viewport } from './viewport.js';
import { initUI } from './ui.js';
import { saveProject, readProjectFile, exportGLB, exportOBJ } from './io.js';
import { addHumanoid, randomRecipe, DEFAULT_RECIPE } from './templates.js';
import { PART_TYPES } from './parts.js';

const AUTOSAVE_KEY = 'blocky.autosave';

const model = new Model(new THREE.Group());
model.root.name = 'model';
const history = new History(model);
const viewport = new Viewport(document.getElementById('canvas'), model);

let selectedId = null;

const app = {
  model, history, viewport,

  selected() { return selectedId != null ? model.parts.get(selectedId) || null : null; },

  select(id) {
    selectedId = id != null && model.parts.has(id) ? id : null;
    viewport.select(app.selected());
    ui.refreshAll();
  },

  commit() {
    history.commit();
    autosave();
  },

  setMode(mode) {
    if (!['translate', 'rotate', 'scale'].includes(mode)) return;
    viewport.setMode(mode);
    ui.refreshToolbar();
  },

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
    const root = addHumanoid(model, recipe, freeSpot());
    app.select(root.id);
    app.commit();
    return root;
  },

  addRandomNPC() {
    const root = addHumanoid(model, randomRecipe(), freeSpot());
    app.select(root.id);
    app.commit();
    return root;
  },

  duplicate(opts = {}) {
    const sel = app.selected(); if (!sel) return;
    const copy = model.duplicate(sel.id, opts);
    if (copy) { app.select(copy.id); app.commit(); }
  },

  deleteSelected() {
    const sel = app.selected(); if (!sel) return;
    const next = sel.parent;
    model.removePart(sel.id);
    app.select(next);
    app.commit();
  },

  undo() { if (history.undo()) { app.select(selectedId); autosave(); } },
  redo() { if (history.redo()) { app.select(selectedId); autosave(); } },

  newModel() {
    if (model.parts.size && !confirm('Start a new empty model? Unsaved changes will be lost.')) return;
    model.clear();
    model.name = 'untitled';
    app.select(null);
    history.reset();
    autosave();
  },

  async openFile(file) {
    try {
      const json = await readProjectFile(file);
      model.fromJSON(json);
      app.select(null);
      history.reset();
      autosave();
      viewport.focus();
    } catch (e) {
      alert(`Could not open file: ${e.message}`);
    }
  },

  loadJSON(json) {
    model.fromJSON(json);
    app.select(null);
    history.reset();
    autosave();
  },

  save() { saveProject(model); },
  exportGLB(opts) { return exportGLB(model, opts); },
  exportOBJ(opts) { return exportOBJ(model, opts); },
};

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
viewport.onTransformEnd(part => { model.readBack(part); app.commit(); });

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
    default: return;
  }
});

// ----- boot -----

const ui = initUI(app);

let restored = false;
try {
  const saved = localStorage.getItem(AUTOSAVE_KEY);
  if (saved) {
    const json = JSON.parse(saved);
    if (json && Array.isArray(json.parts) && json.parts.length) { model.fromJSON(json); restored = true; }
  }
} catch { /* ignore corrupt autosave */ }

if (!restored) addHumanoid(model, DEFAULT_RECIPE, [0, 0]);
history.reset();
app.select(null);
ui.refreshAll();
viewport.focus();

window.app = app; // handy for the console and for tests

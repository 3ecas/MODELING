// The document: a flat list of parts with optional parenting, mirrored into a Three.js scene graph.
// Each part is a pivot Group (position + rotation) holding a Mesh (size via scale, offset via position).
// Children attach to the pivot, so a parent's size never distorts its children.

import * as THREE from 'three';
import { PART_TYPES, PALETTE, BONE_COLOR, GROUP_COLOR, getGeometry, clampSides, isBone, isGroup } from './parts.js';
import { sanitizeClip } from './animation.js';

export const FORMAT_VERSION = 3;

export class Model {
  constructor(root) {
    this.root = root;            // THREE.Group that holds every top-level pivot
    this.parts = new Map();      // id -> part
    this.name = 'untitled';
    this.animations = [];        // keyframe clips, see animation.js
    this._nextId = 1;
    this.wireframe = false;
    this.showBones = true;       // bone markers drawn (x-ray) in the editor
    this.listeners = new Set();
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(kind, part) {
    if (this._batchDepth) { this._batchDirty = true; return; }
    for (const fn of this.listeners) fn(kind, part);
  }

  /** Runs fn with change events suppressed, then emits a single 'batch' event (if anything changed). */
  batch(fn) {
    this._batchDepth = (this._batchDepth || 0) + 1;
    try { return fn(); }
    finally {
      if (--this._batchDepth === 0 && this._batchDirty) { this._batchDirty = false; this.emit('batch'); }
    }
  }

  // ----- creation -----

  addPart(data = {}) {
    const type = PART_TYPES[data.type] ? data.type : 'box';
    const def = PART_TYPES[type];
    const id = data.id && !this.parts.has(data.id) ? data.id : this._newId();
    const part = {
      id,
      name: data.name || this._uniqueName(def.label),
      type,
      position: vec(data.position, [0, 0.5, 0]),
      rotation: vec(data.rotation, [0, 0, 0]),
      size: vec(data.size, def.defaultSize),
      offset: vec(data.offset, def.isBone ? def.defaultTip : [0, 0, 0]),
      sides: def.hasSides ? clampSides(data.sides ?? def.defaultSides) : 0,
      color: typeof data.color === 'string' ? data.color : (def.isBone ? BONE_COLOR : def.isGroup ? GROUP_COLOR : PALETTE[0]),
      visible: data.visible !== false,
      parent: data.parent ?? null,
      // Character roots carry the recipe they were generated from (see templates.js).
      recipe: data.recipe && typeof data.recipe === 'object' ? { ...data.recipe } : null,
    };

    const material = def.isBone
      ? new THREE.MeshLambertMaterial({ color: part.color, flatShading: true, transparent: true, opacity: 0.7, depthTest: false })
      : new THREE.MeshLambertMaterial({ color: part.color, flatShading: true });
    const mesh = new THREE.Mesh(getGeometry(part.type, part.sides), material);
    mesh.name = part.name;
    mesh.userData.partId = id;
    mesh.castShadow = mesh.receiveShadow = !def.isBone && !def.isGroup;
    if (def.isBone) mesh.renderOrder = 1000; // bones draw on top of the body, like an x-ray armature

    const pivot = new THREE.Group();
    pivot.name = part.name;
    pivot.userData.partId = id;
    pivot.add(mesh);

    part.pivot = pivot;
    part.mesh = mesh;
    this.parts.set(id, part);

    const parentPart = part.parent != null ? this.parts.get(part.parent) : null;
    (parentPart ? parentPart.pivot : this.root).add(pivot);
    if (!parentPart) part.parent = null;

    this.apply(part);
    this.emit('add', part);
    return part;
  }

  _newId() {
    while (this.parts.has(this._nextId)) this._nextId++;
    return this._nextId++;
  }

  _uniqueName(base) {
    const names = new Set([...this.parts.values()].map(p => p.name));
    if (!names.has(base)) return base;
    let i = 2;
    while (names.has(`${base} ${i}`)) i++;
    return `${base} ${i}`;
  }

  // ----- removal -----

  removePart(id) {
    const part = this.parts.get(id);
    if (!part) return;
    for (const child of this.childrenOf(id)) this.removePart(child.id);
    part.pivot.removeFromParent();
    part.mesh.material.dispose();
    this.parts.delete(id);
    for (const clip of this.animations) delete clip.tracks[id];
    this.emit('remove', part);
  }

  clear() {
    for (const part of [...this.parts.values()]) {
      part.pivot.removeFromParent();
      part.mesh.material.dispose();
    }
    this.parts.clear();
    this.animations = [];
    this._nextId = 1;
    this.emit('clear');
  }

  // ----- hierarchy -----

  childrenOf(id) {
    return [...this.parts.values()].filter(p => p.parent === id);
  }

  /** Top-level parts first, each followed by its descendants (depth-first). */
  ordered() {
    const out = [];
    const walk = (parentId, depth) => {
      for (const p of this.parts.values()) {
        if (p.parent === parentId) { out.push({ part: p, depth }); walk(p.id, depth + 1); }
      }
    };
    walk(null, 0);
    return out;
  }

  isDescendant(id, ancestorId) {
    let p = this.parts.get(id);
    while (p && p.parent != null) {
      if (p.parent === ancestorId) return true;
      p = this.parts.get(p.parent);
    }
    return false;
  }

  /** Re-parents a part while keeping its world transform. */
  setParent(id, parentId) {
    const part = this.parts.get(id);
    if (!part) return false;
    if (parentId === id || (parentId != null && this.isDescendant(parentId, id))) return false;
    const newParent = parentId != null ? this.parts.get(parentId) : null;
    if (parentId != null && !newParent) return false;

    const target = newParent ? newParent.pivot : this.root;
    target.attach(part.pivot); // keeps world transform
    part.parent = newParent ? newParent.id : null;
    this.readBack(part);
    this.emit('hierarchy', part);
    return true;
  }

  // ----- updates -----

  /** Applies a partial change to a part and syncs the scene objects. */
  update(id, patch) {
    const part = this.parts.get(id);
    if (!part) return;
    const geometryChanged = patch.sides != null && patch.sides !== part.sides;
    for (const k of ['name', 'color', 'visible', 'recipe']) if (patch[k] !== undefined) part[k] = patch[k];
    for (const k of ['position', 'rotation', 'size', 'offset']) if (patch[k]) part[k] = vec(patch[k], part[k]);
    if (geometryChanged) part.sides = clampSides(patch.sides);
    if (patch.size) part.size = part.size.map(v => Math.max(0.01, v));
    this.apply(part);
    this.emit('update', part);
  }

  /** Pushes the data of a part into its Three.js objects. */
  apply(part) {
    const { pivot, mesh } = part;
    this.applyTransform(part, part);
    pivot.visible = part.visible;
    pivot.name = part.name;
    mesh.name = part.name;
    if (isBone(part)) {
      // The marker runs from the pivot to the tip stored in `offset`.
      const tip = new THREE.Vector3().fromArray(part.offset);
      const len = tip.length();
      mesh.position.set(0, 0, 0);
      mesh.quaternion.setFromUnitVectors(UP, len > 1e-6 ? tip.divideScalar(len) : UP);
      mesh.visible = this.showBones;
    } else if (isGroup(part)) {
      mesh.position.set(0, 0, 0);
      mesh.quaternion.identity();
      mesh.visible = false; // a folder is only a transform; the anchor marker shows it when selected
    } else {
      mesh.position.fromArray(part.offset);
      mesh.quaternion.identity();
      mesh.visible = true;
    }
    const geo = getGeometry(part.type, part.sides);
    if (mesh.geometry !== geo) mesh.geometry = geo;
    mesh.material.color.set(part.color);
    mesh.material.wireframe = this.wireframe;
  }

  /** Sets only position / rotation / size on the objects (used for animation poses). */
  applyTransform(part, { position, rotation, size }) {
    part.pivot.position.fromArray(position);
    part.pivot.rotation.set(...rotation.map(THREE.MathUtils.degToRad));
    if (isBone(part)) part.mesh.scale.set(size[0], Math.max(boneLength(part), 0.01), size[0]);
    else part.mesh.scale.fromArray(size);
  }

  /** Reads the current transform of the Three.js objects (e.g. after a gizmo drag). */
  readTransform(part) {
    const { pivot, mesh } = part;
    return {
      position: round(pivot.position.toArray()),
      rotation: round([pivot.rotation.x, pivot.rotation.y, pivot.rotation.z].map(THREE.MathUtils.radToDeg)),
      size: isBone(part) ? [...part.size] : round(mesh.scale.toArray()).map(v => Math.max(0.01, v)),
    };
  }

  /** Shows or hides the bone markers (bones keep working either way). */
  setShowBones(on) {
    this.showBones = !!on;
    for (const p of this.parts.values()) if (isBone(p)) p.mesh.visible = this.showBones;
  }

  /** True when the part and all its ancestors are visible. */
  isShown(part) {
    let p = part;
    while (p) {
      if (!p.visible) return false;
      p = p.parent != null ? this.parts.get(p.parent) : null;
    }
    return true;
  }

  /** Nearest ancestor (or the part itself) that satisfies `pred`, or null. */
  nearest(part, pred) {
    let p = part;
    while (p) {
      if (pred(p)) return p;
      p = p.parent != null ? this.parts.get(p.parent) : null;
    }
    return null;
  }

  /** Rest-pose world matrices for every pivot and mesh, computed from the data (ignores any active pose). */
  restMatrices() {
    const pivotWorld = new Map(), meshWorld = new Map();
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3(), euler = new THREE.Euler();
    for (const { part } of this.ordered()) {
      const local = new THREE.Matrix4().compose(
        pos.fromArray(part.position),
        quat.setFromEuler(euler.set(...part.rotation.map(THREE.MathUtils.degToRad))),
        scl.set(1, 1, 1),
      );
      const world = part.parent != null ? pivotWorld.get(part.parent).clone().multiply(local) : local;
      pivotWorld.set(part.id, world);
      const meshLocal = new THREE.Matrix4().compose(pos.fromArray(part.offset), quat.identity(), scl.fromArray(part.size));
      meshWorld.set(part.id, world.clone().multiply(meshLocal));
    }
    return { pivotWorld, meshWorld };
  }

  /** Reads the Three.js objects back into the rest pose data (after a gizmo drag). */
  readBack(part) {
    Object.assign(part, this.readTransform(part));
    part.mesh.scale.fromArray(part.size);
    this.emit('update', part);
  }

  /**
   * Moves a part's anchor (pivot) to the point `p`, given in the part's own frame, while the shape,
   * the children and every keyframe stay where they are in the world.
   */
  moveAnchor(id, p) {
    const part = this.parts.get(id);
    if (!part || !Array.isArray(p) || p.length !== 3) return false;
    const local = new THREE.Vector3().fromArray(p);
    if (local.lengthSq() === 0) return false;
    const R = new THREE.Quaternion().setFromEuler(new THREE.Euler(...part.rotation.map(THREE.MathUtils.degToRad)));
    const dParent = local.clone().applyQuaternion(R); // the same move, in the parent's frame
    part.position = part.position.map((v, i) => v + dParent.getComponent(i));
    part.offset = part.offset.map((v, i) => v - local.getComponent(i));
    for (const c of this.childrenOf(id)) {
      c.position = c.position.map((v, i) => v - local.getComponent(i));
      this.apply(c);
    }
    // Keep animations intact: the part's own position keys live in the parent's frame, the children's in ours.
    for (const clip of this.animations) {
      const own = clip.tracks[id]?.position;
      if (own) for (const k of own) k.v = k.v.map((v, i) => v + dParent.getComponent(i));
      for (const c of this.childrenOf(id)) {
        const keys = clip.tracks[c.id]?.position;
        if (keys) for (const k of keys) k.v = k.v.map((v, i) => v - local.getComponent(i));
      }
    }
    this.apply(part);
    this.emit('update', part);
    return true;
  }

  /** Rounds a part's (and its children's) stored transforms to 3 decimals after a drag. */
  tidy(part) {
    part.position = round(part.position);
    part.offset = round(part.offset);
    for (const c of this.childrenOf(part.id)) { c.position = round(c.position); this.apply(c); }
    this.apply(part);
    this.emit('update', part);
  }

  /** Looks a part up by name (first match). */
  byName(name) {
    for (const p of this.parts.values()) if (p.name === name) return p;
    return null;
  }

  setWireframe(on) {
    this.wireframe = !!on;
    for (const p of this.parts.values()) p.mesh.material.wireframe = this.wireframe;
  }

  partFromObject(obj) {
    while (obj) {
      if (obj.userData && obj.userData.partId != null) return this.parts.get(obj.userData.partId) || null;
      obj = obj.parent;
    }
    return null;
  }

  // ----- clone helpers -----

  /** Deep-duplicates a part (with descendants). Returns the new root part. */
  duplicate(id, { mirrorX = false } = {}) {
    const src = this.parts.get(id);
    if (!src) return null;
    const map = new Map();
    const copyTree = (p, newParent) => {
      const data = this.serializePart(p);
      delete data.id;
      data.parent = newParent;
      data.name = this._uniqueName(p.name.replace(/ \d+$/, ''));
      if (mirrorX && p === src) {
        data.position = [-data.position[0], data.position[1], data.position[2]];
        data.rotation = [data.rotation[0], -data.rotation[1], -data.rotation[2]];
        data.offset = [-data.offset[0], data.offset[1], data.offset[2]];
      } else if (!mirrorX && p === src) {
        data.position = [data.position[0] + 0.5, data.position[1], data.position[2]];
      }
      const created = this.addPart(data);
      map.set(p.id, created.id);
      for (const c of this.childrenOf(p.id)) copyTree(c, created.id);
      return created;
    };
    return copyTree(src, src.parent);
  }

  // ----- serialization -----

  serializePart(p) {
    const out = {
      id: p.id, name: p.name, type: p.type,
      position: [...p.position], rotation: [...p.rotation], size: [...p.size], offset: [...p.offset],
      sides: p.sides, color: p.color, visible: p.visible, parent: p.parent,
    };
    if (p.recipe) out.recipe = { ...p.recipe };
    return out;
  }

  toJSON() {
    return {
      format: 'blocky-model',
      version: FORMAT_VERSION,
      name: this.name,
      parts: this.ordered().map(({ part }) => this.serializePart(part)),
      animations: this.animations.map(c => ({ ...c, tracks: cloneTracks(c.tracks) })),
    };
  }

  fromJSON(json) {
    // Suppress the intermediate clear/add events: listeners get one 'load' at the end.
    this._batchDepth = (this._batchDepth || 0) + 1;
    try { this._load(json); }
    finally { this._batchDepth--; this._batchDirty = false; }
    this.emit('load');
  }

  _load(json) {
    this.clear();
    this.name = typeof json?.name === 'string' ? json.name : 'untitled';
    const list = Array.isArray(json?.parts) ? json.parts : [];
    // Parents are listed before children in ordered() output, but be tolerant of any order.
    const pending = [...list];
    let guard = pending.length * 2 + 1;
    while (pending.length && guard-- > 0) {
      const d = pending.shift();
      if (d.parent != null && !this.parts.has(d.parent)) {
        if (list.some(x => x.id === d.parent)) { pending.push(d); continue; }
        d.parent = null;
      }
      this.addPart(d);
    }
    for (const d of pending) { d.parent = null; this.addPart(d); }

    const clips = Array.isArray(json?.animations) ? json.animations : [];
    this.animations = clips.map(sanitizeClip);
    for (const clip of this.animations) {
      for (const pid of Object.keys(clip.tracks)) if (!this.parts.has(Number(pid))) delete clip.tracks[pid];
    }
  }
}

function cloneTracks(tracks) {
  const out = {};
  for (const [pid, t] of Object.entries(tracks)) {
    out[pid] = {};
    for (const [prop, keys] of Object.entries(t)) out[pid][prop] = keys.map(k => ({ f: k.f, v: [...k.v] }));
  }
  return out;
}

const UP = new THREE.Vector3(0, 1, 0);

export function boneLength(part) {
  return Math.hypot(part.offset[0], part.offset[1], part.offset[2]);
}

function vec(v, fallback) {
  if (Array.isArray(v) && v.length === 3 && v.every(n => Number.isFinite(Number(n)))) return v.map(Number);
  return [...fallback];
}

function round(arr) {
  return arr.map(v => Math.round(v * 1000) / 1000);
}

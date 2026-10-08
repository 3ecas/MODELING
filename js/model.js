// The document: a flat list of parts with optional parenting, mirrored into a Three.js scene graph.
// Each part is a pivot Group (position + rotation) holding a Mesh (size via scale, offset via position).
// Children attach to the pivot, so a parent's size never distorts its children.

import * as THREE from 'three';
import { PART_TYPES, PALETTE, getGeometry, clampSides } from './parts.js';

export const FORMAT_VERSION = 1;

export class Model {
  constructor(root) {
    this.root = root;            // THREE.Group that holds every top-level pivot
    this.parts = new Map();      // id -> part
    this.name = 'untitled';
    this._nextId = 1;
    this.wireframe = false;
    this.listeners = new Set();
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(kind, part) { for (const fn of this.listeners) fn(kind, part); }

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
      offset: vec(data.offset, [0, 0, 0]),
      sides: def.hasSides ? clampSides(data.sides ?? def.defaultSides) : 0,
      color: typeof data.color === 'string' ? data.color : PALETTE[0],
      visible: data.visible !== false,
      parent: data.parent ?? null,
    };

    const material = new THREE.MeshLambertMaterial({ color: part.color, flatShading: true });
    const mesh = new THREE.Mesh(getGeometry(part.type, part.sides), material);
    mesh.name = part.name;
    mesh.userData.partId = id;
    mesh.castShadow = mesh.receiveShadow = true;

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
    this.emit('remove', part);
  }

  clear() {
    for (const part of [...this.parts.values()]) {
      part.pivot.removeFromParent();
      part.mesh.material.dispose();
    }
    this.parts.clear();
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
    for (const k of ['name', 'color', 'visible']) if (patch[k] !== undefined) part[k] = patch[k];
    for (const k of ['position', 'rotation', 'size', 'offset']) if (patch[k]) part[k] = vec(patch[k], part[k]);
    if (geometryChanged) part.sides = clampSides(patch.sides);
    if (patch.size) part.size = part.size.map(v => Math.max(0.01, v));
    this.apply(part);
    this.emit('update', part);
  }

  /** Pushes the data of a part into its Three.js objects. */
  apply(part) {
    const { pivot, mesh } = part;
    pivot.position.fromArray(part.position);
    pivot.rotation.set(...part.rotation.map(THREE.MathUtils.degToRad));
    pivot.visible = part.visible;
    pivot.name = part.name;
    mesh.name = part.name;
    mesh.scale.fromArray(part.size);
    mesh.position.fromArray(part.offset);
    const geo = getGeometry(part.type, part.sides);
    if (mesh.geometry !== geo) mesh.geometry = geo;
    mesh.material.color.set(part.color);
    mesh.material.wireframe = this.wireframe;
  }

  /** Reads the Three.js objects back into the data (after a gizmo drag). */
  readBack(part) {
    const { pivot, mesh } = part;
    part.position = round(pivot.position.toArray());
    part.rotation = round([pivot.rotation.x, pivot.rotation.y, pivot.rotation.z].map(THREE.MathUtils.radToDeg));
    part.size = round(mesh.scale.toArray()).map(v => Math.max(0.01, v));
    mesh.scale.fromArray(part.size);
    this.emit('update', part);
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
    return {
      id: p.id, name: p.name, type: p.type,
      position: [...p.position], rotation: [...p.rotation], size: [...p.size], offset: [...p.offset],
      sides: p.sides, color: p.color, visible: p.visible, parent: p.parent,
    };
  }

  toJSON() {
    return {
      format: 'blocky-model',
      version: FORMAT_VERSION,
      name: this.name,
      parts: this.ordered().map(({ part }) => this.serializePart(part)),
    };
  }

  fromJSON(json) {
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
    this.emit('load');
  }
}

function vec(v, fallback) {
  if (Array.isArray(v) && v.length === 3 && v.every(n => Number.isFinite(Number(n)))) return v.map(Number);
  return [...fallback];
}

function round(arr) {
  return arr.map(v => Math.round(v * 1000) / 1000);
}

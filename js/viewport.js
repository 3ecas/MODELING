// Renderer, camera, lights, grid, orbit + transform gizmo, picking, box-select and selection outlines.
// The selection is a list of parts; the last one is the active part. With several parts selected the
// gizmo drives a hidden pivot at their centre and the delta is applied to every selected part.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { isBone } from './parts.js';

const SNAP = { translate: 0.05, rotate: THREE.MathUtils.degToRad(15), scale: 0.05 };
const ACTIVE_COLOR = 0xf2b43c, SELECTED_COLOR = 0xffe9b0;

export class Viewport {
  constructor(canvas, model) {
    this.canvas = canvas;
    this.model = model;
    this.selection = [];
    this.mode = 'translate';
    this.pixel = false;
    this.pickHandlers = [];
    this.marqueeHandlers = [];
    this.transformEndHandlers = [];
    this.dragHandlers = [];
    this.frameHandlers = [];
    this.clock = new THREE.Clock();

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setClearColor(0x2a2e36);
    this.renderer.shadowMap.enabled = false;

    this.scene = new THREE.Scene();
    this.scene.add(model.root);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
    this.camera.position.set(3.5, 2.6, 4.5);

    // Lighting that reads well on flat facets: a soft sky/ground pair plus one key light.
    this.scene.add(new THREE.HemisphereLight(0xdfe6f0, 0x3a3025, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(4, 7, 3);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xbcd0ff, 0.35);
    fill.position.set(-5, 2, -4);
    this.scene.add(fill);

    this.grid = new THREE.Group();
    const grid = new THREE.GridHelper(10, 20, 0x5a6170, 0x3b414d);
    const axes = new THREE.AxesHelper(1);
    axes.position.y = 0.002;
    this.grid.add(grid, axes);
    this.scene.add(this.grid);

    this.orbit = new OrbitControls(this.camera, canvas);
    this.orbit.target.set(0, 0.9, 0);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.12;
    this.orbit.maxPolarAngle = Math.PI * 0.95;
    this.orbit.update();

    // Hidden pivot the gizmo drives when several parts are selected.
    this.multiPivot = new THREE.Object3D();
    this.multiPivot.name = 'multi-selection pivot';
    this.scene.add(this.multiPivot);
    this._multiStart = null;

    this.gizmo = new TransformControls(this.camera, canvas);
    this.gizmo.setSize(0.9);
    this.gizmo.addEventListener('dragging-changed', e => {
      this.orbit.enabled = !e.value;
      const parts = this.transformTargets();
      if (e.value) {
        this._dragged = true;
        if (this.mode === 'anchor') this._beginAnchor(parts[0]);
        else if (this.selection.length > 1) this._beginMulti(parts);
      }
      this.dragHandlers.forEach(fn => fn(!!e.value, parts));
      if (!e.value) {
        this._multiStart = null;
        this._anchorStart = null;
        if (parts.length) this.transformEndHandlers.forEach(fn => fn(parts, this.mode));
        if (this.selection.length > 1 && this.mode !== 'anchor') this._attachGizmo(); // re-centre the pivot
      }
    });
    this.gizmo.addEventListener('objectChange', () => {
      if (this._multiStart) this._applyMulti();
      else if (this._anchorStart) this._applyAnchor();
    });
    this.scene.add(this.gizmo);
    this.setSnap(true);

    this.outlines = [];
    this.anchors = []; // small markers at the pivot of every selected part
    this._anchorGeometry = new THREE.OctahedronGeometry(1);

    this.raycaster = new THREE.Raycaster();
    this._setupPicking();
    this._setupMarquee();

    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(canvas.parentElement);
    this.resize();

    this._animate = this._animate.bind(this);
    requestAnimationFrame(this._animate);
  }

  // ----- events -----

  /** fn(part | null, pointerEvent) on a click in the viewport. */
  onPick(fn) { this.pickHandlers.push(fn); }
  /** fn(parts[], pointerEvent) after a Shift+drag box-select. */
  onMarquee(fn) { this.marqueeHandlers.push(fn); }
  /** fn(parts[], mode) after a gizmo drag ends; `parts` are the parts that were moved. */
  onTransformEnd(fn) { this.transformEndHandlers.push(fn); }
  /** fn(isDragging, parts[]) when a gizmo drag starts or ends. */
  onDrag(fn) { this.dragHandlers.push(fn); }
  /** fn(dtSeconds) once per rendered frame, before rendering. */
  onFrame(fn) { this.frameHandlers.push(fn); }

  _setupPicking() {
    let down = null;
    this.canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0) { down = null; return; }
      down = [e.clientX, e.clientY];
      this._dragged = false;
    });
    this.canvas.addEventListener('pointerup', e => {
      if (!down || e.button !== 0) return;
      const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]);
      down = null;
      if (moved > 4 || this._dragged || this.gizmo.axis) return;
      const part = this.pick(e.clientX, e.clientY);
      this.pickHandlers.forEach(fn => fn(part, e));
    });
  }

  /** Shift+drag on the canvas draws a rectangle; parts whose centre falls inside are reported. */
  _setupMarquee() {
    const box = document.createElement('div');
    box.className = 'marquee';
    box.hidden = true;
    this.canvas.parentElement.appendChild(box);
    let start = null, active = false;

    // Capture phase: runs before OrbitControls sees the event, so we can keep it from panning.
    this.canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0 || !e.shiftKey || this.gizmo.axis || this.gizmo.dragging) return;
      start = [e.clientX, e.clientY];
      active = false;
      this.orbit.enabled = false;
    }, { capture: true });

    this.canvas.addEventListener('pointermove', e => {
      if (!start) return;
      if (!active && Math.hypot(e.clientX - start[0], e.clientY - start[1]) < 4) return;
      active = true;
      const r = this.canvas.getBoundingClientRect();
      const x0 = Math.min(start[0], e.clientX) - r.left, y0 = Math.min(start[1], e.clientY) - r.top;
      box.style.left = `${x0}px`;
      box.style.top = `${y0}px`;
      box.style.width = `${Math.abs(e.clientX - start[0])}px`;
      box.style.height = `${Math.abs(e.clientY - start[1])}px`;
      box.hidden = false;
    });

    const finish = e => {
      if (!start) return;
      const s = start, was = active;
      start = null; active = false;
      box.hidden = true;
      this.orbit.enabled = !this.gizmo.dragging;
      if (was) {
        this._dragged = true; // not a click
        const parts = this.partsInRect(s, [e.clientX, e.clientY]);
        this.marqueeHandlers.forEach(fn => fn(parts, e));
      }
    };
    this.canvas.addEventListener('pointerup', finish);
    this.canvas.addEventListener('pointercancel', finish);
  }

  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObject(this.model.root, true);
    // Bones draw on top of the body (x-ray), so when they are shown they win the pick.
    let meshHit = null;
    for (const h of hits) {
      if (!h.object.isMesh || !h.object.visible) continue;
      const part = this.model.partFromObject(h.object);
      if (!part || !this.model.isShown(part)) continue;
      if (isBone(part)) { if (this.model.showBones) return part; continue; }
      if (!meshHit) meshHit = part;
    }
    return meshHit;
  }

  /** Parts whose centre projects inside the screen rectangle (bones only when shown). */
  partsInRect(a, b) {
    const rect = this.canvas.getBoundingClientRect();
    const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
    const v = new THREE.Vector3();
    const out = [];
    for (const part of this.model.parts.values()) {
      if (!this.model.isShown(part)) continue;
      if (isBone(part) && !this.model.showBones) continue;
      (isBone(part) ? part.pivot : part.mesh).getWorldPosition(v).project(this.camera);
      if (v.z > 1) continue; // behind the camera
      const sx = rect.left + (v.x + 1) / 2 * rect.width, sy = rect.top + (1 - v.y) / 2 * rect.height;
      if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) out.push(part);
    }
    return out;
  }

  // ----- selection + gizmo -----

  /** The active part (last selected), or null. */
  get selected() { return this.selection.length ? this.selection[this.selection.length - 1] : null; }

  /** Selects one part, an array of parts, or nothing. */
  select(parts) {
    this.selection = (Array.isArray(parts) ? parts : [parts]).filter(Boolean);
    this._attachGizmo();
    this._rebuildOutlines();
  }

  /** 'translate' | 'rotate' | 'scale' | 'anchor' (anchor drags the pivot point; the shape stays). */
  setMode(mode) {
    this.mode = mode;
    this.gizmo.setMode(mode === 'anchor' ? 'translate' : mode);
    this._attachGizmo();
  }

  /** Selected parts that have no selected ancestor: moving those moves the whole selection once. */
  transformTargets() {
    const sel = this.selection;
    if (this.mode === 'anchor') return this.selected ? [this.selected] : [];
    if (sel.length <= 1) return sel.filter(p => !(this.mode === 'scale' && isBone(p)));
    const ids = new Set(sel.map(p => p.id));
    return sel.filter(p => {
      let q = p.parent != null ? this.model.parts.get(p.parent) : null;
      while (q) { if (ids.has(q.id)) return false; q = q.parent != null ? this.model.parts.get(q.parent) : null; }
      return true;
    });
  }

  _attachGizmo() {
    const sel = this.selection;
    if (!sel.length) { this.gizmo.detach(); return; }

    if (this.mode === 'anchor') {
      // The anchor tool edits one part at a time: the active one.
      this.gizmo.attach(this.selected.pivot);
      this.gizmo.setSpace('world');
      return;
    }

    if (sel.length === 1) {
      const p = sel[0];
      if (this.mode === 'scale' && isBone(p)) { this.gizmo.detach(); return; } // bones have no size to drag
      // Move/rotate act on the pivot (the joint); size acts on the mesh so children are not distorted.
      this.gizmo.attach(this.mode === 'scale' ? p.mesh : p.pivot);
      this.gizmo.setSpace(this.mode === 'scale' ? 'local' : 'world');
      return;
    }

    // Several parts: a world-aligned pivot at the centre of the parts that will move.
    const parts = this.transformTargets();
    const c = new THREE.Vector3(), v = new THREE.Vector3();
    for (const p of parts) c.add(p.pivot.getWorldPosition(v));
    if (parts.length) c.divideScalar(parts.length);
    this.multiPivot.position.copy(c);
    this.multiPivot.quaternion.identity();
    this.multiPivot.scale.set(1, 1, 1);
    this.multiPivot.updateMatrixWorld(true);
    this.gizmo.attach(this.multiPivot);
    this.gizmo.setSpace('world');
  }

  _beginMulti(parts) {
    const mp = this.multiPivot;
    const entries = parts.map(part => {
      const parent = part.pivot.parent;
      parent.updateWorldMatrix(true, false);
      const parentInv = parent.matrixWorld.clone().invert();
      const parentQuatInv = parent.getWorldQuaternion(new THREE.Quaternion()).invert();
      return {
        part, parentInv, parentQuatInv,
        worldPos: part.pivot.getWorldPosition(new THREE.Vector3()),
        worldQuat: part.pivot.getWorldQuaternion(new THREE.Quaternion()),
        size: part.mesh.scale.toArray(),
      };
    });
    this._multiStart = { pos: mp.position.clone(), quat: mp.quaternion.clone(), parts: entries };
  }

  /** Applies the pivot's change since drag start to every moved part. */
  _applyMulti() {
    const s = this._multiStart, mp = this.multiPivot;
    const w = new THREE.Vector3(), wq = new THREE.Quaternion();
    if (this.mode === 'translate') {
      const delta = mp.position.clone().sub(s.pos);
      for (const e of s.parts) e.part.pivot.position.copy(w.copy(e.worldPos).add(delta).applyMatrix4(e.parentInv));
    } else if (this.mode === 'rotate') {
      const dq = mp.quaternion.clone().multiply(s.quat.clone().invert());
      for (const e of s.parts) {
        w.copy(e.worldPos).sub(s.pos).applyQuaternion(dq).add(s.pos);
        e.part.pivot.position.copy(w.applyMatrix4(e.parentInv));
        wq.copy(dq).multiply(e.worldQuat);
        e.part.pivot.quaternion.copy(e.parentQuatInv.clone().multiply(wq));
      }
    } else {
      const f = mp.scale;
      for (const e of s.parts) {
        w.copy(e.worldPos).sub(s.pos).multiply(f).add(s.pos);
        e.part.pivot.position.copy(w.applyMatrix4(e.parentInv));
        if (!isBone(e.part)) {
          e.part.mesh.scale.set(
            Math.max(0.01, e.size[0] * f.x), Math.max(0.01, e.size[1] * f.y), Math.max(0.01, e.size[2] * f.z));
        }
      }
    }
  }

  /** Anchor drag: the pivot moves with the gizmo; shape, children and keys are compensated live. */
  _beginAnchor(part) {
    if (!part) return;
    this._anchorStart = { part, last: part.pivot.position.clone() };
  }

  _applyAnchor() {
    const s = this._anchorStart;
    const part = s.part;
    const dParent = part.pivot.position.clone().sub(s.last);
    if (dParent.lengthSq() === 0) return;
    // The gizmo moved the pivot in the parent's frame; express that step in the part's own frame.
    const p = dParent.applyQuaternion(new THREE.Quaternion().setFromEuler(part.pivot.rotation).invert());
    this.model.moveAnchor(part.id, p.toArray());
    s.last.copy(part.pivot.position);
  }

  _rebuildOutlines() {
    for (const o of this.outlines) { this.scene.remove(o); o.geometry.dispose(); o.material.dispose(); }
    this.outlines = [];
    for (const a of this.anchors) { this.scene.remove(a); a.material.dispose(); }
    this.anchors = [];
    for (const p of this.selection) {
      const a = new THREE.Mesh(this._anchorGeometry, new THREE.MeshBasicMaterial({ color: p === this.selected ? ACTIVE_COLOR : SELECTED_COLOR, depthTest: false, transparent: true, opacity: 0.95 }));
      a.renderOrder = 1001;
      a.userData.part = p;
      this.scene.add(a);
      this.anchors.push(a);
    }
    const active = this.selected;
    for (const p of this.selection) {
      const o = new THREE.BoxHelper(p.mesh, p === active ? ACTIVE_COLOR : SELECTED_COLOR);
      o.material.depthTest = false;
      o.material.transparent = p !== active;
      o.material.opacity = p === active ? 1 : 0.6;
      this.scene.add(o);
      this.outlines.push(o);
    }
  }

  setSnap(on) {
    this.gizmo.setTranslationSnap(on ? SNAP.translate : null);
    this.gizmo.setRotationSnap(on ? SNAP.rotate : null);
    this.gizmo.setScaleSnap(on ? SNAP.scale : null);
  }

  // ----- view -----

  setView(name) {
    const target = this._focusPoint();
    const d = Math.max(3, this.camera.position.distanceTo(this.orbit.target));
    const pos = {
      front: [0, 0, d], side: [d, 0, 0], top: [0, d, 0.0001], persp: [d * 0.62, d * 0.46, d * 0.8],
    }[name] || [d * 0.62, d * 0.46, d * 0.8];
    this.camera.position.set(target.x + pos[0], target.y + pos[1], target.z + pos[2]);
    this.orbit.target.copy(target);
    this.orbit.update();
  }

  focus() {
    const target = this._focusPoint();
    const box = this._selectionBox();
    if (box.isEmpty()) box.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1));
    const size = box.getSize(new THREE.Vector3()).length() || 1;
    const dir = this.camera.position.clone().sub(this.orbit.target).normalize();
    this.camera.position.copy(target).add(dir.multiplyScalar(size * 1.6 + 0.5));
    this.orbit.target.copy(target);
    this.orbit.update();
  }

  _selectionBox() {
    const box = new THREE.Box3();
    if (this.selection.length) for (const p of this.selection) box.expandByObject(p.mesh);
    else if (this.model.parts.size) box.setFromObject(this.model.root);
    return box;
  }

  _focusPoint() {
    const box = this._selectionBox();
    if (box.isEmpty()) return new THREE.Vector3(0, 0.9, 0);
    return box.getCenter(new THREE.Vector3());
  }

  setPixel(on) {
    this.pixel = !!on;
    this.canvas.classList.toggle('pixel', this.pixel);
    this.resize();
  }

  setGrid(on) { this.grid.visible = !!on; }
  setBones(on) { this.model.setShowBones(on); }

  resize() {
    const el = this.canvas.parentElement;
    const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight);
    this.renderer.setPixelRatio(this.pixel ? 0.25 : Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _animate() {
    requestAnimationFrame(this._animate);
    const dt = Math.min(this.clock.getDelta(), 0.1);
    for (const fn of this.frameHandlers) fn(dt);
    this.orbit.update();
    for (const o of this.outlines) o.update();
    for (const a of this.anchors) {
      a.userData.part.pivot.getWorldPosition(a.position);
      const d = a.position.distanceTo(this.camera.position);
      a.scale.setScalar(d * (this.mode === 'anchor' ? 0.014 : 0.009)); // constant size on screen
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** Rough triangle count of visible parts, for the status bar. */
  triangleCount() {
    let n = 0;
    for (const p of this.model.parts.values()) {
      if (!p.visible || isBone(p)) continue;
      n += p.mesh.geometry.attributes.position.count / 3;
    }
    return n;
  }
}

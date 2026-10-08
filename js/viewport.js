// Renderer, camera, lights, grid, orbit + transform gizmo, picking and the selection outline.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { isBone } from './parts.js';

const SNAP = { translate: 0.05, rotate: THREE.MathUtils.degToRad(15), scale: 0.05 };

export class Viewport {
  constructor(canvas, model) {
    this.canvas = canvas;
    this.model = model;
    this.selected = null;
    this.mode = 'translate';
    this.pixel = false;
    this.pickHandlers = [];
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

    this.gizmo = new TransformControls(this.camera, canvas);
    this.gizmo.setSize(0.9);
    this.gizmo.addEventListener('dragging-changed', e => {
      this.orbit.enabled = !e.value;
      if (e.value) this._dragged = true;
      this.dragHandlers.forEach(fn => fn(!!e.value, this.selected));
      if (!e.value && this.selected) this.transformEndHandlers.forEach(fn => fn(this.selected, this.mode));
    });
    this.scene.add(this.gizmo);
    this.setSnap(true);

    this.outline = new THREE.BoxHelper(new THREE.Object3D(), 0xf2b43c);
    this.outline.visible = false;
    this.outline.material.depthTest = false;
    this.scene.add(this.outline);

    this.raycaster = new THREE.Raycaster();
    this._setupPicking();

    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(canvas.parentElement);
    this.resize();

    this._animate = this._animate.bind(this);
    requestAnimationFrame(this._animate);
  }

  // ----- events -----

  onPick(fn) { this.pickHandlers.push(fn); }
  /** fn(part, mode) after a gizmo drag ends. */
  onTransformEnd(fn) { this.transformEndHandlers.push(fn); }
  /** fn(isDragging, part) when a gizmo drag starts or ends. */
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

  // ----- selection + gizmo -----

  select(part) {
    this.selected = part || null;
    this._attachGizmo();
  }

  setMode(mode) {
    this.mode = mode;
    this.gizmo.setMode(mode);
    this._attachGizmo();
  }

  _attachGizmo() {
    const p = this.selected;
    if (!p) { this.gizmo.detach(); this.outline.visible = false; return; }
    if (this.mode === 'scale' && isBone(p)) {
      // Bones have no size to drag; keep the outline so the selection stays visible.
      this.gizmo.detach();
      this.outline.setFromObject(p.mesh);
      this.outline.visible = true;
      return;
    }
    // Move/rotate act on the pivot (the joint); size acts on the mesh so children are not distorted.
    this.gizmo.attach(this.mode === 'scale' ? p.mesh : p.pivot);
    this.gizmo.setSpace(this.mode === 'scale' ? 'local' : 'world');
    this.outline.setFromObject(p.mesh);
    this.outline.visible = true;
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
    const box = new THREE.Box3();
    if (this.selected) box.setFromObject(this.selected.mesh);
    else if (this.model.parts.size) box.setFromObject(this.model.root);
    else box.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1));
    const size = box.getSize(new THREE.Vector3()).length() || 1;
    const dir = this.camera.position.clone().sub(this.orbit.target).normalize();
    this.camera.position.copy(target).add(dir.multiplyScalar(size * 1.6 + 0.5));
    this.orbit.target.copy(target);
    this.orbit.update();
  }

  _focusPoint() {
    const box = new THREE.Box3();
    if (this.selected) box.setFromObject(this.selected.mesh);
    else if (this.model.parts.size) box.setFromObject(this.model.root);
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
    if (this.selected && this.outline.visible) this.outline.update();
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

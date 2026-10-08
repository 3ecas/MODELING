// Save / load project files and export to game-ready formats.
//
// Two GLB flavours:
//   skinned  one SkinnedMesh per character with a real skeleton (bones = glTF joints, every vertex
//            rigidly bound to its bone) and all clips baked as skeletal animation. This is what a
//            game wants: one draw call per colour, bones you can look up by name, clones that share
//            the skeleton and the animations.
//   parts    one node per part, as in the editor (handy for Blender or further editing).
// Both use the rest pose, whatever clip is active in the editor.

import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { sample } from './animation.js';
import { isBone } from './parts.js';

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeName(name) {
  return (name || 'model').trim().replace(/[^\w\-]+/g, '_') || 'model';
}

export function saveProject(model) {
  const json = JSON.stringify(model.toJSON(), null, 2);
  download(new Blob([json], { type: 'application/json' }), `${safeName(model.name)}.json`);
}

export function readProjectFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      try {
        const json = JSON.parse(reader.result);
        if (!json || !Array.isArray(json.parts)) throw new Error('Not a Blocky project file');
        resolve(json);
      } catch (e) { reject(e); }
    };
    reader.readAsText(file);
  });
}

// ----- shared helpers -----

const DEG = THREE.MathUtils.degToRad;

/** Parts that are visible (with all ancestors), parents before children. */
function shownParts(model) {
  return model.ordered().map(o => o.part).filter(p => model.isShown(p));
}

function materialFor(cache, color) {
  if (!cache.has(color)) {
    cache.set(color, new THREE.MeshStandardMaterial({
      color, metalness: 0, roughness: 1, flatShading: true, name: `color_${color.slice(1)}`,
    }));
  }
  return cache.get(color);
}

function setRest(obj, part) {
  obj.position.fromArray(part.position);
  obj.rotation.set(...part.rotation.map(DEG));
}

/** Adds one node per part of `tree` under `parent` (bones become empty nodes). */
function addPartNodes(tree, parent, materials, nodes) {
  const pivots = new Map();
  for (const part of tree) {
    const pivot = new THREE.Group();
    pivot.name = part.name;
    setRest(pivot, part);
    let mesh = null;
    if (!isBone(part)) {
      mesh = new THREE.Mesh(part.mesh.geometry, materialFor(materials, part.color));
      mesh.name = `${part.name} mesh`;
      mesh.position.fromArray(part.offset);
      mesh.scale.fromArray(part.size);
      pivot.add(mesh);
    }
    (part.parent != null && pivots.has(part.parent) ? pivots.get(part.parent) : parent).add(pivot);
    pivots.set(part.id, pivot);
    nodes.set(part.id, { pivot, mesh: mesh || pivot });
  }
}

/** The "parts" scene: the editor hierarchy with rest transforms. */
function exportSceneParts(model) {
  const root = new THREE.Group();
  root.name = safeName(model.name);
  const nodes = new Map();
  addPartNodes(shownParts(model), root, new Map(), nodes);
  root.updateMatrixWorld(true);
  return { root, nodes };
}

/**
 * The "skinned" scene. Joints are every bone, every animated part, and their ancestors. Each
 * top-level tree that contains a joint becomes a SkinnedMesh whose vertices are rigidly bound to
 * the nearest joint; trees without joints are exported as plain static nodes.
 */
function exportSceneSkinned(model, { vertexColors = false } = {}) {
  const root = new THREE.Group();
  root.name = safeName(model.name);
  const nodes = new Map();
  const materials = new Map();
  const shown = shownParts(model);
  const { meshWorld } = model.restMatrices();

  const animated = new Set();
  for (const clip of model.animations) for (const pid of Object.keys(clip.tracks)) animated.add(Number(pid));
  const joints = new Set();
  for (const part of shown) {
    if (!isBone(part) && !animated.has(part.id)) continue;
    let p = part;
    while (p) { joints.add(p.id); p = p.parent != null ? model.parts.get(p.parent) : null; }
  }

  const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3(), col = new THREE.Color();

  for (const top of shown.filter(p => p.parent == null)) {
    const tree = shown.filter(p => p === top || model.isDescendant(p.id, top.id));
    if (!joints.has(top.id)) { addPartNodes(tree, root, materials, nodes); continue; }

    // Skeleton
    const bones = [];
    const boneOf = new Map();
    for (const part of tree) {
      if (!joints.has(part.id)) continue;
      const b = new THREE.Bone();
      b.name = part.name;
      setRest(b, part);
      if (part.parent != null) boneOf.get(part.parent).add(b); // a joint's parent is always a joint
      boneOf.set(part.id, b);
      bones.push(b);
      nodes.set(part.id, { pivot: b, mesh: b });
    }

    // Merged, rigidly skinned geometry: vertices in the character's bind space (rest pose, world).
    const entries = tree
      .filter(p => !isBone(p))
      .map(p => ({ part: p, joint: bones.indexOf(boneOf.get(model.nearest(p, q => joints.has(q.id)).id)) }));
    entries.sort((a, b) => (a.part.color < b.part.color ? -1 : a.part.color > b.part.color ? 1 : 0));

    const positions = [], normals = [], skinIndex = [], skinWeight = [], colors = [];
    const groups = [];
    const colorList = [];
    for (const { part, joint } of entries) {
      const geo = part.mesh.geometry;
      const M = meshWorld.get(part.id);
      nm.getNormalMatrix(M);
      const pos = geo.attributes.position, nor = geo.attributes.normal;
      const start = positions.length / 3;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(M);
        n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
        positions.push(v.x, v.y, v.z);
        normals.push(n.x, n.y, n.z);
        skinIndex.push(joint, 0, 0, 0);
        skinWeight.push(1, 0, 0, 0);
        if (vertexColors) { col.set(part.color); colors.push(col.r, col.g, col.b); }
      }
      let mi = colorList.indexOf(part.color);
      if (mi < 0) { colorList.push(part.color); mi = colorList.length - 1; }
      const last = groups[groups.length - 1];
      if (last && last.materialIndex === mi) last.count += pos.count;
      else groups.push({ start, count: pos.count, materialIndex: mi });
    }
    if (!positions.length) { addPartNodes(tree, root, materials, nodes); continue; }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
    if (vertexColors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex([...Array(positions.length / 3).keys()]); // groups need an index to become primitives

    let material;
    if (vertexColors) {
      material = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0, roughness: 1, flatShading: true, name: 'vertex_colors' });
    } else {
      material = colorList.map(c => materialFor(materials, c));
      for (const g of groups) geometry.addGroup(g.start, g.count, g.materialIndex);
    }

    const mesh = new THREE.SkinnedMesh(geometry, material);
    const characters = shown.filter(p => p.parent == null && p.recipe);
    mesh.name = top.recipe ? (characters.length > 1 ? `character ${characters.indexOf(top) + 1}` : 'character') : `${top.name} skin`;
    mesh.add(bones[0]);
    root.add(mesh);
    root.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(bones); // inverse bind matrices from the current (rest) pose
    mesh.bind(skeleton);
  }
  root.updateMatrixWorld(true);
  return { root, nodes };
}

/**
 * Converts the document's clips into Three.js AnimationClips targeting the exported nodes.
 * Every frame is baked, so the in-app easing is reproduced exactly in any engine.
 */
export function buildAnimationClips(model, nodes) {
  const clips = [];
  const euler = new THREE.Euler(), q = new THREE.Quaternion();
  for (const clip of model.animations) {
    const tracks = [];
    for (const [pid, track] of Object.entries(clip.tracks)) {
      const n = nodes.get(Number(pid));
      if (!n) continue;
      const times = [];
      for (let f = 0; f <= clip.length; f++) times.push(f / clip.fps);
      for (const prop of ['position', 'rotation', 'size']) {
        if (!track[prop] || !track[prop].length) continue;
        const values = [];
        for (let f = 0; f <= clip.length; f++) {
          const v = sample(clip, Number(pid), prop, f);
          if (prop === 'rotation') {
            euler.set(...v.map(DEG));
            q.setFromEuler(euler);
            values.push(q.x, q.y, q.z, q.w);
          } else values.push(...v);
        }
        if (prop === 'position') tracks.push(new THREE.VectorKeyframeTrack(`${n.pivot.uuid}.position`, times, values));
        else if (prop === 'rotation') tracks.push(new THREE.QuaternionKeyframeTrack(`${n.pivot.uuid}.quaternion`, times, values));
        else tracks.push(new THREE.VectorKeyframeTrack(`${n.mesh.uuid}.scale`, times, values));
      }
    }
    if (tracks.length) clips.push(new THREE.AnimationClip(clip.name, clip.length / clip.fps, tracks));
  }
  return clips;
}

/**
 * Exports a binary glTF. Resolves with the ArrayBuffer (also downloads unless `silent`).
 * @param {object} opts  { silent, animations, mode: 'skinned' | 'parts', vertexColors }
 */
export function exportGLB(model, { silent = false, animations = true, mode = 'skinned', vertexColors = false } = {}) {
  const { root, nodes } = mode === 'parts' ? exportSceneParts(model) : exportSceneSkinned(model, { vertexColors });
  const clips = animations ? buildAnimationClips(model, nodes) : [];
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(
      root,
      result => {
        if (!silent) download(new Blob([result], { type: 'model/gltf-binary' }), `${safeName(model.name)}${mode === 'parts' ? '_parts' : ''}.glb`);
        resolve(result);
      },
      err => reject(err),
      { binary: true, onlyVisible: true, animations: clips },
    );
  });
}

/** Exports Wavefront OBJ (geometry only: no colours, bones or animation). Returns the text. */
export function exportOBJ(model, { silent = false } = {}) {
  const { root: scene } = exportSceneParts(model);
  const text = new OBJExporter().parse(scene);
  if (!silent) download(new Blob([text], { type: 'text/plain' }), `${safeName(model.name)}.obj`);
  return text;
}

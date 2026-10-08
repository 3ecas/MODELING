// Save / load project files and export to game-ready formats.

import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { sample } from './animation.js';

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

/**
 * Builds an export-only copy of the model with standard materials, so every engine
 * reads the flat colours the same way. Hidden parts are left out.
 */
function exportScene(model) {
  const root = new THREE.Group();
  root.name = safeName(model.name);
  const map = new Map(); // part id -> exported pivot
  const nodes = new Map(); // part id -> { pivot, mesh }
  const materials = new Map();

  for (const { part } of model.ordered()) {
    if (!part.visible) continue;
    if (part.parent != null && !map.has(part.parent)) continue; // parent hidden

    const pivot = new THREE.Group();
    pivot.name = part.name;
    pivot.position.copy(part.pivot.position);
    pivot.rotation.copy(part.pivot.rotation);

    if (!materials.has(part.color)) {
      materials.set(part.color, new THREE.MeshStandardMaterial({
        color: part.color, metalness: 0, roughness: 1, flatShading: true, name: `color_${part.color.slice(1)}`,
      }));
    }
    const mesh = new THREE.Mesh(part.mesh.geometry, materials.get(part.color));
    mesh.name = `${part.name} mesh`;
    mesh.position.copy(part.mesh.position);
    mesh.scale.copy(part.mesh.scale);
    pivot.add(mesh);

    (part.parent != null ? map.get(part.parent) : root).add(pivot);
    map.set(part.id, pivot);
    nodes.set(part.id, { pivot, mesh });
  }
  root.updateMatrixWorld(true);
  return { root, nodes };
}

/**
 * Converts the document's clips into Three.js AnimationClips for the export scene.
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
            euler.set(...v.map(THREE.MathUtils.degToRad));
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

/** Exports a binary glTF. Resolves with the ArrayBuffer (also downloads unless `silent`). */
export function exportGLB(model, { silent = false, animations = true } = {}) {
  const { root, nodes } = exportScene(model);
  const clips = animations ? buildAnimationClips(model, nodes) : [];
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(
      root,
      result => {
        if (!silent) download(new Blob([result], { type: 'model/gltf-binary' }), `${safeName(model.name)}.glb`);
        resolve(result);
      },
      err => reject(err),
      { binary: true, onlyVisible: true, animations: clips },
    );
  });
}

/** Exports Wavefront OBJ (geometry only, no colours or animation). Returns the text. */
export function exportOBJ(model, { silent = false } = {}) {
  const { root: scene } = exportScene(model);
  const text = new OBJExporter().parse(scene);
  if (!silent) download(new Blob([text], { type: 'text/plain' }), `${safeName(model.name)}.obj`);
  return text;
}

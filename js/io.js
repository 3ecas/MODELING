// Save / load project files and export to game-ready formats.

import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';

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
  }
  root.updateMatrixWorld(true);
  return root;
}

/** Exports a binary glTF. Resolves with the ArrayBuffer (also downloads unless `silent`). */
export function exportGLB(model, { silent = false } = {}) {
  const scene = exportScene(model);
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(
      scene,
      result => {
        if (!silent) download(new Blob([result], { type: 'model/gltf-binary' }), `${safeName(model.name)}.glb`);
        resolve(result);
      },
      err => reject(err),
      { binary: true, onlyVisible: true },
    );
  });
}

/** Exports Wavefront OBJ (geometry only, no colours). Returns the text. */
export function exportOBJ(model, { silent = false } = {}) {
  const scene = exportScene(model);
  const text = new OBJExporter().parse(scene);
  if (!silent) download(new Blob([text], { type: 'text/plain' }), `${safeName(model.name)}.obj`);
  return text;
}

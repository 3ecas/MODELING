// Part library: every shape is a unit-sized, low-poly, flat-shaded geometry.
// Size is applied through the mesh scale, so one geometry per (type, sides) is enough.

import * as THREE from 'three';

export const PART_TYPES = {
  box:      { label: 'Box',      hasSides: false, defaultSize: [1, 1, 1] },
  cylinder: { label: 'Cylinder', hasSides: true,  defaultSize: [1, 1, 1], defaultSides: 8 },
  cone:     { label: 'Cone',     hasSides: true,  defaultSize: [1, 1, 1], defaultSides: 6 },
  sphere:   { label: 'Sphere',   hasSides: true,  defaultSize: [1, 1, 1], defaultSides: 8 },
  wedge:    { label: 'Wedge',    hasSides: false, defaultSize: [1, 1, 1] },
  plane:    { label: 'Plane',    hasSides: false, defaultSize: [1, 0.02, 1] },
  // A bone is a joint of the skeleton: it has no exported geometry, only a pivot and a tip (stored in
  // `offset`). Parts attached to a bone move with it; on export, bones become glTF joints.
  bone:     { label: 'Bone',     hasSides: false, defaultSize: [0.08, 0.08, 0.08], isBone: true, defaultTip: [0, 0.25, 0] },
};

export const BONE_COLOR = '#8ad7ff';

export const isBone = part => !!(part && PART_TYPES[part.type]?.isBone);

// A compact old-school palette: skin tones, cloth, metals, nature.
export const PALETTE = [
  '#f4d7b5', '#e2b48e', '#c48a5a', '#8c5a34', '#5a3920', '#3a2415', '#f7f3e8', '#111111',
  '#d93a3a', '#b22a2a', '#e8762c', '#f2b43c', '#e6d94a', '#7bbf3f', '#3f8f3a', '#2a5f2a',
  '#3fb6b6', '#2f78c4', '#234a8f', '#1f2f5a', '#7a4fc9', '#b24fa3', '#e37aa5', '#8a8a8a',
  '#c9c9c9', '#5f5f5f', '#3a3a3a', '#b08a4a', '#d9b45a', '#8a6a3a', '#6b4e2e', '#4a3a2a',
];

const cache = new Map();

/** Returns a shared geometry for a part type and side count. */
export function getGeometry(type, sides) {
  const def = PART_TYPES[type] || PART_TYPES.box;
  const n = def.hasSides ? clampSides(sides ?? def.defaultSides) : 0;
  const key = `${type}:${n}`;
  if (!cache.has(key)) cache.set(key, build(type, n));
  return cache.get(key);
}

export function clampSides(n) {
  n = Math.round(Number(n) || 8);
  return Math.max(3, Math.min(32, n));
}

function build(type, n) {
  let g;
  switch (type) {
    case 'cylinder': g = new THREE.CylinderGeometry(0.5, 0.5, 1, n, 1, false); break;
    case 'cone':     g = new THREE.ConeGeometry(0.5, 1, n, 1, false); break;
    case 'sphere':   g = new THREE.SphereGeometry(0.5, n, Math.max(3, Math.ceil(n / 2))); break;
    case 'wedge':    g = wedgeGeometry(); break;
    case 'bone':     g = boneGeometry(); break;
    case 'plane':    g = new THREE.BoxGeometry(1, 1, 1); break;
    case 'box':
    default:         g = new THREE.BoxGeometry(1, 1, 1); break;
  }
  // Non-indexed + recomputed normals gives hard facets that survive export.
  if (g.index) g = g.toNonIndexed();
  g = dropDegenerateTriangles(g);
  g.computeVertexNormals();
  return g;
}

// Three's cone shares the cylinder code and emits zero-area triangles at the apex;
// they produce invalid normals in exporters, so strip them.
function dropDegenerateTriangles(g) {
  const p = g.attributes.position;
  const uv = g.attributes.uv;
  const keepPos = [], keepUv = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    const area = b.sub(a).cross(c.sub(a)).length();
    if (area < 1e-8) continue;
    for (let k = 0; k < 3; k++) {
      keepPos.push(p.getX(i + k), p.getY(i + k), p.getZ(i + k));
      if (uv) keepUv.push(uv.getX(i + k), uv.getY(i + k));
    }
  }
  if (keepPos.length === p.count * 3) return g;
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(keepPos, 3));
  if (uv) out.setAttribute('uv', new THREE.Float32BufferAttribute(keepUv, 2));
  return out;
}

// A triangular prism occupying the unit cube: the slope runs from the top-back edge to the bottom-front edge.
function wedgeGeometry() {
  const h = 0.5;
  // Triangle profile in the YZ plane, extruded along X.
  const tri = [
    [-h, -h], // bottom front (y, z)
    [-h,  h], // bottom back
    [ h,  h], // top back
  ];
  const pos = [];
  const push = (...pts) => pts.forEach(p => pos.push(...p));

  // Two end caps (x = -h and x = +h), wound so normals face outward.
  push([-h, tri[0][0], tri[0][1]], [-h, tri[2][0], tri[2][1]], [-h, tri[1][0], tri[1][1]]);
  push([ h, tri[0][0], tri[0][1]], [ h, tri[1][0], tri[1][1]], [ h, tri[2][0], tri[2][1]]);

  // Side quads between consecutive profile points.
  for (let i = 0; i < 3; i++) {
    const a = tri[i], b = tri[(i + 1) % 3];
    const p0 = [-h, a[0], a[1]], p1 = [h, a[0], a[1]], p2 = [h, b[0], b[1]], p3 = [-h, b[0], b[1]];
    push(p0, p2, p1);
    push(p0, p3, p2);
  }

  return outwardWinding(fromTriangles(pos), new THREE.Vector3(0, -h / 3, h / 3)); // centroid of the wedge
}

// A bone marker: an octahedron from the pivot (0,0,0) to the tip (0,1,0), fattest near the base.
// The model orients and stretches it to the bone's actual tip.
function boneGeometry() {
  const r = 0.5, y = 0.18;
  const base = [0, 0, 0], tip = [0, 1, 0];
  const ring = [[r, y, 0], [0, y, r], [-r, y, 0], [0, y, -r]];
  const pos = [];
  const push = (...pts) => pts.forEach(p => pos.push(...p));
  for (let i = 0; i < 4; i++) {
    const a = ring[i], b = ring[(i + 1) % 4];
    push(base, a, b);
    push(a, tip, b);
  }
  return outwardWinding(fromTriangles(pos), new THREE.Vector3(0, 0.4, 0));
}

function fromTriangles(pos) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// Makes every face point away from `center` (flips any triangle whose normal points inward).
function outwardWinding(g, center) {
  const p = g.attributes.position;
  const nrm = g.attributes.normal;
  const c = new THREE.Vector3(), nv = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    c.set(
      (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3,
      (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3,
      (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3,
    ).sub(center);
    nv.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
    if (nv.dot(c) < 0) {
      const x = p.getX(i + 1), y = p.getY(i + 1), z = p.getZ(i + 1);
      p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
      p.setXYZ(i + 2, x, y, z);
    }
  }
  g.computeVertexNormals();
  return g;
}

// Starter kits: a rigged low-poly humanoid (skeleton of bones with body parts attached), plus a
// randomiser for NPCs. The recipe is stored on the root bone, so the Character panel can regenerate
// the figure in place.

import { PALETTE } from './parts.js';

export const DEFAULT_RECIPE = {
  height: 1.0,     // overall scale
  build: 1.0,      // width of torso
  headSize: 1.0,
  limbs: 1.0,      // thickness of arms and legs
  armLength: 1.0,
  legLength: 1.0,
  skin: '#e2b48e',
  hair: '#5a3920',
  shirt: '#2f78c4',
  pants: '#3a3a3a',
  boots: '#4a3a2a',
  hat: false,
  weapon: false,
  shield: false,
  hairStyle: 'short', // 'short' | 'long' | 'bald'
};

/** Slider ranges for the Character panel. */
export const RECIPE_SLIDERS = [
  { key: 'height',    label: 'Height',     min: 0.6, max: 1.6 },
  { key: 'build',     label: 'Build',      min: 0.6, max: 1.6 },
  { key: 'headSize',  label: 'Head',       min: 0.7, max: 1.4 },
  { key: 'limbs',     label: 'Limbs',      min: 0.6, max: 1.6 },
  { key: 'armLength', label: 'Arm length', min: 0.6, max: 1.4 },
  { key: 'legLength', label: 'Leg length', min: 0.6, max: 1.4 },
];
export const RECIPE_COLORS = [
  { key: 'skin', label: 'Skin' }, { key: 'hair', label: 'Hair' }, { key: 'shirt', label: 'Shirt' },
  { key: 'pants', label: 'Pants' }, { key: 'boots', label: 'Boots' },
];
export const RECIPE_FLAGS = [
  { key: 'hat', label: 'Hat' }, { key: 'weapon', label: 'Sword' }, { key: 'shield', label: 'Shield' },
];

/** Bone names of the humanoid rig, in hierarchy order. Animations target these.
 *  (Underscores rather than dots: Three.js rewrites dots in node names.) */
export const HUMANOID_BONES = [
  'hips', 'spine', 'neck', 'head',
  'arm_L', 'forearm_L', 'hand_L', 'arm_R', 'forearm_R', 'hand_R',
  'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R',
];

const SKIN = ['#f4d7b5', '#e2b48e', '#c48a5a', '#8c5a34', '#5a3920'];
const HAIR = ['#111111', '#3a2415', '#5a3920', '#b08a4a', '#d9b45a', '#8a8a8a', '#d93a3a'];
const CLOTH = ['#d93a3a', '#b22a2a', '#e8762c', '#f2b43c', '#7bbf3f', '#3f8f3a', '#2a5f2a',
  '#3fb6b6', '#2f78c4', '#234a8f', '#1f2f5a', '#7a4fc9', '#b24fa3', '#8a8a8a', '#c9c9c9', '#3a3a3a'];
const LEATHER = ['#8a6a3a', '#6b4e2e', '#4a3a2a', '#3a3a3a', '#111111'];

const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const rand = (a, b) => a + Math.random() * (b - a);
const r2 = v => Math.round(v * 100) / 100;

export function randomRecipe() {
  return {
    ...DEFAULT_RECIPE,
    height: r2(rand(0.85, 1.15)),
    build: r2(rand(0.8, 1.3)),
    headSize: r2(rand(0.9, 1.15)),
    limbs: r2(rand(0.85, 1.25)),
    armLength: r2(rand(0.9, 1.1)),
    legLength: r2(rand(0.9, 1.1)),
    skin: pick(SKIN),
    hair: pick(HAIR),
    shirt: pick(CLOTH),
    pants: pick(CLOTH),
    boots: pick(LEATHER),
    hat: Math.random() < 0.3,
    weapon: Math.random() < 0.4,
    shield: Math.random() < 0.25,
    hairStyle: pick(['short', 'short', 'long', 'bald']),
  };
}

export function normalizeRecipe(recipe) {
  const r = { ...DEFAULT_RECIPE, ...(recipe || {}) };
  for (const s of RECIPE_SLIDERS) {
    const v = Number(r[s.key]);
    r[s.key] = Number.isFinite(v) ? Math.max(s.min, Math.min(s.max, v)) : DEFAULT_RECIPE[s.key];
  }
  for (const c of RECIPE_COLORS) if (!/^#[0-9a-f]{6}$/i.test(String(r[c.key]))) r[c.key] = DEFAULT_RECIPE[c.key];
  for (const f of RECIPE_FLAGS) r[f.key] = !!r[f.key];
  if (!['short', 'long', 'bald'].includes(r.hairStyle)) r.hairStyle = 'short';
  return r;
}

function dims(r) {
  const H = r.height;
  const legUp = 0.42 * H * r.legLength, legLow = 0.40 * H * r.legLength, foot = 0.10 * H;
  const hipsH = 0.22 * H;
  return { legUp, legLow, foot, hipsH, hipsY: foot + legLow + legUp + hipsH / 2 };
}

/** Height of the hips above the ground for a recipe (used to keep the feet planted on rebuild). */
export function hipsHeight(recipe) {
  return dims(normalizeRecipe(recipe)).hipsY;
}

/**
 * Adds a rigged humanoid to the model. Returns the root bone ('hips').
 * @param {import('./model.js').Model} model
 * @param {object} recipe  see DEFAULT_RECIPE
 * @param {[number, number]} at  x/z position on the ground
 * @param {object} opts  { ids: Map<'type:name', id> to reuse, parent, position, rotation }
 */
export function addHumanoid(model, recipe = {}, at = [0, 0], opts = {}) {
  const r = normalizeRecipe(recipe);
  const H = r.height, B = r.build, HS = r.headSize, LB = r.limbs;
  const add = data => model.addPart({ position: [0, 0, 0], ...data, id: opts.ids ? opts.ids.get(`${data.type}:${data.name}`) : undefined });
  const bone = (name, parent, position, tip) =>
    add({ type: 'bone', name, parent, position, offset: tip, size: [0.05 * H, 0.05 * H, 0.05 * H] });

  // Dimensions (metres, before scaling)
  const { legUp, legLow, foot, hipsH, hipsY } = dims(r);
  const torsoH = 0.58 * H, neckH = 0.05 * H;
  const armUp = 0.30 * H * r.armLength, armLow = 0.28 * H * r.armLength;
  const torsoW = 0.52 * B, torsoD = 0.28 * B;
  const headS = 0.30 * HS;
  const armW = 0.14 * LB, legW = 0.18 * LB;

  // ----- skeleton -----
  const hips = add({
    type: 'bone', name: 'hips', recipe: r, parent: opts.parent ?? null,
    position: opts.position || [at[0], hipsY, at[1]], rotation: opts.rotation || [0, 0, 0],
    offset: [0, hipsH / 2, 0], size: [0.06 * H, 0.06 * H, 0.06 * H],
  });
  const spine = bone('spine', hips.id, [0, hipsH / 2, 0], [0, torsoH, 0]);
  const neck = bone('neck', spine.id, [0, torsoH, 0], [0, neckH, 0]);
  const head = bone('head', neck.id, [0, neckH, 0], [0, headS * 1.05, 0]);

  const arms = {}, legs = {};
  for (const side of [-1, 1]) {
    const s = side < 0 ? 'L' : 'R';
    const arm = bone(`arm_${s}`, spine.id, [side * (torsoW / 2 + armW / 2 + 0.01), torsoH - armW / 2, 0], [0, -armUp, 0]);
    const forearm = bone(`forearm_${s}`, arm.id, [0, -armUp, 0], [0, -armLow, 0]);
    const hand = bone(`hand_${s}`, forearm.id, [0, -armLow, 0], [0, -0.10 * H, 0]);
    arms[s] = { arm, forearm, hand };
  }
  for (const side of [-1, 1]) {
    const s = side < 0 ? 'L' : 'R';
    const thigh = bone(`thigh_${s}`, hips.id, [side * torsoW * 0.24, -hipsH / 2 + 0.02, 0], [0, -legUp, 0]);
    const shin = bone(`shin_${s}`, thigh.id, [0, -legUp, 0], [0, -legLow, 0]);
    const footB = bone(`foot_${s}`, shin.id, [0, -legLow, 0], [0, -foot / 2, 0.19 * H]);
    legs[s] = { thigh, shin, foot: footB };
  }

  // ----- body parts, attached to the bones -----
  add({ name: 'Pelvis', type: 'box', color: r.pants, parent: hips.id, size: [torsoW * 0.92, hipsH, torsoD] });
  add({ name: 'Torso', type: 'box', color: r.shirt, parent: spine.id, offset: [0, torsoH / 2, 0], size: [torsoW, torsoH, torsoD] });
  add({ name: 'Neck', type: 'cylinder', sides: 6, color: r.skin, parent: neck.id, offset: [0, neckH / 2, 0], size: [0.12 * B, neckH, 0.12 * B] });
  add({ name: 'Head', type: 'box', color: r.skin, parent: head.id, offset: [0, headS / 2, 0], size: [headS, headS * 1.05, headS * 0.95] });

  if (r.hairStyle !== 'bald') {
    const long = r.hairStyle === 'long';
    add({
      name: 'Hair', type: 'box', color: r.hair, parent: head.id,
      position: [0, headS * (long ? 0.6 : 0.88), -headS * (long ? 0.15 : 0.08)],
      size: [headS * 1.08, headS * (long ? 1.0 : 0.5), headS * (long ? 0.95 : 0.9)],
    });
  }
  if (r.hat) {
    add({
      name: 'Hat', type: 'cone', sides: 8, color: r.pants, parent: head.id,
      position: [0, headS * 1.05, 0], offset: [0, headS * 0.35, 0], size: [headS * 1.3, headS * 0.8, headS * 1.3],
    });
    add({
      name: 'Hat brim', type: 'cylinder', sides: 8, color: r.pants, parent: head.id,
      position: [0, headS * 1.05, 0], size: [headS * 2.0, 0.02, headS * 2.0],
    });
  }

  for (const s of ['L', 'R']) {
    const { arm, forearm, hand } = arms[s];
    add({ name: `Upper arm ${s}`, type: 'cylinder', sides: 6, color: r.shirt, parent: arm.id, offset: [0, -armUp / 2, 0], size: [armW, armUp, armW] });
    add({ name: `Lower arm ${s}`, type: 'cylinder', sides: 6, color: r.skin, parent: forearm.id, offset: [0, -armLow / 2, 0], size: [armW * 0.9, armLow, armW * 0.9] });
    add({ name: `Hand ${s}`, type: 'box', color: r.skin, parent: hand.id, offset: [0, -0.05 * H, 0], size: [armW * 0.85, 0.10 * H, armW * 0.6] });
    if (r.weapon && s === 'R') {
      add({ name: 'Sword', type: 'box', color: '#c9c9c9', parent: hand.id, position: [0, -0.05 * H, 0], offset: [0, 0, 0.3 * H], size: [0.04, 0.03, 0.75 * H] });
      add({ name: 'Sword guard', type: 'box', color: '#b08a4a', parent: hand.id, position: [0, -0.05 * H, 0], offset: [0, 0, 0.08 * H], size: [0.16, 0.03, 0.04] });
    }
    if (r.shield && s === 'L') {
      add({
        name: 'Shield', type: 'cylinder', sides: 8, color: '#8a6a3a', parent: forearm.id,
        position: [-armW * 0.6, -armLow / 2, 0], rotation: [0, 0, 90], size: [0.45 * H, 0.04, 0.45 * H],
      });
    }
  }

  for (const s of ['L', 'R']) {
    const { thigh, shin, foot: footB } = legs[s];
    add({ name: `Upper leg ${s}`, type: 'cylinder', sides: 6, color: r.pants, parent: thigh.id, offset: [0, -legUp / 2, 0], size: [legW, legUp, legW] });
    add({ name: `Lower leg ${s}`, type: 'cylinder', sides: 6, color: r.pants, parent: shin.id, offset: [0, -legLow / 2, 0], size: [legW * 0.9, legLow, legW * 0.9] });
    add({ name: `Foot ${s}`, type: 'box', color: r.boots, parent: footB.id, offset: [0, -foot / 2, 0.05 * H], size: [legW, foot, 0.28 * H] });
  }

  return hips;
}

/** The character root (a part with a recipe) that a part belongs to, or null. */
export function characterRootOf(model, part) {
  let p = part;
  while (p) {
    if (p.recipe) return p;
    p = p.parent != null ? model.parts.get(p.parent) : null;
  }
  return null;
}

/**
 * Regenerates a humanoid in place from a new recipe. Part ids are reused by type and name, so
 * selection and animation keys survive; the root keeps its position, rotation and parent.
 * Returns the new root.
 */
export function rebuildHumanoid(model, rootId, recipe) {
  const old = model.parts.get(rootId);
  if (!old || !old.recipe) return null;
  const oldRecipe = old.recipe;
  const newRecipe = normalizeRecipe(recipe);

  // Remember ids by type+name within the old subtree, and their animation tracks.
  const ids = new Map();
  const subtree = [old];
  const walk = id => { for (const c of model.childrenOf(id)) { subtree.push(c); walk(c.id); } };
  walk(old.id);
  for (const p of subtree) { const k = `${p.type}:${p.name}`; if (!ids.has(k)) ids.set(k, p.id); }
  const savedTracks = model.animations.map(clip => {
    const t = {};
    for (const p of subtree) if (clip.tracks[p.id]) t[p.id] = clip.tracks[p.id];
    return t;
  });

  const position = [old.position[0], old.position[1] - hipsHeight(oldRecipe) + hipsHeight(newRecipe), old.position[2]];
  const rotation = [...old.rotation];
  const parent = old.parent;

  model.removePart(rootId); // also drops the subtree's tracks; restored below
  const root = addHumanoid(model, newRecipe, [position[0], position[2]], { ids, parent, position, rotation });

  model.animations.forEach((clip, i) => {
    for (const [pid, track] of Object.entries(savedTracks[i])) {
      if (model.parts.has(Number(pid))) clip.tracks[pid] = track;
    }
  });
  return root;
}

export { PALETTE };

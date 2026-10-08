// Starter kits: a posable low-poly humanoid built from parts, plus a randomiser for NPCs.
// Every limb pivots at its joint (shoulder, elbow, hip, knee) so the figure can be posed by rotation.

import { PALETTE } from './parts.js';

export const DEFAULT_RECIPE = {
  height: 1.0,     // overall scale
  build: 1.0,      // width of torso and limbs
  headSize: 1.0,
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

const SKIN = ['#f4d7b5', '#e2b48e', '#c48a5a', '#8c5a34', '#5a3920'];
const HAIR = ['#111111', '#3a2415', '#5a3920', '#b08a4a', '#d9b45a', '#8a8a8a', '#d93a3a'];
const CLOTH = ['#d93a3a', '#b22a2a', '#e8762c', '#f2b43c', '#7bbf3f', '#3f8f3a', '#2a5f2a',
  '#3fb6b6', '#2f78c4', '#234a8f', '#1f2f5a', '#7a4fc9', '#b24fa3', '#8a8a8a', '#c9c9c9', '#3a3a3a'];
const LEATHER = ['#8a6a3a', '#6b4e2e', '#4a3a2a', '#3a3a3a', '#111111'];

const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const rand = (a, b) => a + Math.random() * (b - a);

export function randomRecipe() {
  return {
    height: Math.round(rand(0.85, 1.15) * 100) / 100,
    build: Math.round(rand(0.8, 1.3) * 100) / 100,
    headSize: Math.round(rand(0.9, 1.15) * 100) / 100,
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

/**
 * Adds a humanoid to the model. Returns the root (hips) part.
 * @param {import('./model.js').Model} model
 * @param {object} recipe  see DEFAULT_RECIPE
 * @param {[number, number]} at  x/z position on the ground
 */
export function addHumanoid(model, recipe = {}, at = [0, 0], prefix = '') {
  const r = { ...DEFAULT_RECIPE, ...recipe };
  const H = r.height, B = r.build, HS = r.headSize;
  const n = s => (prefix ? `${prefix} ${s}` : s);

  // Dimensions (metres, before scaling)
  const legUp = 0.42 * H, legLow = 0.40 * H, foot = 0.10 * H;
  const hipsH = 0.22 * H, torsoH = 0.58 * H, neckH = 0.05 * H;
  const armUp = 0.30 * H, armLow = 0.28 * H;
  const torsoW = 0.52 * B, torsoD = 0.28 * B;

  const hipsY = foot + legLow + legUp + hipsH / 2;

  const hips = model.addPart({
    name: n('Hips'), type: 'box', color: r.pants,
    position: [at[0], hipsY, at[1]], size: [torsoW * 0.92, hipsH, torsoD],
  });

  const torso = model.addPart({
    name: n('Torso'), type: 'box', color: r.shirt, parent: hips.id,
    position: [0, hipsH / 2, 0], offset: [0, torsoH / 2, 0], size: [torsoW, torsoH, torsoD],
  });

  const neck = model.addPart({
    name: n('Neck'), type: 'cylinder', sides: 6, color: r.skin, parent: torso.id,
    position: [0, torsoH, 0], offset: [0, neckH / 2, 0], size: [0.12 * B, neckH, 0.12 * B],
  });

  const headS = 0.30 * HS;
  const head = model.addPart({
    name: n('Head'), type: 'box', color: r.skin, parent: neck.id,
    position: [0, neckH, 0], offset: [0, headS / 2, 0], size: [headS, headS * 1.05, headS * 0.95],
  });

  if (r.hairStyle !== 'bald') {
    const long = r.hairStyle === 'long';
    model.addPart({
      name: n('Hair'), type: 'box', color: r.hair, parent: head.id,
      position: [0, headS * (long ? 0.6 : 0.88), -headS * (long ? 0.15 : 0.08)],
      size: [headS * 1.08, headS * (long ? 1.0 : 0.5), headS * (long ? 0.95 : 0.9)],
    });
  }
  if (r.hat) {
    model.addPart({
      name: n('Hat'), type: 'cone', sides: 8, color: r.pants, parent: head.id,
      position: [0, headS * 1.05, 0], offset: [0, headS * 0.35, 0], size: [headS * 1.3, headS * 0.8, headS * 1.3],
    });
    model.addPart({
      name: n('Hat brim'), type: 'cylinder', sides: 8, color: r.pants, parent: head.id,
      position: [0, headS * 1.05, 0], size: [headS * 2.0, 0.02, headS * 2.0],
    });
  }

  // Arms
  for (const side of [-1, 1]) {
    const s = side < 0 ? 'L' : 'R';
    const armW = 0.14 * B;
    const upper = model.addPart({
      name: n(`Upper arm ${s}`), type: 'cylinder', sides: 6, color: r.shirt, parent: torso.id,
      position: [side * (torsoW / 2 + armW / 2 + 0.01), torsoH - armW / 2, 0],
      offset: [0, -armUp / 2, 0], size: [armW, armUp, armW],
    });
    const lower = model.addPart({
      name: n(`Lower arm ${s}`), type: 'cylinder', sides: 6, color: r.skin, parent: upper.id,
      position: [0, -armUp, 0], offset: [0, -armLow / 2, 0], size: [armW * 0.9, armLow, armW * 0.9],
    });
    const hand = model.addPart({
      name: n(`Hand ${s}`), type: 'box', color: r.skin, parent: lower.id,
      position: [0, -armLow, 0], offset: [0, -0.05 * H, 0], size: [armW * 0.85, 0.10 * H, armW * 0.6],
    });
    if (r.weapon && side > 0) {
      model.addPart({
        name: n('Sword'), type: 'box', color: '#c9c9c9', parent: hand.id,
        position: [0, -0.05 * H, 0], offset: [0, 0, 0.3 * H], size: [0.04, 0.03, 0.75 * H],
      });
      model.addPart({
        name: n('Sword guard'), type: 'box', color: '#b08a4a', parent: hand.id,
        position: [0, -0.05 * H, 0], offset: [0, 0, 0.08 * H], size: [0.16, 0.03, 0.04],
      });
    }
    if (r.shield && side < 0) {
      model.addPart({
        name: n('Shield'), type: 'cylinder', sides: 8, color: '#8a6a3a', parent: lower.id,
        position: [-armW * 0.6, -armLow / 2, 0], rotation: [0, 0, 90], size: [0.45 * H, 0.04, 0.45 * H],
      });
    }
  }

  // Legs
  for (const side of [-1, 1]) {
    const s = side < 0 ? 'L' : 'R';
    const legW = 0.18 * B;
    const upper = model.addPart({
      name: n(`Upper leg ${s}`), type: 'cylinder', sides: 6, color: r.pants, parent: hips.id,
      position: [side * torsoW * 0.24, -hipsH / 2 + 0.02, 0],
      offset: [0, -legUp / 2, 0], size: [legW, legUp, legW],
    });
    const lower = model.addPart({
      name: n(`Lower leg ${s}`), type: 'cylinder', sides: 6, color: r.pants, parent: upper.id,
      position: [0, -legUp, 0], offset: [0, -legLow / 2, 0], size: [legW * 0.9, legLow, legW * 0.9],
    });
    model.addPart({
      name: n(`Foot ${s}`), type: 'box', color: r.boots, parent: lower.id,
      position: [0, -legLow, 0], offset: [0, -foot / 2, 0.05 * H], size: [legW, foot, 0.28 * H],
    });
  }

  return hips;
}

export { PALETTE };

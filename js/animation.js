// Keyframe animation: clips live in the document (model.animations); the Animator samples the active
// clip at the current frame and poses the Three.js objects without touching the rest pose data.
//
// Clip shape:
//   { id, name, fps, length, interpolation: 'linear' | 'smooth',
//     tracks: { [partId]: { position: [{ f, v: [x,y,z] }], rotation: [...], size: [...] } } }
// Keys are sorted by frame `f`. Rotation values are Euler degrees, like the rest pose.

export const PROPS = ['position', 'rotation', 'size'];

export function newClip(name = 'clip', { fps = 24, length = 24 } = {}) {
  return { id: `c${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`, name, fps, length, interpolation: 'smooth', tracks: {} };
}

export function sanitizeClip(c) {
  const clip = newClip(typeof c?.name === 'string' ? c.name : 'clip');
  if (typeof c?.id === 'string') clip.id = c.id;
  clip.fps = clamp(Number(c?.fps) || 24, 1, 120);
  clip.length = clamp(Math.round(Number(c?.length) || 24), 1, 100000);
  clip.interpolation = c?.interpolation === 'linear' ? 'linear' : 'smooth';
  const tracks = c?.tracks && typeof c.tracks === 'object' ? c.tracks : {};
  for (const [pid, t] of Object.entries(tracks)) {
    const out = {};
    for (const prop of PROPS) {
      if (!Array.isArray(t?.[prop])) continue;
      const keys = t[prop]
        .filter(k => k && Number.isFinite(Number(k.f)) && Array.isArray(k.v) && k.v.length === 3)
        .map(k => ({ f: Math.round(Number(k.f)), v: k.v.map(Number) }))
        .sort((a, b) => a.f - b.f);
      if (keys.length) out[prop] = dedupe(keys);
    }
    if (Object.keys(out).length) clip.tracks[Number(pid)] = out;
  }
  return clip;
}

function dedupe(keys) {
  const out = [];
  for (const k of keys) {
    if (out.length && out[out.length - 1].f === k.f) out[out.length - 1] = k;
    else out.push(k);
  }
  return out;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Samples one property of one track at a (possibly fractional) frame. Returns null if no keys. */
export function sample(clip, partId, prop, frame) {
  const keys = clip?.tracks?.[partId]?.[prop];
  if (!keys || !keys.length) return null;
  if (frame <= keys[0].f) return [...keys[0].v];
  const last = keys[keys.length - 1];
  if (frame >= last.f) return [...last.v];
  let i = 0;
  while (keys[i + 1].f < frame) i++;
  const a = keys[i], b = keys[i + 1];
  let t = (frame - a.f) / (b.f - a.f);
  if (clip.interpolation === 'smooth') t = t * t * (3 - 2 * t);
  return a.v.map((av, k) => av + (b.v[k] - av) * t);
}

export class Animator {
  constructor(model) {
    this.model = model;
    this.clipId = null;
    this.frame = 0;
    this.playing = false;
    this.loop = true;
    this.listeners = new Set();
    /** Part currently being dragged by the gizmo: its pose is left alone while dragging. */
    this.holdPart = null;
  }

  /** fn(kind): 'frame' (playhead moved), 'clip' (active clip changed), 'edit' (keys changed). */
  onChange(fn) { this.listeners.add(fn); }
  _emit(kind = 'edit') { for (const fn of this.listeners) fn(kind, this); }

  get clip() { return this.clipId ? this.model.animations.find(c => c.id === this.clipId) || null : null; }

  setClip(id) {
    this.clipId = id || null;
    this.playing = false;
    this.frame = 0;
    if (!this.clip) this.applyRest();
    this.apply();
    this._emit('clip');
  }

  setFrame(f) {
    const clip = this.clip;
    if (!clip) return;
    this.frame = clamp(f, 0, clip.length);
    this.apply();
    this._emit('frame');
  }

  play() { if (this.clip) { this.playing = true; this._emit('frame'); } }
  pause() { this.playing = false; this._emit('frame'); }
  toggle() { this.playing ? this.pause() : this.play(); }
  stop() { this.playing = false; this.setFrame(0); }

  /** Advances playback by dt seconds. Called from the render loop. */
  tick(dt) {
    const clip = this.clip;
    if (!clip) return;
    if (this.playing) {
      let f = this.frame + dt * clip.fps;
      if (f >= clip.length) {
        if (this.loop) f = clip.length > 0 ? f % clip.length : 0;
        else { f = clip.length; this.playing = false; }
      }
      this.frame = f;
      this._emit('frame');
    }
    this.apply();
  }

  /** Poses the scene objects for the current frame. */
  apply() {
    const clip = this.clip;
    if (!clip) return;
    for (const part of this.model.parts.values()) {
      if (part === this.holdPart) continue;
      const t = clip.tracks[part.id];
      const pos = t ? sample(clip, part.id, 'position', this.frame) : null;
      const rot = t ? sample(clip, part.id, 'rotation', this.frame) : null;
      const size = t ? sample(clip, part.id, 'size', this.frame) : null;
      this.model.applyTransform(part, {
        position: pos || part.position,
        rotation: rot || part.rotation,
        size: size || part.size,
      });
    }
  }

  applyRest() {
    for (const part of this.model.parts.values()) this.model.apply(part);
  }

  /** Current posed transform of a part (sampled if tracked, otherwise rest). */
  poseOf(part) {
    const clip = this.clip;
    return {
      position: (clip && sample(clip, part.id, 'position', this.frame)) || [...part.position],
      rotation: (clip && sample(clip, part.id, 'rotation', this.frame)) || [...part.rotation],
      size: (clip && sample(clip, part.id, 'size', this.frame)) || [...part.size],
    };
  }

  // ----- key editing (all operate on the active clip) -----

  setKey(partId, prop, value, frame = Math.round(this.frame)) {
    const clip = this.clip;
    if (!clip || !PROPS.includes(prop)) return false;
    const track = clip.tracks[partId] || (clip.tracks[partId] = {});
    const keys = track[prop] || (track[prop] = []);
    const v = value.map(n => Math.round(n * 1000) / 1000);
    const i = keys.findIndex(k => k.f >= frame);
    if (i >= 0 && keys[i].f === frame) keys[i].v = v;
    else keys.splice(i < 0 ? keys.length : i, 0, { f: frame, v });
    this.apply();
    this._emit();
    return true;
  }

  /** Keys the current pose of a part for the given properties (default: all three). */
  keyPart(part, props = PROPS, frame = Math.round(this.frame)) {
    const pose = this.poseOf(part);
    for (const p of props) this.setKey(part.id, p, pose[p], frame);
  }

  /** Keys every part that already has a track, at the current frame (holds the pose). */
  keyAll(frame = Math.round(this.frame)) {
    const clip = this.clip;
    if (!clip) return;
    for (const pid of Object.keys(clip.tracks)) {
      const part = this.model.parts.get(Number(pid));
      if (part) this.keyPart(part, Object.keys(clip.tracks[pid]), frame);
    }
  }

  hasKey(partId, frame, prop = null) {
    const t = this.clip?.tracks?.[partId];
    if (!t) return false;
    const props = prop ? [prop] : Object.keys(t);
    return props.some(p => (t[p] || []).some(k => k.f === frame));
  }

  deleteKey(partId, frame, prop = null) {
    const clip = this.clip;
    const t = clip?.tracks?.[partId];
    if (!t) return false;
    let removed = false;
    for (const p of prop ? [prop] : Object.keys(t)) {
      const before = t[p].length;
      t[p] = t[p].filter(k => k.f !== frame);
      if (t[p].length !== before) removed = true;
      if (!t[p].length) delete t[p];
    }
    if (!Object.keys(t).length) delete clip.tracks[partId];
    if (removed) { this.apply(); this._emit(); }
    return removed;
  }

  moveKey(partId, fromFrame, toFrame) {
    const clip = this.clip;
    const t = clip?.tracks?.[partId];
    if (!t || fromFrame === toFrame) return false;
    toFrame = clamp(Math.round(toFrame), 0, clip.length);
    for (const p of Object.keys(t)) {
      const k = t[p].find(k => k.f === fromFrame);
      if (!k) continue;
      t[p] = t[p].filter(x => x.f !== toFrame && x !== k);
      k.f = toFrame;
      t[p].push(k);
      t[p].sort((a, b) => a.f - b.f);
    }
    this.apply();
    this._emit();
    return true;
  }

  removeTrack(partId) {
    const clip = this.clip;
    if (!clip || !clip.tracks[partId]) return false;
    delete clip.tracks[partId];
    this.apply();
    this._emit();
    return true;
  }

  /** Frames that have at least one key on a part. */
  keyFrames(partId) {
    const t = this.clip?.tracks?.[partId];
    if (!t) return [];
    const set = new Set();
    for (const keys of Object.values(t)) for (const k of keys) set.add(k.f);
    return [...set].sort((a, b) => a - b);
  }
}

// ----- presets for the humanoid kit -----

// Older, bone-less humanoids (format 2) named their parts after body parts; map those to bone roles.
const LEGACY_ROLES = {
  Hips: 'hips', Torso: 'spine', Neck: 'neck', Head: 'head',
  'Upper arm L': 'arm_L', 'Lower arm L': 'forearm_L', 'Hand L': 'hand_L',
  'Upper arm R': 'arm_R', 'Lower arm R': 'forearm_R', 'Hand R': 'hand_R',
  'Upper leg L': 'thigh_L', 'Lower leg L': 'shin_L', 'Foot L': 'foot_L',
  'Upper leg R': 'thigh_R', 'Lower leg R': 'shin_R', 'Foot R': 'foot_R',
};

/** Finds the bones of a humanoid by role ('hips', 'arm_L', ...) under a root part. */
function limbMap(model, root) {
  const map = {};
  const hasBones = root.type === 'bone';
  const walk = part => {
    const role = hasBones ? (part.type === 'bone' ? part.name : null) : LEGACY_ROLES[part.name];
    if (role && !map[role]) map[role] = part;
    for (const c of model.childrenOf(part.id)) walk(c);
  };
  walk(root);
  map.hips = map.hips || root;
  return map;
}

function keyRot(clip, part, pairs) {
  if (!part) return;
  const track = clip.tracks[part.id] || (clip.tracks[part.id] = {});
  track.rotation = pairs.map(([f, x, y = 0, z = 0]) => ({ f, v: [part.rotation[0] + x, part.rotation[1] + y, part.rotation[2] + z] }));
}

function keyPos(clip, part, pairs) {
  if (!part) return;
  const track = clip.tracks[part.id] || (clip.tracks[part.id] = {});
  track.position = pairs.map(([f, dx, dy, dz]) => ({ f, v: [part.position[0] + dx, part.position[1] + dy, part.position[2] + dz] }));
}

/** A 24-frame looping walk cycle for a humanoid rooted at `root`. */
export function walkClip(model, root) {
  const L = limbMap(model, root);
  const clip = newClip('walk', { fps: 24, length: 24 });
  const swing = 35, knee = 45, arm = 30, elbow = 20;
  keyRot(clip, L['thigh_L'], [[0, swing], [12, -swing], [24, swing]]);
  keyRot(clip, L['thigh_R'], [[0, -swing], [12, swing], [24, -swing]]);
  keyRot(clip, L['shin_L'], [[0, 0], [6, knee], [12, 0], [18, 10], [24, 0]]);
  keyRot(clip, L['shin_R'], [[0, 0], [6, 10], [12, 0], [18, knee], [24, 0]]);
  keyRot(clip, L['arm_L'], [[0, -arm], [12, arm], [24, -arm]]);
  keyRot(clip, L['arm_R'], [[0, arm], [12, -arm], [24, arm]]);
  keyRot(clip, L['forearm_L'], [[0, -elbow], [12, -elbow * 2], [24, -elbow]]);
  keyRot(clip, L['forearm_R'], [[0, -elbow * 2], [12, -elbow], [24, -elbow * 2]]);
  keyPos(clip, L.hips, [[0, 0, 0, 0], [6, 0, -0.04, 0], [12, 0, 0, 0], [18, 0, -0.04, 0], [24, 0, 0, 0]]);
  keyRot(clip, L.spine, [[0, 0, 6], [12, 0, -6], [24, 0, 6]]);
  return clip;
}

/** A slow 48-frame idle: breathing bob and a slight sway. */
export function idleClip(model, root) {
  const L = limbMap(model, root);
  const clip = newClip('idle', { fps: 24, length: 48 });
  keyPos(clip, L.hips, [[0, 0, 0, 0], [24, 0, -0.02, 0], [48, 0, 0, 0]]);
  keyRot(clip, L.spine, [[0, 0, 0, 0], [24, 3, 0, 0], [48, 0, 0, 0]]);
  keyRot(clip, L.head, [[0, 0, 0], [16, 0, 8], [32, 0, -8], [48, 0, 0]]);
  keyRot(clip, L['arm_L'], [[0, 0, 0, 4], [24, 0, 0, 8], [48, 0, 0, 4]]);
  keyRot(clip, L['arm_R'], [[0, 0, 0, -4], [24, 0, 0, -8], [48, 0, 0, -4]]);
  return clip;
}

/** A 20-frame sword/arm swing. */
export function attackClip(model, root) {
  const L = limbMap(model, root);
  const clip = newClip('attack', { fps: 24, length: 20 });
  keyRot(clip, L['arm_R'], [[0, 0], [6, -150], [10, -120], [14, -20], [20, 0]]);
  keyRot(clip, L['forearm_R'], [[0, 0], [6, -60], [10, -10], [14, -10], [20, 0]]);
  keyRot(clip, L.spine, [[0, 0, 0], [6, 0, 25], [12, 0, -20], [20, 0, 0]]);
  keyRot(clip, L.hips, [[0, 0, 0], [6, 0, 10], [12, 0, -10], [20, 0, 0]]);
  return clip;
}

export const CLIP_PRESETS = { walk: walkClip, idle: idleClip, attack: attackClip };

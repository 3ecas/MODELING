# Blocky — an old-school 3D modeler

A small browser tool for building low-poly, flat-shaded 3D characters and props in the style of early
3D games (think RuneScape Classic, PS1, N64). Models are assembled from simple parts — boxes,
6-to-8-sided cylinders, cones, spheres, wedges — coloured with a limited palette, rigged with a
skeleton of bones, animated with keyframes, and exported as a game-ready GLB for Three.js, Godot,
Unity, Unreal or Blender.

No build step, no install.

## Running it

Serve the folder with any static web server and open it in a browser:

```sh
python3 -m http.server 8000      # or: npx serve .
# then open http://localhost:8000/
```

Opening `index.html` directly with `file://` does not work, because the page uses ES modules.

To put it online, enable GitHub Pages for the repository (Settings → Pages → Deploy from a branch →
`main`, folder `/`). The editor will then be at `https://<user>.github.io/<repo>/` and the player at
`https://<user>.github.io/<repo>/example/player.html`.

Your work autosaves in the browser. Use **Save** to keep a `.json` project file and **Open** to load it.

## What it does

- **Parts kit** — Box, Cylinder, Cone, Sphere, Wedge, Plane. Round shapes have a "Sides" slider (3–32)
  so you can keep them chunky.
- **Bones** — the skeleton. A bone is a joint with a pivot and a tip; parts attached to a bone move
  with it. Bones draw as blue x-ray markers (toggle with **Bones** in the toolbar), are picked first
  when visible, and export as real glTF joints.
- **Move / Rotate / Size** — a 3D gizmo (W / E / R) with snapping, numeric fields, and rotation sliders.
- **Multi-selection** — Shift+click or Ctrl+click adds parts to the selection, Shift+drag in the viewport
  box-selects, Ctrl+A selects everything, Shift+click in the parts list selects a range, and **Select
  children** grabs a whole subtree. The gizmo then moves, rotates or resizes the group around its centre;
  colour, parent, visibility, duplicate, delete and keyframes apply to every selected part.
- **Parenting** — any part can be attached to any other part or bone. A parent's size never stretches
  its children.
- **Flat colours** — a 32-colour palette, or any colour.
- **Humanoid kit** — one click adds a rigged character: 16 bones (`hips, spine, neck, head, arm_L,
  forearm_L, hand_L, …, thigh_R, shin_R, foot_R`) with body parts attached. **Random NPC** rolls
  proportions, colours, hair, hat, sword and shield.
- **Character panel** — select any part of a character and sliders appear: height, build, head size,
  limb thickness, arm and leg length, colours, hair style and extras. The figure is rebuilt live;
  bone ids, keyframes and the root position are kept.
- **Animation** — clips with a timeline, keyframes and playback. Walk, idle and attack presets.
- **Duplicate / Mirror X**, **Undo / Redo**, project files as `.json`.
- **Export** — skinned GLB (game-ready), GLB with separate parts, OBJ, and a one-click preview in the
  example player.
- **Look** — flat shading, wireframe, and a "Pixel" mode that renders at quarter resolution.

## Building a skeleton

The humanoid kit comes rigged, so for characters you usually just pose and animate. To rig something
yourself:

1. Select the part the bone should hang from (or nothing, for a root bone) and click **Add → Bone**.
   The bone appears at the parent's pivot; move it to the joint.
2. Set its **Tip** so the marker points toward the next joint (down an arm, along a tail). The tip is
   only a marker, but it makes the skeleton readable.
3. Set the **Parent** of each body part to its bone. A part can also stay parented to another part;
   on export it binds to the nearest bone above it.
4. Rotate bones to pose. Everything attached follows.

Rules on export: every bone, every animated part, and their ancestors become joints. Each vertex is
bound rigidly to one joint (this is how old games did it, and it keeps the blocky look). Trees with
no bones and no animation export as static meshes.

## Animating

The timeline strip at the bottom holds the model's clips.

1. Pick **Walk**, **Idle** or **Attack** to add a preset for the selected character, or **New clip** for an
   empty one. The viewport shows an "ANIMATING" badge while a clip is active.
2. Scrub by clicking or dragging the frame ruler, or type a frame number. Space plays and pauses,
   the arrow keys step one frame (Shift for five), Home and End jump to the ends.
3. With a clip active, every change you make to a bone or part — gizmo, typed value, rotation
   slider — becomes a keyframe for that property at the current frame. The rest pose is not touched.
   Pick **Rest pose** in the clip menu to edit the model itself again.
4. **Key** (K) stores the selected part's full pose at the current frame. **Key all** stores every
   animated part at once, which is how you hold a pose. **Delete key** and **Remove track** clean up.
5. Each animated part gets a row of diamonds. Click one to jump to it, drag it to move the key.
6. **Length** and **FPS** set the clip's size, **Smooth / Linear** sets how values move between keys.
   Loop is on by default, so a cycle that starts and ends with the same keys plays seamlessly.

A single key on a part holds its value across the whole clip; two keys make movement. Parts without
keys stay in their rest pose. Exports always use the rest pose for the skeleton and bake every frame
of every clip, so the easing you see in Blocky is reproduced exactly in any engine.

## Using a character in a browser game (Three.js)

Export with **Export → GLB · skinned character**. The file contains one skinned mesh per character
(one glTF primitive per colour), a skeleton whose joints are your bones, and every clip as a skeletal
animation. Then, in your game:

```js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const gltf = await new GLTFLoader().loadAsync('guard.glb');

// Spawn a character: clone the skinned template (geometry and clips are shared, so this is cheap).
const npc = SkeletonUtils.clone(gltf.scene);
scene.add(npc);

// Play its clips with a mixer.
const mixer = new THREE.AnimationMixer(npc);
const actions = Object.fromEntries(gltf.animations.map(clip => [clip.name, mixer.clipAction(clip)]));
actions.idle.play();

// Switch clips with a cross-fade.
function walk() { actions.walk.reset().crossFadeFrom(actions.idle, 0.2, true).play(); }

// Bones are ordinary nodes: look them up by name to attach things or aim the head.
const hand = npc.getObjectByName('hand_R');   // put a weapon here
const head = npc.getObjectByName('head');     // head.lookAt(target)

// Each frame:
mixer.update(deltaSeconds);
```

`example/player.html` is a complete, runnable version of this: it loads `example/guard.glb` (or any
GLB you drop on it), lets you pick clips, spawns clones that share the skeleton, and has a tiny
controller (WASD walks with the `walk` clip, Space plays `attack` once, idle otherwise). The editor's
**Export → Preview in player** opens it with the model you are working on. Copy the page as a starting
point for your own game loop.

Three.js notes: the loader turns dots in node names into underscores, which is why the humanoid's
bones are named `arm_L` rather than `arm.L`. Use a `MeshLambertMaterial`-style look or keep the
exported standard materials; they are already flat-shaded with no metalness.

Other engines read the same file:

- **Godot** — drop the `.glb` into the project; you get a `Skeleton3D` with the bones and an
  `AnimationPlayer` with the clips.
- **Unity** — import with glTFast (or UnityGLTF); clips import as animation clips, bones as a
  transform hierarchy. For the vertex-colour export, use a shader that reads vertex colours.
- **Unreal** — the built-in glTF importer gives a skeletal mesh and animation sequences.
- **Blender** — File → Import → glTF 2.0; you get an armature with actions. Use **GLB · separate parts**
  instead when you want each part as its own object.

**GLB · skinned, vertex colours** stores the colours per vertex and makes each character a single
draw call (Three.js and Godot show it as-is; Unity needs a vertex-colour material). **OBJ** is
geometry only.

## Keys

| Key | Action |
| --- | --- |
| W / G | Move tool |
| E | Rotate tool |
| R | Size tool |
| Shift+click / Ctrl+click | Add to or remove from the selection |
| Shift+drag | Box-select |
| Ctrl+A | Select all |
| Ctrl+D | Duplicate |
| Delete / Backspace | Delete |
| Ctrl+Z / Ctrl+Y | Undo / Redo |
| Ctrl+S | Save project (.json) |
| F | Focus camera on selection |
| Esc | Deselect |
| 1 / 3 / 7 / 5 | Front / Side / Top / Perspective view |
| Space | Play / pause the active clip |
| K | Key the selected part's pose |
| ← / → | Step one frame (Shift: five) |
| Home / End | First / last frame |

Left-drag orbits, right-drag pans, wheel zooms. Click a part or bone to select it. With several parts
selected, the last one clicked is the active part: the properties fields show its values, while colour,
parent and visibility changes go to the whole selection. A part whose parent is also selected moves
with its parent rather than twice.

## Project file format

A project is plain JSON: a model name, a list of parts (bones are parts of type `bone`), and a list
of animation clips.

```json
{
  "format": "blocky-model",
  "version": 3,
  "name": "guard",
  "parts": [
    { "id": 1, "name": "hips", "type": "bone", "parent": null,
      "position": [0, 1.03, 0], "rotation": [0, 0, 0], "size": [0.06, 0.06, 0.06], "offset": [0, 0.11, 0],
      "sides": 0, "color": "#8ad7ff", "visible": true,
      "recipe": { "height": 1, "build": 1, "headSize": 1, "skin": "#e2b48e", "hat": false } },
    { "id": 17, "name": "Pelvis", "type": "box", "parent": 1,
      "position": [0, 0, 0], "rotation": [0, 0, 0], "size": [0.48, 0.22, 0.28], "offset": [0, 0, 0],
      "sides": 0, "color": "#3a3a3a", "visible": true }
  ],
  "animations": [
    { "id": "c1", "name": "walk", "fps": 24, "length": 24, "interpolation": "smooth",
      "tracks": { "11": { "rotation": [ { "f": 0, "v": [35, 0, 0] }, { "f": 12, "v": [-35, 0, 0] }, { "f": 24, "v": [35, 0, 0] } ] } } }
  ]
}
```

- `position` / `rotation` (degrees) are the part's pivot, relative to its parent.
- `size` is the shape's dimensions in metres (for a bone, only the marker thickness is used).
- `offset` shifts the shape away from the pivot; for a bone it is the tip.
- `recipe` only appears on a character root and is what the Character panel edits.
- Each track is keyed by part id; keys hold a frame `f` and a value `v` for `position`, `rotation`
  (degrees) or `size`.

Files from older versions (parts without bones) still open; their presets map body-part names to
bone roles.

## Code layout

```
index.html              page, toolbar, panels and timeline markup
css/style.css           dark UI theme
js/main.js              app object, keyboard shortcuts, autosave, export menu, boot
js/model.js             document: parts and bones, hierarchy, clips, rest-pose matrices, serialisation
js/parts.js             geometry builders (unit-sized, low-poly, flat), bone marker, palette
js/viewport.js          renderer, camera, lights, grid, orbit + transform gizmo, picking
js/animation.js         clips, sampling, the Animator (playback + keying), walk/idle/attack presets
js/timeline.js          timeline panel: clip controls, ruler, playhead, keyframe rows
js/character-panel.js   character sliders that regenerate the humanoid
js/ui.js                outliner, properties panel, palette, status bar
js/io.js                save / open .json, skinned and parts GLB export, OBJ
js/history.js           snapshot undo / redo
js/templates.js         rigged humanoid recipe, random NPC, in-place rebuild
example/player.html     Three.js player: loads a GLB, plays clips, clones, WASD controller
example/guard.glb       a sample export (humanoid with idle, walk and attack)
vendor/three/           Three.js r160 (MIT) and the addons used
```

Everything is a plain ES module; `window.app` exposes the editor for the browser console
(for example `app.addRandomNPC()`, `app.addPresetClip('walk')` or `app.exportGLB()`), and
`window.player` exposes the player.

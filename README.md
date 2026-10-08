# Blocky — an old-school 3D modeler

A small browser tool for building low-poly, flat-shaded 3D models in the style of early 3D games
(think RuneScape Classic, PS1, N64). Models are assembled from simple parts — boxes, 6-to-8-sided
cylinders, cones, spheres, wedges — coloured with a limited palette, posed, animated with keyframes,
and exported as GLB for use in Three.js, Godot, Unity, Unreal or Blender.

No build step, no install: open `index.html` from any static web server.

```sh
# any static server works, for example:
python3 -m http.server 8000
# then open http://localhost:8000/
```

(Opening the file directly with `file://` does not work in most browsers because ES modules need HTTP.)

## What it does

- **Parts kit** — add Box, Cylinder, Cone, Sphere, Wedge or Plane. Cylinders, cones and spheres have a
  "Sides" slider (3–32) so you can keep them chunky.
- **Move / Rotate / Size** — a 3D gizmo in the viewport (W / E / R) with snapping, numeric fields, and
  rotation sliders for quick posing.
- **Parenting** — parts can be attached to other parts. Each part has a pivot, and limbs pivot at their
  joint, so a character built from parts can be posed by rotating arms and legs. A parent's size never
  stretches its children.
- **Flat colours** — a 32-colour old-school palette, or any colour you like.
- **Humanoid kit** — one click adds a posable low-poly character (hips → torso → head, arms, legs).
  "Random NPC" rolls proportions, colours, hair, hat, sword and shield.
- **Character panel** — select any part of a character and sliders appear: height, build, head size,
  limb thickness, arm and leg length, plus skin / hair / shirt / pants / boot colours, hair style and
  extras. The figure is rebuilt live as you drag. Keyframes, the root position and your selection are kept.
- **Animation** — clips with a timeline, keyframes and playback (see below). Walk, idle and attack
  presets for the humanoid.
- **Duplicate / Mirror X** — build one arm, mirror it.
- **Undo / Redo**, autosave to the browser, and project files as `.json`.
- **Export** — `.glb` (binary glTF with hierarchy, flat colours and all animation clips) and `.obj`.
- **Look** — flat shading, optional wireframe, and a "Pixel" mode that renders at quarter resolution
  with no smoothing for a retro screen look.

## Animating

The timeline strip at the bottom holds the model's clips.

1. Pick **Walk**, **Idle** or **Attack** to add a preset for the selected character, or **New clip** for an
   empty one. The viewport shows an "ANIMATING" badge while a clip is active.
2. Scrub by clicking or dragging on the frame ruler, or type a frame number. Space plays and pauses,
   the arrow keys step one frame (Shift for five), Home and End jump to the ends.
3. With a clip active, every change you make to a part — dragging the gizmo, typing a value, moving a
   rotation slider — becomes a keyframe for that property at the current frame. The rest pose is not
   touched. Pick **Rest pose** in the clip menu to edit the model itself again.
4. **Key** (K) stores the selected part's full pose at the current frame. **Key all** stores every
   animated part at once, which is how you hold a pose. **Delete key** and **Remove track** clean up.
5. Each animated part gets a row of diamonds. Click one to jump to it, drag it to move the key.
6. **Length** and **FPS** set the clip's size, **Smooth / Linear** sets how values move between keys.
   Loop is on by default, so a cycle that starts and ends with the same keys plays seamlessly.

A single key on a part holds its value across the whole clip. To make something move, you need two
keys. Parts without keys stay in their rest pose.

The GLB export bakes every frame of every clip, so the easing you see in Blocky is reproduced exactly
by any engine's glTF importer.

## Keys

| Key | Action |
| --- | --- |
| W / G | Move tool |
| E | Rotate tool |
| R | Size tool |
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

Left-drag orbits, right-drag pans, wheel zooms. Click a part to select it.

## Project file format

A project is plain JSON: a model name, a list of parts, and a list of animation clips.

```json
{
  "format": "blocky-model",
  "version": 2,
  "name": "guard",
  "parts": [
    { "id": 1, "name": "Hips", "type": "box", "parent": null,
      "position": [0, 1.02, 0], "rotation": [0, 0, 0], "size": [0.48, 0.22, 0.28], "offset": [0, 0, 0],
      "sides": 0, "color": "#3a3a3a", "visible": true,
      "recipe": { "height": 1, "build": 1, "headSize": 1, "skin": "#e2b48e", "hat": false } }
  ],
  "animations": [
    { "id": "c1", "name": "walk", "fps": 24, "length": 24, "interpolation": "smooth",
      "tracks": { "7": { "rotation": [ { "f": 0, "v": [35, 0, 0] }, { "f": 12, "v": [-35, 0, 0] }, { "f": 24, "v": [35, 0, 0] } ] } } }
  ]
}
```

- `position` / `rotation` (degrees) are the part's pivot, relative to its parent.
- `size` is the shape's dimensions in metres.
- `offset` shifts the shape away from the pivot (used so limbs rotate from the joint).
- `recipe` only appears on a character root and is what the Character panel edits.
- Each track is keyed by part id; keys hold a frame `f` and a value `v` for `position`, `rotation`
  (degrees) or `size`.

Because the format is simple, you can also generate recipes and clips from scripts and open them in
the tool.

## Code layout

```
index.html              page, toolbar, panels and timeline markup
css/style.css           dark UI theme
js/main.js              app object, keyboard shortcuts, autosave, boot
js/model.js             document: parts, hierarchy, clips, serialisation, sync to Three.js objects
js/parts.js             geometry builders (unit-sized, low-poly, flat) and the palette
js/viewport.js          renderer, camera, lights, grid, orbit + transform gizmo, picking
js/animation.js         clips, sampling, the Animator (playback + keying), walk/idle/attack presets
js/timeline.js          timeline panel: clip controls, ruler, playhead, keyframe rows
js/character-panel.js   character sliders that regenerate the humanoid
js/ui.js                outliner, properties panel, palette, status bar
js/io.js                save / open .json, export .glb (with animations) / .obj
js/history.js           snapshot undo / redo
js/templates.js         humanoid recipe, random NPC, in-place rebuild
vendor/three/           Three.js r160 (MIT) and the addons used
```

Everything is a plain ES module; `window.app` exposes the app for the browser console
(for example `app.addRandomNPC()`, `app.addPresetClip('walk')` or `app.exportGLB()`).

## Using the exports

- **Three.js** — `GLTFLoader` loads the `.glb` as a `Group` whose children are the parts, named as in the
  outliner, and `gltf.animations` holds the clips for an `AnimationMixer`.
- **Godot** — drop the `.glb` into the project; the hierarchy imports as nodes and the clips as an
  `AnimationPlayer`.
- **Unity / Unreal** — import the `.glb` with their glTF importers (Unity needs a glTF package such as
  glTFast). Clips import as animation clips.
- **Blender** — File → Import → glTF 2.0; clips appear as actions.

Materials are exported as flat-coloured standard materials (roughness 1, metalness 0). The OBJ export
is geometry only.

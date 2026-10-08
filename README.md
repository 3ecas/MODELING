# Blocky — an old-school 3D modeler

A small browser tool for building low-poly, flat-shaded 3D models in the style of early 3D games
(think RuneScape Classic, PS1, N64). Models are assembled from simple parts — boxes, 6-to-8-sided
cylinders, cones, spheres, wedges — coloured with a limited palette, and exported as GLB for use in
Three.js, Godot, Unity, Unreal or Blender.

No build step, no install: open `index.html` from any static web server.

```sh
# any static server works, for example:
python3 -m http.server 8000
# then open http://localhost:8000/
```

(Opening the file directly with `file://` does not work in most browsers because ES modules need HTTP.)

## What it does

- **Parts kit** — add Box, Cylinder, Cone, Sphere, Wedge or Plane. Cylinders, cones and spheres have a
  "Sides" setting (3–32) so you can keep them chunky.
- **Move / Rotate / Size** — a 3D gizmo in the viewport (W / E / R) with snapping, plus numeric fields.
- **Parenting** — parts can be attached to other parts. Each part has a pivot, and limbs pivot at their
  joint, so a character built from parts can be posed by rotating arms and legs. A parent's size never
  stretches its children.
- **Flat colours** — a 32-colour old-school palette, or any colour you like.
- **Humanoid kit** — one click adds a posable low-poly character (hips → torso → head, arms, legs).
  "Random NPC" rolls proportions, colours, hair, hat, sword and shield.
- **Duplicate / Mirror X** — build one arm, mirror it.
- **Undo / Redo**, autosave to the browser, and project files as `.json`.
- **Export** — `.glb` (binary glTF, with hierarchy and flat colours) and `.obj`.
- **Look** — flat shading, optional wireframe, and a "Pixel" mode that renders at quarter resolution
  with no smoothing for a retro screen look.

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

Left-drag orbits, right-drag pans, wheel zooms. Click a part to select it.

## Project file format

A project is plain JSON: a model name plus a list of parts.

```json
{
  "format": "blocky-model",
  "version": 1,
  "name": "guard",
  "parts": [
    { "id": 1, "name": "Hips", "type": "box", "parent": null,
      "position": [0, 1.02, 0], "rotation": [0, 0, 0], "size": [0.48, 0.22, 0.28], "offset": [0, 0, 0],
      "sides": 0, "color": "#3a3a3a", "visible": true }
  ]
}
```

- `position` / `rotation` (degrees) are the part's pivot, relative to its parent.
- `size` is the shape's dimensions in metres.
- `offset` shifts the shape away from the pivot (used so limbs rotate from the joint).

Because the format is simple, you can also generate recipes from scripts and open them in the tool.

## Code layout

```
index.html        page and toolbar
css/style.css     dark UI theme
js/main.js        app object, keyboard shortcuts, autosave, boot
js/model.js       document: parts, hierarchy, serialisation, sync to Three.js objects
js/parts.js       geometry builders (unit-sized, low-poly, flat) and the palette
js/viewport.js    renderer, camera, lights, grid, orbit + transform gizmo, picking
js/ui.js          outliner, properties panel, palette, status bar
js/io.js          save / open .json, export .glb / .obj
js/history.js     snapshot undo / redo
js/templates.js   humanoid kit and random NPC recipes
vendor/three/     Three.js r160 (MIT) and the addons used
```

Everything is a plain ES module; `window.app` exposes the app for the browser console
(for example `app.addRandomNPC()` or `app.exportGLB()`).

## Using the exports

- **Three.js** — `GLTFLoader` loads the `.glb` as a `Group` whose children are the parts, named as in the
  outliner, so you can find and rotate limbs at runtime.
- **Godot** — drop the `.glb` into the project; the hierarchy imports as nodes.
- **Unity / Unreal** — import the `.glb` with their glTF importers (Unity needs a glTF package such as
  glTFast).
- **Blender** — File → Import → glTF 2.0.

Materials are exported as flat-coloured, unlit-friendly standard materials (roughness 1, metalness 0).

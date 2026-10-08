// Character panel: sliders, colours and extras that regenerate a humanoid in place.
// Shown whenever the selected part belongs to a character (a tree whose root carries a recipe).

import { RECIPE_SLIDERS, RECIPE_COLORS, RECIPE_FLAGS, DEFAULT_RECIPE, randomRecipe, characterRootOf } from './templates.js';
import { createColorPicker } from './colorpicker.js';

export function initCharacterPanel(app) {
  const { model } = app;
  const panel = document.getElementById('character');
  const inputs = {};

  const title = document.createElement('div');
  title.className = 'panel-title';
  title.textContent = 'Character';
  panel.appendChild(title);

  const note = document.createElement('div');
  note.className = 'hint';
  note.style.marginTop = '0';
  note.style.marginBottom = '8px';
  note.textContent = 'Sliders rebuild the whole figure. Keyframes and the root position are kept; manual edits to its parts are not.';
  panel.appendChild(note);

  for (const s of RECIPE_SLIDERS) {
    const row = document.createElement('div');
    row.className = 'row';
    const label = document.createElement('label');
    label.textContent = s.label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = s.min; input.max = s.max; input.step = 0.01;
    input.title = s.label;
    const val = document.createElement('span');
    val.className = 'val';
    input.addEventListener('input', () => { val.textContent = Number(input.value).toFixed(2); apply({ [s.key]: Number(input.value) }, false); });
    input.addEventListener('change', () => apply({ [s.key]: Number(input.value) }, true));
    row.append(label, input, val);
    panel.appendChild(row);
    inputs[s.key] = { input, val };
  }

  // Colours: a swatch per role; clicking it unfolds the inline picker under the row (no pop-ups).
  let openPicker = null;
  for (const c of RECIPE_COLORS) {
    const row = document.createElement('div');
    row.className = 'row colour';
    const label = document.createElement('label');
    label.textContent = c.label;
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'swatch-btn';
    swatch.title = `${c.label}: click to edit`;
    const hex = document.createElement('span');
    hex.className = 'val';
    const holder = document.createElement('div');
    holder.className = 'cp-holder';
    holder.hidden = true;
    const picker = createColorPicker(holder, {
      onInput: v => { swatch.style.background = v; hex.textContent = v; apply({ [c.key]: v }, false); },
      onChange: v => apply({ [c.key]: v }, true),
    });
    swatch.addEventListener('click', () => {
      const open = holder.hidden;
      if (openPicker && openPicker !== holder) openPicker.hidden = true;
      holder.hidden = !open;
      openPicker = open ? holder : null;
    });
    row.append(label, swatch, hex);
    panel.append(row, holder);
    inputs[c.key] = { swatch, hex, picker, holder };
  }

  const hairRow = document.createElement('div');
  hairRow.className = 'row';
  const hairLabel = document.createElement('label');
  hairLabel.textContent = 'Hair style';
  const hair = document.createElement('select');
  for (const [v, t] of [['short', 'Short'], ['long', 'Long'], ['bald', 'Bald']]) hair.appendChild(new Option(t, v));
  hair.addEventListener('change', () => apply({ hairStyle: hair.value }, true));
  hairRow.append(hairLabel, hair);
  panel.appendChild(hairRow);
  inputs.hairStyle = { input: hair };

  const flags = document.createElement('div');
  flags.className = 'flags';
  for (const f of RECIPE_FLAGS) {
    const label = document.createElement('label');
    label.className = 'check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.addEventListener('change', () => apply({ [f.key]: input.checked }, true));
    label.append(input, ` ${f.label}`);
    flags.appendChild(label);
    inputs[f.key] = { input };
  }
  panel.appendChild(flags);

  const actions = document.createElement('div');
  actions.className = 'actions';
  const randomBtn = document.createElement('button');
  randomBtn.type = 'button';
  randomBtn.textContent = 'Randomise';
  randomBtn.addEventListener('click', () => { const r = current(); if (r) app.setRecipe(r.id, randomRecipe()); });
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.textContent = 'Reset';
  resetBtn.addEventListener('click', () => { const r = current(); if (r) app.setRecipe(r.id, { ...DEFAULT_RECIPE }); });
  actions.append(randomBtn, resetBtn);
  panel.appendChild(actions);

  function current() { return characterRootOf(model, app.selected()); }

  function apply(patch, commit) {
    const r = current();
    if (!r) return;
    app.setRecipe(r.id, { ...r.recipe, ...patch }, { commit });
  }

  function refresh() {
    const r = current();
    panel.hidden = !r;
    if (!r) return;
    const active = document.activeElement;
    if (active && panel.contains(active) && active.type === 'range') return; // mid-drag
    if (RECIPE_COLORS.some(c => inputs[c.key].picker.dragging)) return;
    const recipe = { ...DEFAULT_RECIPE, ...r.recipe };
    for (const s of RECIPE_SLIDERS) {
      inputs[s.key].input.value = recipe[s.key];
      inputs[s.key].val.textContent = Number(recipe[s.key]).toFixed(2);
    }
    for (const c of RECIPE_COLORS) {
      const { swatch, hex, picker } = inputs[c.key];
      swatch.style.background = recipe[c.key];
      hex.textContent = recipe[c.key];
      if (!picker.dragging) picker.set(recipe[c.key]);
    }
    for (const f of RECIPE_FLAGS) inputs[f.key].input.checked = !!recipe[f.key];
    inputs.hairStyle.input.value = recipe.hairStyle;
  }

  return { refresh, current };
}

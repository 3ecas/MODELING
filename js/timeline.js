// Timeline panel: clip management, playback controls, a frame ruler with a draggable playhead,
// and one row of draggable keyframe diamonds per animated part.

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function initTimeline(app) {
  const { model, animator } = app;
  const panel = $('timeline');
  const el = {
    clip: $('tl-clip'), newClip: $('tl-new'), rename: $('tl-rename'), dup: $('tl-dup'), del: $('tl-del'),
    play: $('tl-play'), stop: $('tl-stop'), loop: $('tl-loop'),
    frame: $('tl-frame'), length: $('tl-length'), fps: $('tl-fps'), interp: $('tl-interp'),
    key: $('tl-key'), keyAll: $('tl-key-all'), delKey: $('tl-del-key'), delTrack: $('tl-del-track'),
    collapse: $('tl-collapse'), empty: $('tl-empty'), grid: $('tl-grid'),
    names: $('tl-names'), tracks: $('tl-tracks'), ruler: $('tl-ruler'), rows: $('tl-rows'), playhead: $('tl-playhead'),
  };
  const presets = { walk: $('tl-preset-walk'), idle: $('tl-preset-idle'), attack: $('tl-preset-attack') };

  let rowParts = []; // parts shown, in row order

  // ----- clip controls -----

  el.clip.addEventListener('change', () => app.setClip(el.clip.value || null));
  el.newClip.addEventListener('click', () => {
    const name = window.prompt('Clip name', `clip ${model.animations.length + 1}`);
    if (name === null) return;
    app.newClip(name.trim() || `clip ${model.animations.length + 1}`);
  });
  for (const [kind, btn] of Object.entries(presets)) btn.addEventListener('click', () => app.addPresetClip(kind));
  el.rename.addEventListener('click', () => {
    const clip = animator.clip; if (!clip) return;
    const name = window.prompt('Clip name', clip.name);
    if (name === null || !name.trim()) return;
    app.renameClip(clip.id, name.trim());
  });
  el.dup.addEventListener('click', () => { const c = animator.clip; if (c) app.duplicateClip(c.id); });
  el.del.addEventListener('click', () => {
    const c = animator.clip; if (!c) return;
    if (window.confirm(`Delete clip "${c.name}"?`)) app.deleteClip(c.id);
  });

  el.play.addEventListener('click', () => animator.toggle());
  el.stop.addEventListener('click', () => animator.stop());
  el.loop.addEventListener('change', () => { animator.loop = el.loop.checked; });
  el.frame.addEventListener('change', () => animator.setFrame(Math.round(Number(el.frame.value) || 0)));
  el.length.addEventListener('change', () => app.updateClip({ length: Number(el.length.value) }));
  el.fps.addEventListener('change', () => app.updateClip({ fps: Number(el.fps.value) }));
  el.interp.addEventListener('change', () => app.updateClip({ interpolation: el.interp.value }));

  el.key.addEventListener('click', () => app.keySelected());
  el.keyAll.addEventListener('click', () => { animator.keyAll(); app.commit(); });
  el.delKey.addEventListener('click', () => {
    let any = false;
    for (const p of app.selectedParts()) if (animator.deleteKey(p.id, Math.round(animator.frame))) any = true;
    if (any) app.commit();
  });
  el.delTrack.addEventListener('click', () => {
    let any = false;
    for (const p of app.selectedParts()) if (animator.removeTrack(p.id)) any = true;
    if (any) app.commit();
  });
  el.collapse.addEventListener('click', () => {
    panel.classList.toggle('collapsed');
    el.collapse.textContent = panel.classList.contains('collapsed') ? '▴' : '▾';
    window.dispatchEvent(new Event('resize'));
  });

  // ----- scrubbing and key dragging -----

  function frameAt(clientX) {
    const clip = animator.clip; if (!clip) return 0;
    const r = el.tracks.getBoundingClientRect();
    return clamp(Math.round(((clientX - r.left) / r.width) * clip.length), 0, clip.length);
  }

  let drag = null;
  function onPointerDown(e) {
    if (e.button !== 0 || !animator.clip) return;
    const keyEl = e.target.closest('.key');
    e.preventDefault();
    el.tracks.setPointerCapture(e.pointerId);
    if (keyEl) {
      const partId = Number(keyEl.dataset.part), f = Number(keyEl.dataset.frame);
      drag = { kind: 'key', partId, from: f, to: f, el: keyEl, startX: e.clientX, moved: false };
      app.select(partId);
      animator.setFrame(f);
      keyEl.classList.add('dragging');
    } else {
      drag = { kind: 'scrub' };
      animator.pause();
      animator.setFrame(frameAt(e.clientX));
    }
  }
  function onPointerMove(e) {
    if (!drag) return;
    if (drag.kind === 'scrub') { animator.setFrame(frameAt(e.clientX)); return; }
    if (Math.abs(e.clientX - drag.startX) > 3) drag.moved = true;
    if (!drag.moved) return;
    drag.to = frameAt(e.clientX);
    const clip = animator.clip;
    drag.el.style.left = `${(drag.to / clip.length) * 100}%`;
    animator.setFrame(drag.to);
  }
  function onPointerUp(e) {
    if (!drag) return;
    const d = drag; drag = null;
    try { el.tracks.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (d.kind === 'key') {
      d.el.classList.remove('dragging');
      if (d.moved && d.to !== d.from && animator.moveKey(d.partId, d.from, d.to)) { animator.setFrame(d.to); app.commit(); }
      else buildRows();
    }
  }
  el.tracks.addEventListener('pointerdown', onPointerDown);
  el.tracks.addEventListener('pointermove', onPointerMove);
  el.tracks.addEventListener('pointerup', onPointerUp);
  el.tracks.addEventListener('pointercancel', onPointerUp);

  // ----- rendering -----

  function clipOptions() {
    el.clip.innerHTML = '';
    el.clip.appendChild(new Option('Rest pose (no animation)', ''));
    for (const c of model.animations) el.clip.appendChild(new Option(c.name, c.id));
    el.clip.value = animator.clipId || '';
  }

  function tickStep(pxPerFrame) {
    for (const s of [1, 2, 4, 5, 6, 8, 10, 12, 24, 48, 96, 240, 480, 1200]) if (pxPerFrame * s >= 44) return s;
    return 2400;
  }

  function buildRuler(clip) {
    el.ruler.querySelectorAll('.tick').forEach(t => t.remove());
    const width = el.tracks.clientWidth || 600;
    const step = tickStep(width / clip.length);
    const minor = step >= 4 ? step / 2 : 0;
    for (let f = 0; f <= clip.length; f += minor || step) {
      const t = document.createElement('div');
      const isMajor = f % step === 0;
      t.className = isMajor ? 'tick' : 'tick minor';
      t.style.left = `${(f / clip.length) * 100}%`;
      if (isMajor) t.textContent = f;
      el.ruler.appendChild(t);
    }
    return step;
  }

  function buildRows() {
    const clip = animator.clip;
    el.names.querySelectorAll('.tl-name').forEach(n => n.remove());
    el.rows.innerHTML = '';
    rowParts = [];
    if (!clip) return;
    const step = buildRuler(clip);
    const sel = app.selected();
    const selIds = new Set(app.selectedIds());
    const cur = Math.round(animator.frame);
    for (const { part, depth } of model.ordered()) {
      if (!clip.tracks[part.id]) continue;
      rowParts.push(part);
      const name = document.createElement('div');
      name.className = 'tl-name' + (selIds.has(part.id) ? ' selected' : '');
      name.style.paddingLeft = `${8 + depth * 10}px`;
      name.textContent = part.name;
      name.title = `${part.name} — ${Object.keys(clip.tracks[part.id]).join(', ')}`;
      name.addEventListener('click', e => (e.ctrlKey || e.metaKey || e.shiftKey ? app.toggleSelect(part.id) : app.select(part.id)));
      el.names.appendChild(name);

      const row = document.createElement('div');
      row.className = 'tl-row' + (selIds.has(part.id) ? ' selected' : '');
      row.dataset.part = part.id;
      for (let f = 0; f <= clip.length; f += step) {
        const g = document.createElement('div');
        g.className = 'gridline';
        g.style.left = `${(f / clip.length) * 100}%`;
        row.appendChild(g);
      }
      for (const f of animator.keyFrames(part.id)) {
        if (f > clip.length) continue;
        const k = document.createElement('div');
        k.className = 'key' + (sel && sel.id === part.id && f === cur ? ' current' : '');
        k.style.left = `${(f / clip.length) * 100}%`;
        k.dataset.part = part.id;
        k.dataset.frame = f;
        k.title = `${part.name} @ ${f}`;
        row.appendChild(k);
      }
      el.rows.appendChild(row);
    }
  }

  function updatePlayhead() {
    const clip = animator.clip;
    if (!clip) return;
    el.playhead.style.left = `${(animator.frame / clip.length) * 100}%`;
    if (document.activeElement !== el.frame) el.frame.value = Math.round(animator.frame);
    el.play.textContent = animator.playing ? '❚❚' : '▶';
    const cur = Math.round(animator.frame);
    const sel = app.selected();
    el.rows.querySelectorAll('.key').forEach(k => {
      k.classList.toggle('current', !!sel && Number(k.dataset.part) === sel.id && Number(k.dataset.frame) === cur);
    });
  }

  function refresh() {
    if (animator.clipId && !animator.clip) { animator.setClip(null); return; } // clip vanished (undo / delete)
    clipOptions();
    const clip = animator.clip;
    const has = !!clip;
    el.empty.hidden = has;
    el.grid.hidden = !has;
    for (const b of [el.rename, el.dup, el.del, el.play, el.stop, el.frame, el.length, el.fps, el.interp, el.key, el.keyAll, el.delKey, el.delTrack]) b.disabled = !has;
    const hasChar = [...model.parts.values()].some(p => p.recipe);
    for (const b of Object.values(presets)) b.disabled = !hasChar;
    $('anim-badge').hidden = !has;
    if (clip) {
      el.length.value = clip.length;
      el.fps.value = clip.fps;
      el.interp.value = clip.interpolation;
      el.loop.checked = animator.loop;
    }
    buildRows();
    updatePlayhead();
  }

  function refreshSelection() {
    const selIds = new Set(app.selectedIds());
    el.names.querySelectorAll('.tl-name').forEach((n, i) => n.classList.toggle('selected', selIds.has(rowParts[i]?.id)));
    el.rows.querySelectorAll('.tl-row').forEach(r => r.classList.toggle('selected', selIds.has(Number(r.dataset.part))));
    updatePlayhead();
  }

  animator.onChange(kind => (kind === 'frame' ? updatePlayhead() : refresh()));
  model.onChange(kind => { if (kind !== 'update') refresh(); });
  app.onSelect(refreshSelection);
  window.addEventListener('resize', () => { if (animator.clip) buildRows(); });

  refresh();
  return { refresh, refreshSelection };
}

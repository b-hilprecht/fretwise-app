// Tabs view: study an imported tab (chords, numerals, key, annotated notes).

const $ = (sel) => document.querySelector(sel);

const state = {
  song: null, key: { tonic: 0, mode: 'major' },
  labelMode: 'degree', showScale: true, showChordTones: true,
  chords: [], cols: [], parts: [], delta: 0, current: 0, picked: null,
  showOverview: false,
};

// Section heading for a part ("Chorus ×2", "↻ Chorus — same as above").
function partTitle(p) {
  const orig = p.repeatOf != null ? state.parts[p.repeatOf] : null;
  const name = p.name || (orig && orig.name) || '';
  const times = p.times > 1 ? ` <span class="times">×${p.times}</span>` : '';
  if (orig) return `<span class="repeat">↻ ${name || 'Part'} — same as above</span>${times}`;
  return name || times ? `<b>${name}</b>${times}` : '';
}

// ---------- model ----------
function loadSong(song) {
  state.song = song || null;
  state.current = 0;
  state.picked = null;
  if (song) {
    upgradeSong(song);
    state.key = { ...song.key };
    rebuild();
    try { localStorage.setItem('fretwise:last', song.id); } catch (e) { /* ignore */ }
  } else {
    state.key = { tonic: 0, mode: 'major' };
    state.chords = [];
    state.cols = [];
    Tab.render();
  }
  renderAll();
}

// Tabs saved by older versions: re-read the stored raw text to add what's new
// (v1: section info; v2: full chord names like Gadd9, Asus2, G/B). Hand-corrected
// chords are kept.
const SONG_VERSION = 2;
function upgradeSong(song) {
  if ((song.version || 0) >= SONG_VERSION || !song.raw) return;
  try {
    const re = Importer.parse(song.raw, song.title);
    if (re.bars.length === song.bars.length) {
      if (!song.blocks) song.blocks = re.blocks;
      const sameLayout = re.segs.length === song.segs.length &&
        re.segs.every((s, i) => s.bar === song.segs[i].bar && s.from === song.segs[i].from && s.to === song.segs[i].to);
      if (sameLayout) {
        song.segs.forEach((s, i) => {
          const corrected = !Theory.sameChord(s.chord, s.guess);
          s.guess = { ...re.segs[i].guess };
          if (!corrected) s.chord = { ...re.segs[i].chord };
        });
      }
    }
  } catch (e) { /* keep the song as it is */ }
  song.version = SONG_VERSION;
  Library.save(song);
}

// Builds chords + tab columns from the stored tab, transposed to state.key.
function rebuild() {
  const song = state.song;
  let delta = Theory.mod(state.key.tonic - song.key.tonic);
  if (delta > 6) delta -= 12;
  const frets = song.bars.flatMap((b) => b.events.flatMap((e) => e.notes.map((n) => n[1])));
  if (Math.min(...frets) + delta < 0) delta += 12;
  state.delta = delta;
  const shift = (n) => ({ str: n[0], fret: n[1] + delta });

  state.parts = Importer.buildParts(song);
  state.chords = [];
  state.cols = [];
  song.segs.forEach((sg, i) => {
    const chord = {
      ...sg.chord,
      root: Theory.mod(sg.chord.root + delta),
      bass: sg.chord.bass == null ? null : Theory.mod(sg.chord.bass + delta),
    };
    const evs = song.bars[sg.bar].events.slice(sg.from, sg.to);
    state.chords.push({
      num: Theory.numeralFor(chord, state.key), bar: sg.bar, chord,
      voicing: voicingFromNotes(evs.flatMap((e) => e.notes.map(shift))),
      changed: !Theory.sameChord(sg.chord, sg.guess),
    });
    const firstInBar = i === 0 || song.segs[i - 1].bar !== sg.bar;
    // f = position inside the bar in the original tab (0..1), used for spacing
    if (!evs.length) state.cols.push({ seg: i, notes: [], bar: sg.bar, f: 0, barStart: firstInBar, segStart: true });
    evs.forEach((e, k) => state.cols.push({
      seg: i, notes: e.notes.map(shift), bar: sg.bar, f: e.f, barStart: firstInBar && k === 0, segStart: k === 0,
    }));
  });
  if (state.current >= state.chords.length) state.current = 0;
  Tab.render();
}

// The shape a chord is played with in the tab: most-used fret on each string.
function voicingFromNotes(notes) {
  const frets = [-1, -1, -1, -1, -1, -1];
  for (let s = 0; s < 6; s++) {
    const count = {};
    notes.filter((n) => n.str === s).forEach((n) => { count[n.fret] = (count[n.fret] || 0) + 1; });
    const best = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
    if (best) frets[s] = +best[0];
  }
  return { frets };
}

// Click a tab column: hear it, jump to its chord, show its notes on the fretboard.
function hearColumn(idx) {
  const col = state.cols[idx];
  const ctx = AudioEngine.ensure();
  col.notes.forEach((n, k) => AudioEngine.pluck(n.str, Theory.OPEN_MIDI[n.str] + n.fret, ctx.currentTime + 0.01 + k * 0.012));
  state.picked = idx;
  if (state.current !== col.seg) {
    state.current = col.seg;
    renderProgression();
    renderDiatonic();
  }
  renderFretboard();
  Tab.setPlayhead(idx);
}

// ---------- rendering ----------
function renderAll() {
  const has = !!state.song;
  $('#emptyState').classList.toggle('hidden', has);
  $('#songMain').classList.toggle('hidden', !has);
  refreshSongSelect();
  if (!has) return;
  renderControls();
  Tab.render(); // again, now that the view is visible and has a real width
  renderProgression();
  renderFretboard();
  renderSide();
}

function renderControls() {
  const { song, key } = state;
  $('#songTitle').textContent = song.title;
  $('#songMeta').textContent = `${song.bars.length} bars · chords ${song.chordSource === 'names' ? 'from the chord names in the tab' : 'guessed from the notes'}`;
  const ks = $('#keySelect');
  ks.innerHTML = '';
  for (let t = 0; t < 12; t++) {
    const k = { tonic: t, mode: key.mode };
    ks.appendChild(new Option(Theory.keyName(k) + (t === song.key.tonic ? ' (original)' : ''), t));
  }
  ks.value = key.tonic;
  document.querySelectorAll('[data-label]').forEach((b) => b.classList.toggle('active', b.dataset.label === state.labelMode));
  $('#showScale').checked = state.showScale;
  $('#showTones').checked = state.showChordTones;
}

// Chord overview (collapsed by default): one cell per bar, grouped by section like the
// tab. Bars per row is a multiple of the tab's bars per line, so rows line up with it.
function renderProgression() {
  const el = $('#progression');
  $('#toggleChords').textContent = (state.showOverview ? '▾' : '▸') + ' Chord overview';
  el.classList.toggle('hidden', !state.showOverview);
  el.innerHTML = '';
  if (!state.showOverview) return;
  const tabBpr = Tab.layout().bpr;
  const width = el.clientWidth || 900;
  const bpr = [8, 4, 2, 1].find((n) => n >= tabBpr && width / n >= 105) || tabBpr;
  const cells = [];
  for (const p of state.parts) {
    const title = partTitle(p);
    if (title) el.insertAdjacentHTML('beforeend', `<div class="part-head">${title}</div>`);
    if (p.repeatOf != null) continue;
    const grid = document.createElement('div');
    grid.className = 'prog-grid';
    grid.style.gridTemplateColumns = `repeat(${bpr}, minmax(0, 1fr))`;
    for (let b = p.start; b < p.end; b++) {
      const cell = document.createElement('div');
      cell.className = 'bar-chords';
      grid.appendChild(cell);
      cells[b] = cell;
    }
    el.appendChild(grid);
  }
  state.chords.forEach((c, i) => {
    if (!cells[c.bar]) return; // bar of a repeated part: not shown
    const card = document.createElement('div');
    card.className = `chord-card ${Theory.degreeClass(c.chord.root, state.key)}` + (i === state.current ? ' current' : '') + (c.changed ? ' changed' : '');
    card.innerHTML = `
      <button class="swap" title="Correct this chord">⇄</button>
      <div class="num">${c.num}</div>
      <div class="name">${Theory.chordName(c.chord, state.key)}</div>`;
    card.onclick = () => {
      state.current = i;
      state.picked = null;
      AudioEngine.strum(c.voicing.frets);
      renderProgression();
      renderFretboard();
      renderDiatonic();
    };
    card.querySelector('.swap').onclick = (e) => {
      e.stopPropagation();
      openSwap(card, i);
    };
    const cell = cells[c.bar];
    cell.appendChild(card);
    if (cell.children.length >= 3) cell.classList.add('dense');
  });
}

function renderFretboard() {
  const c = state.chords[state.current];
  const marks = {};
  const pick = state.picked != null ? state.cols[state.picked] : null;
  if (pick && pick.seg === state.current) pick.notes.forEach((n) => { marks[`${n.str}-${n.fret}`] = 'picked'; });
  Fretboard.render($('#fretboard'), {
    idPrefix: 'fb', key: state.key, chord: c.chord, voicing: c.voicing,
    labelMode: state.labelMode, showScale: state.showScale, showChordTones: state.showChordTones,
    marks, onClick: (s, f) => AudioEngine.pluck(s, Theory.OPEN_MIDI[s] + f),
  });
  const tones = Theory.chordIntervals(c.chord)
    .map((iv) => {
      const pc = c.chord.root + iv;
      const d = Theory.degreeOf(pc, state.key);
      return `<span class="tone-chip ${Theory.degreeClass(pc, state.key)}">${Theory.noteName(pc, state.key)} <small>${d || 'out of key'}</small></span>`;
    })
    .join('');
  $('#nowPlaying').innerHTML =
    `<span class="np-num">${c.num}</span> <b>${Theory.chordName(c.chord, state.key)}</b> ` +
    `<span class="muted-txt">${Theory.qualityWord(c.chord)}</span> ${tones}`;
}

function renderSide() {
  $('#keyName').textContent = Theory.keyName(state.key);
  renderDiatonic();
  renderImportCard();
  $('#concepts').innerHTML = insights().map(([t, d]) => `<div class="concept"><b>${t}</b><p>${d}</p></div>`).join('');
  const done = loadDone();
  const ul = $('#challenges');
  ul.innerHTML = '';
  CHALLENGES.forEach((text, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<label><input type="checkbox" ${done[i] ? 'checked' : ''}> <span>${text}</span></label>`;
    li.querySelector('input').onchange = (e) => { done[i] = e.target.checked; saveDone(done); };
    ul.appendChild(li);
  });
}

function renderDiatonic() {
  const el = $('#diatonic');
  el.innerHTML = '';
  // compare plain triads: Gadd9 and G/B both count as "I is used"
  const used = new Set(state.chords.map((c) => Theory.baseNumeral(c.chord, state.key)));
  const cur = Theory.baseNumeral(state.chords[state.current].chord, state.key);
  for (const num of Theory.diatonic(state.key)) {
    const ch = Theory.chordFromNumeral(num, state.key);
    const b = document.createElement('button');
    b.className = `dia ${Theory.degreeClass(ch.root, state.key)}` + (used.has(num) ? ' used' : '') + (num === cur ? ' current' : '');
    b.innerHTML = `<span class="n">${num}</span><span class="c">${Theory.chordName(ch, state.key)}</span>`;
    b.onclick = () => AudioEngine.strum(Theory.chooseVoicing(ch, 0).frets);
    el.appendChild(b);
  }
  const groups = { maj: [], min: [], dim: [] };
  Theory.diatonic(state.key).forEach((n) => groups[Theory.chordFromNumeral(n, state.key).quality].push(n));
  $('#diatonicHint').innerHTML =
    `major: ${groups.maj.join(' ')} · minor: ${groups.min.join(' ')} · dim: ${groups.dim.join(' ')}`;
}

const CHALLENGES = [
  'Set Labels to “Key degrees” and go through the tab saying each note’s degree out loud.',
  'Check every guessed chord by ear (click it). Fix the wrong ones with ⇄.',
  'Find the dashed notes in the tab. They’re melody or passing notes outside the chord. Which degree (color) are they?',
  'Transpose it with the Key menu. All the frets move, but the numerals stay the same.',
  'Play the progression with your own picking pattern, using the numerals instead of the tab.',
];

function renderImportCard() {
  const song = state.song;
  const keyEq = (a, b) => a.tonic === b.tonic && a.mode === b.mode;
  const alts = (song.keyAlternatives || []).filter((k) => !keyEq(k, song.key)).slice(0, 3);
  const el = $('#importInfo');
  el.innerHTML = `
    <p>Detected key: <b>${Theory.keyName(song.key)}</b>${state.delta ? ` <span class="muted-txt">(transposed to ${Theory.keyName(state.key)})</span>` : ''}</p>
    ${alts.length ? '<p class="muted-txt">Sounds like a different home? Try:</p><div class="alt-keys"></div>' : ''}
    <p class="muted-txt">${song.chordSource === 'names' ? 'Chords were taken from the chord names written in the tab.' : 'Chords were guessed from the notes in each bar. Use ⇄ on a chord to correct it.'}</p>
    <button class="danger" id="deleteTab">Delete this tab</button>`;
  const box = el.querySelector('.alt-keys');
  alts.forEach((k) => {
    const b = document.createElement('button');
    b.textContent = Theory.keyName(k);
    b.onclick = () => {
      song.key = { ...k };
      state.key = { ...k };
      Library.save(song);
      rebuild();
      renderAll();
    };
    box.appendChild(b);
  });
  el.querySelector('#deleteTab').onclick = () => {
    if (!confirm(`Delete “${song.title}”? This can’t be undone (unless you exported a backup).`)) return;
    Library.remove(song.id);
    loadSong(Library.list()[0]);
  };
}

function insights() {
  const nums = [...new Set(state.chords.map((c) => c.num))];
  const scale = Theory.scalePcs(state.key);
  // outside the key = the chord has a note that isn't in the scale (E7 in A minor: G♯)
  const outside = [...new Set(state.chords
    .filter((c) => Theory.chordIntervals(c.chord).some((i) => !scale.has(Theory.mod(c.chord.root + i))))
    .map((c) => c.num))];
  let total = 0, tones = 0, inScale = 0;
  for (const col of state.cols) {
    const ch = state.chords[col.seg].chord;
    const iv = Theory.chordIntervals(ch);
    for (const n of col.notes) {
      const pc = Theory.mod(Theory.OPEN_MIDI[n.str] + n.fret);
      total++;
      if (iv.includes(Theory.mod(pc - ch.root))) tones++;
      if (scale.has(pc)) inScale++;
    }
  }
  const pct = (x) => (total ? Math.round((100 * x) / total) : 0);
  const out = [
    [`Key: ${Theory.keyName(state.key)}`, `Guessed from which notes appear most and which chord the tab starts and ends on. ${pct(inScale)}% of the notes are in the scale.`],
    ['Chords as numerals', `${nums.join(' · ')}. Those are the building blocks. Same numerals in another key = same song.`],
    ['Chord tones vs. the rest', `${pct(tones)}% of the notes belong to the chord being played (filled boxes in the tab). The dashed ones are melody or passing notes.`],
  ];
  if (outside.length) {
    out.push(['Outside the key', `${outside.join(', ')} ${outside.length > 1 ? 'aren’t' : 'isn’t'} in ${Theory.keyName(state.key)}. It’s either a borrowed chord or a wrong guess (of the chord or the key).`]);
  }
  return out;
}

// ---------- chord correction popover ----------
function openSwap(card, i) {
  const pop = $('#popover');
  pop.innerHTML = '<div class="pop-title">Correct to…</div>';
  const opts = [...Theory.diatonic(state.key), ...Theory.borrowed(state.key)];
  opts.forEach((num, k) => {
    if (k === 7) pop.insertAdjacentHTML('beforeend', '<div class="pop-sub">outside the key</div>');
    const ch = Theory.chordFromNumeral(num, state.key);
    const b = document.createElement('button');
    b.className = 'pop-opt' + (num === state.chords[i].num ? ' current' : '');
    b.innerHTML = `<b class="${Theory.degreeClass(ch.root, state.key)}">${num}</b> ${Theory.chordName(ch, state.key)}`;
    b.onclick = () => {
      state.song.segs[i].chord = { root: Theory.mod(ch.root - state.delta), quality: ch.quality, seventh: ch.seventh, add: [], bass: null };
      Library.save(state.song);
      state.current = i;
      rebuild();
      AudioEngine.strum(state.chords[i].voicing.frets);
      renderProgression(); renderFretboard(); renderSide();
      closeSwap();
    };
    pop.appendChild(b);
  });
  const reset = document.createElement('button');
  reset.className = 'pop-reset';
  reset.textContent = '↺ Back to the guessed chords';
  reset.onclick = () => {
    state.song.segs.forEach((sg) => { sg.chord = { ...sg.guess }; });
    Library.save(state.song);
    rebuild(); renderProgression(); renderFretboard(); renderSide(); closeSwap();
  };
  pop.appendChild(reset);
  const r = card.getBoundingClientRect();
  pop.style.left = `${Math.min(r.left + window.scrollX, window.innerWidth - 220)}px`;
  pop.style.top = `${r.bottom + window.scrollY + 6}px`;
  pop.classList.remove('hidden');
}
const closeSwap = () => $('#popover').classList.add('hidden');

// ---------- persistence (per-browser) ----------
function loadDone() {
  try { return JSON.parse(localStorage.getItem('fretwise:done:' + state.song.id)) || {}; } catch (e) { return {}; }
}
function saveDone(d) {
  try { localStorage.setItem('fretwise:done:' + state.song.id, JSON.stringify(d)); } catch (e) { /* ignore */ }
}

// ---------- library + import dialog ----------
function refreshSongSelect() {
  const ss = $('#songSelect');
  const lib = Library.list();
  ss.innerHTML = '';
  if (!lib.length) ss.appendChild(new Option('No tabs yet', ''));
  lib.forEach((s) => ss.appendChild(new Option(s.title, s.id)));
  ss.disabled = !lib.length;
  if (state.song) ss.value = state.song.id;
}

function showView(name) {
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x.dataset.view === name));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('hidden', v.id !== 'view-' + name));
  if (name === 'drills') Drills.enter();
}

function openImport(withExample) {
  $('#impError').textContent = '';
  $('#importModal').classList.remove('hidden');
  if (withExample) {
    $('#impText').value = Importer.EXAMPLE;
    if (!$('#impTitle').value) $('#impTitle').value = 'Example: A minor arpeggios';
  }
  $('#impText').focus();
}

function initImport() {
  const modal = $('#importModal');
  const close = () => modal.classList.add('hidden');
  $('#importBtn').onclick = () => openImport(false);
  $('#emptyImport').onclick = () => openImport(false);
  $('#emptyExample').onclick = () => openImport(true);
  $('#impCancel').onclick = close;
  modal.onclick = (e) => { if (e.target === modal) close(); };
  $('#impExample').onclick = () => openImport(true);

  // Bookmark button: a javascript: link the user drags to their bookmarks bar.
  const bm = $('#bmLink');
  bm.href = BOOKMARKLET_HREF;
  bm.onclick = (e) => {
    e.preventDefault();
    $('#impError').textContent = 'Drag this button to your bookmarks bar, then click it while you’re on a tab page.';
  };

  // "# Title" first line (added by the bookmark button) fills in the title.
  const takeTitle = () => {
    const m = $('#impText').value.match(/^# (.+)\n/);
    if (m) {
      if (!$('#impTitle').value.trim()) $('#impTitle').value = m[1].trim();
      $('#impText').value = $('#impText').value.slice(m[0].length);
    }
  };
  $('#impText').addEventListener('input', takeTitle);
  $('#impPaste').onclick = async () => {
    try {
      $('#impText').value = await navigator.clipboard.readText();
      takeTitle();
      $('#impError').textContent = '';
    } catch (e) {
      $('#impText').focus();
      $('#impError').textContent = 'The browser blocked reading the clipboard. Click in the box and press Ctrl+V instead.';
    }
  };

  $('#impGo').onclick = () => {
    takeTitle();
    try {
      const song = Importer.parse($('#impText').value, $('#impTitle').value.trim() || 'Untitled tab');
      if (!Library.save(song)) return;
      close();
      $('#impText').value = '';
      $('#impTitle').value = '';
      showView('song');
      loadSong(song);
    } catch (e) {
      $('#impError').textContent = e.message;
    }
  };
  $('#libExport').onclick = () => Library.exportFile();
  $('#libImport').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const n = await Library.importFile(f);
      $('#impError').textContent = `Restored ${n} tab${n === 1 ? '' : 's'}. Find them in the tab menu.`;
      if (!state.song) loadSong(Library.list()[0]); else refreshSongSelect();
    } catch (err) {
      $('#impError').textContent = err.message;
    }
    e.target.value = '';
  };
}

// ---------- wiring ----------
function init() {
  const ss = $('#songSelect');
  ss.onchange = () => loadSong(Library.list().find((s) => s.id === ss.value));
  $('#keySelect').onchange = (e) => {
    state.key.tonic = +e.target.value;
    state.picked = null;
    rebuild(); renderProgression(); renderFretboard(); renderSide();
  };
  $('#showTab').onchange = (e) => $('#tab').classList.toggle('hidden', !e.target.checked);
  $('#toggleChords').onclick = () => { state.showOverview = !state.showOverview; renderProgression(); };
  document.querySelectorAll('[data-label]').forEach((b) => {
    b.onclick = () => { state.labelMode = b.dataset.label; renderControls(); renderFretboard(); Tab.render(); };
  });
  $('#showScale').onchange = (e) => { state.showScale = e.target.checked; renderFretboard(); };
  $('#showTones').onchange = (e) => { state.showChordTones = e.target.checked; renderFretboard(); };
  document.addEventListener('click', (e) => {
    const pop = $('#popover');
    if (!pop.contains(e.target) && !e.target.closest('.swap')) closeSwap();
  });
  document.querySelectorAll('.tabs button').forEach((b) => { b.onclick = () => showView(b.dataset.view); });
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.song) { Tab.render(); renderProgression(); } }, 150);
  });

  initImport();
  Drills.init();
  const lib = Library.list();
  let last = null;
  try { last = localStorage.getItem('fretwise:last'); } catch (e) { /* ignore */ }
  loadSong(lib.find((s) => s.id === last) || lib[0]);
}

document.addEventListener('DOMContentLoaded', init);

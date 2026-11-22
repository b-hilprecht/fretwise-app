// Annotated tab. Renders state.cols (one column per note column of the imported tab).
// Fret numbers are colored by scale degree (same colors as chords); notes outside the
// current chord are dashed. Hover a note for its name, degree and role in the chord.
//
// Layout: grouped into parts (sections like [Chorus]); repeated parts collapse into one
// "same as above" line. Inside a part: a fixed number of bars per line (4, else 2,
// else 1), every bar the same width, so bar lines stack like sheet music.

const Tab = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const LEFT = 26, HEAD = 34, GAP = 26, MIN_COL = 23, PAD = 6;
  const STRING_NAMES = ['E', 'A', 'D', 'G', 'B', 'e'];
  let playhead = null;

  const el = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const ly = (str) => HEAD + (5 - str) * GAP;

  // Column indices grouped by bar.
  function bars() {
    const out = [];
    state.cols.forEach((c, i) => { (out[c.bar] = out[c.bar] || []).push(i); });
    for (let b = 0; b < out.length; b++) out[b] = out[b] || [];
    return out;
  }

  // x of each column inside a bar: follows the spacing of the original tab (roughly the
  // rhythm), pushed apart where notes would overlap; even spacing if that doesn't fit.
  function positions(idxs, barW) {
    const pad = 14, n = idxs.length;
    let xs = idxs.map((ci) => pad + (state.cols[ci].f || 0) * (barW - 2 * pad));
    for (let k = 1; k < n; k++) if (xs[k] - xs[k - 1] < MIN_COL) xs[k] = xs[k - 1] + MIN_COL;
    if (n && xs[n - 1] > barW - pad) xs = idxs.map((_, k) => (k + 0.5) * (barW / n));
    return xs;
  }

  // Bars per line and bar width, from the available width and the busiest bar.
  function layout() {
    const wrap = document.getElementById('tab');
    const width = (wrap && wrap.clientWidth) || document.getElementById('songMain')?.clientWidth || 900;
    const avail = width - 22 - LEFT - PAD;
    const maxCols = Math.max(1, ...bars().map((b) => b.length));
    for (const bpr of [4, 2]) {
      if (avail / bpr / maxCols >= MIN_COL) return { bpr, barW: avail / bpr };
    }
    return { bpr: 1, barW: Math.max(avail, maxCols * MIN_COL) };
  }

  function noteTip(pc, chord) {
    const d = Theory.degreeOf(pc, state.key);
    const iv = Theory.INTERVAL[Theory.mod(pc - chord.root)];
    const inChord = Theory.chordIntervals(chord).includes(Theory.mod(pc - chord.root));
    const name = Theory.chordName(chord, state.key);
    return `<b>${Theory.noteName(pc, state.key)}</b> · ${d ? `degree <b>${d}</b>` : 'outside the key'} · ` +
      (inChord ? `${Theory.roleName(pc - chord.root, chord)} of ${name}` : `passing note over ${name}`);
  }

  function renderRow(wrap, rowBars, barW, bpr) {
    const H = HEAD + GAP * 5 + 12;
    const W = LEFT + bpr * barW + PAD;
    const xEnd = LEFT + rowBars.length * barW;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'tab-row' }, wrap);
    const xsOf = rowBars.map((idxs) => positions(idxs, barW));

    // click targets / playhead: from halfway to the previous note to halfway to the next
    rowBars.forEach((idxs, bi) => {
      const xs = xsOf[bi], x0 = LEFT + bi * barW;
      idxs.forEach((ci, k) => {
        const a = k === 0 ? 0 : (xs[k - 1] + xs[k]) / 2;
        const b = k === idxs.length - 1 ? barW : (xs[k] + xs[k + 1]) / 2;
        el('rect', { x: x0 + a, y: HEAD - 12, width: b - a, height: GAP * 5 + 24, class: 'tab-col', id: `tab-col-${ci}`, 'data-col': ci }, svg);
      });
    });
    for (let str = 0; str < 6; str++) {
      el('line', { x1: LEFT, x2: xEnd, y1: ly(str), y2: ly(str), class: 'tab-line' }, svg);
      el('text', { x: 10, y: ly(str), class: 'tab-sname' }, svg).textContent = STRING_NAMES[str];
    }
    rowBars.forEach((_, bi) => {
      const x0 = LEFT + bi * barW;
      el('line', { x1: x0, x2: x0, y1: ly(5), y2: ly(0), class: 'tab-bar' }, svg);
    });
    el('line', { x1: xEnd, x2: xEnd, y1: ly(5), y2: ly(0), class: 'tab-bar' }, svg);

    rowBars.forEach((idxs, bi) => {
      const xs = xsOf[bi], x0 = LEFT + bi * barW;
      const nextSegX = (k) => {
        for (let j = k + 1; j < idxs.length; j++) if (state.cols[idxs[j]].segStart) return xs[j];
        return barW;
      };
      idxs.forEach((ci, k) => {
        const c = state.cols[ci];
        const x = x0 + xs[k];
        const chord = state.chords[c.seg];
        if (c.segStart) {
          // label starts at the bar line for the bar's first chord, else at its first note
          const lx = k === 0 ? x0 + 4 : x - 10;
          const t = el('text', { x: lx, y: 14, class: 'tab-chord' }, svg);
          el('tspan', { class: `tab-num ${Theory.degreeClass(chord.chord.root, state.key)}` }, t).textContent = chord.num + ' ';
          if (x0 + nextSegX(k) - lx >= 75) el('tspan', { class: 'tab-chord-name' }, t).textContent = Theory.chordName(chord.chord, state.key);
        }
        for (const { str, fret } of c.notes) {
          const pc = Theory.mod(Theory.OPEN_MIDI[str] + fret);
          const inChord = Theory.chordIntervals(chord.chord).includes(Theory.mod(pc - chord.chord.root));
          const g = el('g', { class: `tab-note ${Theory.degreeClass(pc, state.key)} ${inChord ? 'in' : 'out'}`, 'data-col': ci }, svg);
          g.dataset.tip = noteTip(pc, chord.chord);
          el('rect', { x: x - 11, y: ly(str) - 9, width: 22, height: 18, rx: 4 }, g);
          el('text', { x, y: ly(str), class: 'tab-fret' }, g).textContent = fret;
        }
      });
    });

    svg.addEventListener('click', (e) => {
      const t = e.target.closest('[data-col]');
      if (t) hearColumn(+t.dataset.col);
    });
    svg.addEventListener('mousemove', (e) => {
      const g = e.target.closest('.tab-note');
      if (g) showTip(g.dataset.tip, e.clientX, e.clientY); else hideTip();
    });
    svg.addEventListener('mouseleave', hideTip);
  }

  function render() {
    const wrap = document.getElementById('tab');
    if (!wrap) return;
    wrap.innerHTML = '';
    playhead = null;
    hideTip();
    if (!state.cols.length) return;
    const { bpr, barW } = layout();
    const all = bars();
    const parts = state.parts && state.parts.length ? state.parts : [{ start: 0, end: all.length, times: 1, repeatOf: null }];
    for (const p of parts) {
      const title = partTitle(p);
      if (title) wrap.insertAdjacentHTML('beforeend', `<div class="part-head">${title}</div>`);
      if (p.repeatOf != null) continue;
      const partBars = all.slice(p.start, p.end);
      for (let r = 0; r < partBars.length; r += bpr) renderRow(wrap, partBars.slice(r, r + bpr), barW, bpr);
    }
    setPlayhead(playhead);
  }

  function showTip(html, x, y) {
    const tip = document.getElementById('noteTip');
    tip.innerHTML = html;
    tip.classList.remove('hidden');
    const w = tip.offsetWidth;
    tip.style.left = `${Math.min(x + 14, window.innerWidth - w - 8) + window.scrollX}px`;
    tip.style.top = `${y + 16 + window.scrollY}px`;
  }
  function hideTip() { document.getElementById('noteTip')?.classList.add('hidden'); }

  function setPlayhead(i) {
    if (playhead != null) document.getElementById(`tab-col-${playhead}`)?.classList.remove('now');
    playhead = i;
    if (i != null) document.getElementById(`tab-col-${i}`)?.classList.add('now');
  }

  return { render, setPlayhead, layout };
})();

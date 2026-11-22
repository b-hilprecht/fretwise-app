// SVG fretboard. High e on top (like tab), low E at the bottom.

const Fretboard = (() => {
  const FRETS = 15, LEFT = 60, TOP = 24, GAP = 30, SCALE = 1560;
  const NS = 'http://www.w3.org/2000/svg';
  const pos = (f) => LEFT + SCALE * (1 - Math.pow(2, -f / 12));
  const W = pos(FRETS) + 16;
  const H = TOP * 2 + GAP * 5 + 16;
  const cx = (f) => (f === 0 ? LEFT - 22 : (pos(f - 1) + pos(f)) / 2);
  const cy = (s) => TOP + (5 - s) * GAP;

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function label(o, pc) {
    switch (o.labelMode) {
      case 'note': return Theory.noteName(pc, o.key);
      case 'degree': return Theory.DEGREE[Theory.mod(pc - o.key.tonic)];
      case 'interval': return o.chord ? Theory.INTERVAL[Theory.mod(pc - o.chord.root)] : '';
      default: return '';
    }
  }

  // o: { idPrefix, key, chord, voicing, labelMode, showScale, showChordTones, marks, reveal, onClick }
  function render(svg, o) {
    svg.innerHTML = '';
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

    el('rect', { x: LEFT, y: TOP - 12, width: pos(FRETS) - LEFT, height: GAP * 5 + 24, rx: 3, class: 'board' }, svg);
    const midY = TOP + GAP * 2.5;
    [3, 5, 7, 9, 15].forEach((f) => el('circle', { cx: cx(f), cy: midY, r: 6, class: 'inlay' }, svg));
    el('circle', { cx: cx(12), cy: TOP + GAP * 1.5, r: 6, class: 'inlay' }, svg);
    el('circle', { cx: cx(12), cy: TOP + GAP * 3.5, r: 6, class: 'inlay' }, svg);
    for (let f = 1; f <= FRETS; f++) el('line', { x1: pos(f), x2: pos(f), y1: TOP - 12, y2: TOP + GAP * 5 + 12, class: 'fret' }, svg);
    el('rect', { x: LEFT - 4, y: TOP - 12, width: 7, height: GAP * 5 + 24, class: 'nut' }, svg);
    for (let s = 0; s < 6; s++) {
      el('line', { x1: LEFT, x2: pos(FRETS), y1: cy(s), y2: cy(s), class: 'string', 'stroke-width': 0.8 + (5 - s) * 0.35 }, svg);
    }
    [3, 5, 7, 9, 12, 15].forEach((f) => {
      const t = el('text', { x: cx(f), y: H - 4, class: 'fretnum' }, svg);
      t.textContent = f;
    });

    const scale = o.key ? Theory.scalePcs(o.key) : new Set();
    const tones = o.chord ? Theory.chordIntervals(o.chord) : [];

    for (let s = 0; s < 6; s++) {
      if (o.voicing && o.voicing.frets[s] < 0) {
        const x = el('text', { x: 16, y: cy(s), class: 'muted' }, svg);
        x.textContent = '×';
      }
      for (let f = 0; f <= FRETS; f++) {
        const pc = Theory.mod(Theory.OPEN_MIDI[s] + f);
        const ivl = o.chord ? Theory.mod(pc - o.chord.root) : null;
        const isTone = o.chord && tones.includes(ivl);
        const inVoicing = o.voicing && o.voicing.frets[s] === f;
        const mark = o.marks && o.marks[`${s}-${f}`];

        let cls, r, showLabel = true;
        const dc = Theory.degreeClass(pc, o.key);
        if (inVoicing) { cls = `dot voicing ${dc}`; r = 12.5; }
        else if (isTone && o.showChordTones) { cls = `dot tone ${dc}`; r = 10.5; }
        else if (o.showScale && scale.has(pc)) { cls = `dot scale ${dc}`; r = 8.5; }
        else { cls = 'dot empty'; r = 11; showLabel = false; }
        if (mark) { cls += ' ' + mark; showLabel = true; }

        const g = el('g', { id: `${o.idPrefix}-${s}-${f}`, class: cls, 'data-s': s, 'data-f': f }, svg);
        el('circle', { cx: cx(f), cy: cy(s), r }, g);
        const txt = mark && o.reveal ? Theory.noteName(pc, o.key) : showLabel ? label(o, pc) : '';
        if (txt) {
          const t = el('text', { x: cx(f), y: cy(s), class: 'lbl' }, g);
          t.textContent = txt;
        }
      }
    }

    svg.onclick = (e) => {
      const g = e.target.closest('g[data-s]');
      if (g && o.onClick) o.onClick(+g.dataset.s, +g.dataset.f, g);
    };
  }

  function flash(prefix, notes) {
    for (const [s, f] of notes) {
      const g = document.getElementById(`${prefix}-${s}-${f}`);
      if (!g) continue;
      g.classList.remove('hit');
      void g.getBBox();
      g.classList.add('hit');
      setTimeout(() => g.classList.remove('hit'), 220);
    }
  }

  return { render, flash };
})();

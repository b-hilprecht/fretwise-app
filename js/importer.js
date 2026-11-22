// Tab import: parse ASCII tab, guess key + chords with plain code (no AI), store locally.
//
// Parsing:  6 consecutive "e|--0--|" style lines = one block. Columns with a '|' on
//           most strings are bar lines. Digits are frets (two digits = 10..24).
//           Rhythm is ignored: a tab is just an ordered list of note columns per bar.
// Chords:   if a line of chord names sits right above a block, those are used.
//           Otherwise every bar (or half bar) is matched against 60 chord templates
//           (12 roots x maj/min/7/m7/dim). Bass notes count extra.
// Key:      note histogram correlated with Krumhansl-Kessler key profiles, then
//           nudged by first/last chord and how many chords fit the key.

const Importer = (() => {
  const mod = Theory.mod;
  const KK_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const KK_MIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  const QUALS = [
    { quality: 'maj', seventh: '' }, { quality: 'min', seventh: '' },
    { quality: 'maj', seventh: '7' }, { quality: 'min', seventh: '7' },
    { quality: 'dim', seventh: '' },
  ];
  const LABEL = /^\s*(?:[eEBGDAbgda][#b]?)?\s*[|:]?/;
  const CHORD_TOKEN = /^[A-G][#b♯♭]?(maj|min|m|dim|aug|sus|add|M|°|\+|Δ|\d|\(|\))*(\/[A-G][#b♯♭]?)?$/;

  // ---------- parsing ----------
  function isTabLine(line) {
    const t = line.trim();
    const dashes = (t.match(/-/g) || []).length;
    if (dashes < 4) return false;
    const body = t.replace(LABEL, '');
    // Allowed characters are the real guard; dense technique lines (5h7p5-7/9) have few dashes.
    return /^[-0-9|:hpbrxX/\\~()^.*sS=<>[\]vtTPH ]+$/.test(body) && dashes >= body.length * 0.15;
  }

  function isChordLine(line) {
    const toks = line.trim().split(/\s+/).filter(Boolean);
    return toks.length > 0 && toks.every((t) => CHORD_TOKEN.test(t));
  }

  function parseBlock(block, chordLine, bars, hints) {
    const starts = block.map((l) => l.match(LABEL)[0].length);
    const content = block.map((l, k) => l.slice(starts[k]).replace(/\s+$/, ''));
    const maxLen = Math.max(...content.map((c) => c.length));

    const barCols = [];
    for (let c = 0; c < maxLen; c++) {
      if (content.filter((ln) => ln[c] === '|').length >= 3) barCols.push(c);
    }
    const segs = [];
    let prev = -1;
    for (const p of [...barCols, maxLen]) {
      if (p - prev - 1 >= 2) {
        const sg = { start: prev + 1, end: p };
        if (content.filter((ln) => ln.slice(sg.start, sg.end).includes('-')).length >= 3) segs.push(sg);
      }
      prev = p;
    }

    const first = bars.length;
    for (const sg of segs) {
      const cols = new Map();
      content.forEach((ln, k) => {
        const str = 5 - k; // top line = high e
        for (let c = sg.start; c < sg.end; c++) {
          if (!/[0-9]/.test(ln[c] || '')) continue;
          const at = c;
          let num = ln[c];
          if (c + 1 < sg.end && /[0-9]/.test(ln[c + 1] || '') && +(num + ln[c + 1]) <= 24) num += ln[++c];
          if (!cols.has(at)) cols.set(at, []);
          cols.get(at).push([str, +num]);
        }
      });
      const events = [...cols.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([c, notes]) => ({ f: (c - sg.start) / (sg.end - sg.start), notes: notes.sort((a, b) => a[0] - b[0]) }));
      bars.push({ events });
    }

    const names = chordLine ? chordLine.trim().split(/\s+/).map((t) => Theory.parseChordName(t)) : [];
    if (names.length && names.length === segs.length && names.every(Boolean)) {
      // Exactly one chord name per bar: trust the order, not the exact columns.
      names.forEach((ch, i) => hints.push({ bar: first + i, f: 0, chord: ch }));
    } else if (chordLine) {
      const off = starts[0];
      const re = /\S+/g;
      let m;
      while ((m = re.exec(chordLine))) {
        const col = m.index - off;
        let si = segs.findIndex((sg) => col < sg.end);
        if (si < 0) continue;
        const ch = Theory.parseChordName(m[0]);
        if (!ch) continue;
        let f = Math.max(0, (col - segs[si].start) / (segs[si].end - segs[si].start));
        // Chord names are often a few characters off: snap ones near a bar line onto it.
        if (f > 0.8 && si + 1 < segs.length) { si++; f = 0; } else if (f < 0.2) f = 0;
        hints.push({ bar: first + si, f, chord: ch });
      }
    }
  }

  // ---------- analysis ----------
  function analyze(events) {
    const w = new Array(12).fill(0);
    const bass = new Array(12).fill(0);
    let total = 0;
    events.forEach((ev, k) => {
      let low = null;
      for (const [s, f] of ev.notes) {
        const midi = Theory.OPEN_MIDI[s] + f;
        w[midi % 12] += 1;
        total += 1;
        if (low == null || midi < low) low = midi;
      }
      if (low != null) bass[low % 12] += k === 0 ? 1 : 0.5;
    });
    return { w, bass, total };
  }

  function bestChord(an, key) {
    if (!an.total) return null;
    const scale = key ? Theory.scalePcs(key) : null;
    let best = null;
    for (let r = 0; r < 12; r++) {
      for (const q of QUALS) {
        const ch = { root: r, ...q };
        const tones = Theory.chordIntervals(ch).map((i) => (r + i) % 12);
        let s = 0;
        for (let pc = 0; pc < 12; pc++) s += tones.includes(pc) ? an.w[pc] : -0.6 * an.w[pc];
        s += 0.8 * an.bass[r];
        for (const t of tones) if (!an.w[t]) s -= 0.15 * an.total;
        if (q.seventh) s -= 0.08 * an.total;
        if (q.quality === 'dim') s -= 0.12 * an.total;
        if (scale && tones.every((t) => scale.has(t))) s += 0.08 * an.total;
        if (!best || s > best.score) best = { chord: ch, score: s };
      }
    }
    return best;
  }

  const same = (a, b) => a && b && a.root === b.root && a.quality === b.quality && a.seventh === b.seventh;

  function guessSegs(bars, key) {
    const segs = [];
    bars.forEach((bar, b) => {
      const ev = bar.events;
      const full = bestChord(analyze(ev), key);
      const cut = ev.findIndex((e) => e.f >= 0.5);
      if (full && cut > 0) {
        const a1 = analyze(ev.slice(0, cut)), a2 = analyze(ev.slice(cut));
        const h1 = bestChord(a1, key), h2 = bestChord(a2, key);
        if (h1 && h2 && a1.total >= 2 && a2.total >= 2 && !same(h1.chord, h2.chord) &&
            h1.score + h2.score > full.score + 0.25 * (a1.total + a2.total)) {
          segs.push({ bar: b, from: 0, to: cut, span: 1, chord: h1.chord });
          segs.push({ bar: b, from: cut, to: ev.length, span: 1, chord: h2.chord });
          return;
        }
      }
      segs.push({ bar: b, from: 0, to: ev.length, span: 2, chord: full ? full.chord : null });
    });
    fillGaps(segs, key);
    return segs;
  }

  function segsFromHints(bars, hints) {
    hints.sort((a, b) => a.bar - b.bar || a.f - b.f);
    let hi = 0;
    let active = hints[0].chord;
    const segs = [];
    bars.forEach((bar, b) => {
      const groups = [];
      const advance = (f) => { while (hi < hints.length && (hints[hi].bar < b || (hints[hi].bar === b && hints[hi].f <= f + 0.02))) active = hints[hi++].chord; };
      if (!bar.events.length) { advance(1); groups.push({ from: 0, to: 0, chord: active }); }
      bar.events.forEach((e, k) => {
        advance(e.f);
        const g = groups[groups.length - 1];
        if (g && same(g.chord, active)) g.to = k + 1;
        else groups.push({ from: k, to: k + 1, chord: active });
      });
      advance(1);
      groups.forEach((g) => segs.push({ bar: b, ...g, span: groups.length === 1 ? 2 : 1 }));
    });
    return segs;
  }

  function fillGaps(segs, key) {
    let last = segs.find((s) => s.chord)?.chord || { root: key.tonic, quality: key.mode === 'major' ? 'maj' : 'min', seventh: '' };
    for (const s of segs) { if (s.chord) last = s.chord; else s.chord = { ...last }; }
  }

  function corr(a, b) {
    const ma = a.reduce((x, y) => x + y) / 12, mb = b.reduce((x, y) => x + y) / 12;
    let n = 0, da = 0, db = 0;
    for (let i = 0; i < 12; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
    return da && db ? n / Math.sqrt(da * db) : 0;
  }

  function rankKeys(bars) {
    const { w } = analyze(bars.flatMap((b) => b.events));
    const out = [];
    for (let t = 0; t < 12; t++) {
      for (const mode of ['major', 'minor']) {
        const prof = mode === 'major' ? KK_MAJ : KK_MIN;
        out.push({ key: { tonic: t, mode }, score: corr(w, Array.from({ length: 12 }, (_, i) => prof[mod(i - t)])) });
      }
    }
    return out.sort((a, b) => b.score - a.score);
  }

  function refineKeys(ranked, segs) {
    const fits = (ch, key) => ch.root === key.tonic && ch.quality === (key.mode === 'major' ? 'maj' : 'min');
    return ranked.slice(0, 6).map(({ key, score }) => {
      const scale = Theory.scalePcs(key);
      const dia = segs.filter((s) => Theory.chordIntervals(s.chord).every((i) => scale.has((s.chord.root + i) % 12))).length / segs.length;
      const bonus = (fits(segs[0].chord, key) ? 0.15 : 0) + (fits(segs[segs.length - 1].chord, key) ? 0.15 : 0) + 0.3 * dia;
      return { key, score: score + bonus };
    }).sort((a, b) => b.score - a.score);
  }

  // ---------- public ----------
  // "[Chorus]", "[Verse 2]", "Chorus:", "Intro" → section name; anything else → null.
  const SECTION_WORDS = /^((?:pre-?)?chorus|intro|verse|bridge|outro|solo|interlude|riff|refrain|coda|ending|instrumental|hook)(\s*\d+)?\s*:?$/i;
  function sectionLabel(line) {
    const t = line.trim();
    const m = t.match(/^\[([^\]]{1,40})\]$/);
    if (m && !/^(tab|ch|\/tab|\/ch)$/i.test(m[1].trim())) return m[1].trim();
    const w = t.match(SECTION_WORDS);
    if (w) return t.replace(/:$/, '').replace(/^./, (c) => c.toUpperCase());
    return null;
  }

  // "x2" / "2x" after the last bar line, or a "(x2)" / "repeat 2x" line right below.
  function repeatTimes(block, nextLine) {
    const RE = /(?:^|[\s(])(?:x\s*(\d{1,2})|(\d{1,2})\s*x)(?=$|[\s)])/i;
    for (const l of block) {
      if (!l.includes('|')) continue;
      const m = l.slice(l.lastIndexOf('|') + 1).match(RE);
      if (m) return +(m[1] || m[2]);
    }
    if (nextLine && !isTabLine(nextLine)) {
      const m = nextLine.trim().match(/^\(?\s*(?:x\s*(\d{1,2})|(\d{1,2})\s*x|repeat\s*(\d{1,2})\s*(?:x|times)?)\s*\)?$/i);
      if (m) return +(m[1] || m[2] || m[3]);
    }
    return 1;
  }

  function parse(text, title) {
    const lines = text.replace(/\t/g, '    ').split(/\r?\n/);
    let bars = [];
    const hints = [];
    let blocks = [];
    let pending = null; // section label waiting for its first block
    for (let i = 0; i < lines.length;) {
      if (!isTabLine(lines[i])) {
        const lb = sectionLabel(lines[i]);
        if (lb) pending = lb;
        i++;
        continue;
      }
      let j = i;
      while (j < lines.length && isTabLine(lines[j])) j++;
      for (let k = i; k + 6 <= j; k += 6) {
        const above = lines[k - 1];
        const start = bars.length;
        parseBlock(lines.slice(k, k + 6), above && !isTabLine(above) && isChordLine(above) ? above : null, bars, hints);
        blocks.push({ start, end: bars.length, label: pending, times: repeatTimes(lines.slice(k, k + 6), k + 6 === j ? lines[j] : null) });
        pending = null;
      }
      i = j;
    }
    const firstNote = bars.findIndex((b) => b.events.length);
    if (firstNote < 0) throw new Error('No guitar tab found. Paste 6-line ASCII tab, like:  e|---0---|');
    const lastNote = bars.length - 1 - [...bars].reverse().findIndex((b) => b.events.length);
    hints.forEach((h) => { h.bar -= firstNote; });
    bars = bars.slice(firstNote, lastNote + 1);
    blocks = blocks
      .map((b) => ({ ...b, start: Math.max(0, b.start - firstNote), end: Math.min(bars.length, b.end - firstNote) }))
      .filter((b) => b.end > b.start);
    const validHints = hints.filter((h) => h.bar >= 0 && h.bar < bars.length);

    const ranked = rankKeys(bars);
    let segs = validHints.length ? segsFromHints(bars, validHints) : guessSegs(bars, ranked[0].key);
    const keys = refineKeys(ranked, segs);
    const key = keys[0].key;
    if (!validHints.length) segs = guessSegs(bars, key);
    segs.forEach((s) => { s.guess = { ...s.chord }; });

    return {
      id: 'tab-' + Date.now().toString(36),
      title, imported: true, created: new Date().toISOString(),
      key, keyAlternatives: keys.slice(0, 4).map((k) => k.key),
      chordSource: validHints.length ? 'names' : 'guessed',
      bars, segs, blocks, raw: text,
    };
  }

  // Parts to display: blocks grouped into sections. A section label starts a new part,
  // unlabeled blocks continue the current one. A block identical to the part before it
  // becomes "×2"; a part identical to an earlier one becomes a "same as above" line.
  function buildParts(song) {
    const n = song.bars.length;
    const blocks = song.blocks && song.blocks.length ? song.blocks : [{ start: 0, end: n, label: null, times: 1 }];
    const sig = (a, b) => JSON.stringify(song.bars.slice(a, b).map((bar) => bar.events.map((e) => e.notes)));
    const parts = [];
    for (const bl of blocks) {
      const prev = parts[parts.length - 1];
      if (prev && !bl.label && sig(prev.start, prev.end) === sig(bl.start, bl.end)) { prev.times += bl.times; continue; }
      if (prev && !bl.label && prev.times === 1 && bl.times === 1 && prev.end === bl.start) { prev.end = bl.end; continue; }
      parts.push({ name: bl.label, start: bl.start, end: bl.end, times: bl.times, repeatOf: null });
    }
    parts.forEach((p, i) => {
      const s = sig(p.start, p.end);
      const j = parts.findIndex((q, k) => k < i && q.repeatOf == null && sig(q.start, q.end) === s);
      if (j >= 0) p.repeatOf = j;
    });
    return parts;
  }

  const EXAMPLE = [
    'Example: A minor arpeggios (no chord names, so the chords get guessed)',
    '',
    'e|------0-----|------0-----|------2-----|------1-3---|',
    'B|----1---1---|----1---1---|----3---3---|----1---1---|',
    'G|--2-------2-|--0-------0-|--2-------2-|--2-------2-|',
    'D|------------|------------|0-----------|3-----------|',
    'A|0-----------|3-----------|------------|------------|',
    'E|------------|------------|------------|------------|',
    '',
    'e|------0-----|------0-----|------0-----|------0-----|',
    'B|----1---1---|----1---1---|----0---0---|----0---0---|',
    'G|--2-------2-|--0-------0-|--1-------1-|--1-------1-|',
    'D|------------|------------|------------|------------|',
    'A|0-----------|3-----------|------------|------------|',
    'E|------------|------------|0-----------|0-----------|',
  ].join('\n');

  return { parse, buildParts, EXAMPLE };
})();

// Imported tabs live in this browser's storage; Export/Restore makes a file backup.
const Library = (() => {
  const K = 'fretwise:library';
  function list() {
    try { const v = JSON.parse(localStorage.getItem(K)); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function write(lib) {
    try { localStorage.setItem(K, JSON.stringify(lib)); return true; } catch (e) {
      alert('Could not save: browser storage is blocked or full. Use “Export all” to keep a copy.');
      return false;
    }
  }
  function save(song) {
    const lib = list();
    const i = lib.findIndex((s) => s.id === song.id);
    if (i >= 0) lib[i] = song; else lib.push(song);
    return write(lib);
  }
  const remove = (id) => write(list().filter((s) => s.id !== id));
  function exportFile() {
    const blob = new Blob([JSON.stringify({ app: 'fretwise', version: 1, tabs: list() }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'fretwise-tabs.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  async function importFile(file) {
    const data = JSON.parse(await file.text());
    const tabs = Array.isArray(data) ? data : data.tabs;
    if (!Array.isArray(tabs)) throw new Error('That file is not a Fretwise backup.');
    const lib = list();
    let n = 0;
    for (const t of tabs) {
      if (!t || !t.imported || !Array.isArray(t.bars) || !Array.isArray(t.segs)) continue;
      const i = lib.findIndex((s) => s.id === t.id);
      if (i >= 0) lib[i] = t; else lib.push(t);
      n++;
    }
    write(lib);
    return n;
  }
  return { list, save, remove, exportFile, importFile };
})();

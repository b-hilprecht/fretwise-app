// Music theory core: keys, numerals, chords, voicings (open + CAGED shapes).
// Strings are indexed 0..5 = low E .. high e.

const Theory = (() => {
  const SHARP = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const FLAT = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
  const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  const DEGREE = ['1', '♭2', '2', '♭3', '3', '4', '♭5', '5', '♭6', '6', '♭7', '7'];
  const INTERVAL = ['R', '♭2', '2', '♭3', '3', '4', '♭5', '5', '♭6', '6', '♭7', '7'];
  const OPEN_MIDI = [40, 45, 50, 55, 59, 64];
  const mod = (n) => ((n % 12) + 12) % 12;

  function usesFlats(key) {
    if (!key) return false;
    return key.mode === 'major'
      ? [5, 10, 3, 8, 1].includes(key.tonic)
      : [2, 7, 0, 5, 10, 3].includes(key.tonic);
  }
  const noteName = (pc, key) => (usesFlats(key) ? FLAT : SHARP)[mod(pc)];
  const keyName = (key) => `${noteName(key.tonic, key)} ${key.mode}`;
  const scalePcs = (key) => new Set(SCALES[key.mode].map((s) => mod(key.tonic + s)));

  // Scale degree 1..7 of a pitch class in a key (0 = outside the key).
  // Colors follow it: same degree = same color, for notes and for chord roots.
  const degreeOf = (pc, key) => SCALES[key.mode].indexOf(mod(pc - key.tonic)) + 1;
  const degreeClass = (pc, key) => {
    const d = key ? degreeOf(pc, key) : 0;
    return d ? `deg-${d}` : 'deg-out';
  };

  // --- Numerals -------------------------------------------------------------
  const RE = /^([♭b♯#]?)(vii|VII|iii|III|vi|VI|iv|IV|ii|II|v|V|i|I)(°|o)?(maj7|7)?$/;

  function parseNumeral(str) {
    const m = str.match(RE);
    if (!m) throw new Error('Bad numeral: ' + str);
    const [, acc, rom, dim, sev] = m;
    const upper = rom === rom.toUpperCase();
    return {
      deg: ROMAN.indexOf(rom.toUpperCase()),
      quality: dim ? 'dim' : upper ? 'maj' : 'min',
      seventh: sev || '',
      shift: acc === '♭' || acc === 'b' ? -1 : acc === '♯' || acc === '#' ? 1 : 0,
    };
  }

  function chordFromNumeral(num, key) {
    const p = parseNumeral(num);
    return {
      root: mod(key.tonic + SCALES[key.mode][p.deg] + p.shift),
      quality: p.quality,
      seventh: p.seventh,
      numeral: num,
    };
  }

  function chordIntervals(ch) {
    const iv = ch.quality === 'maj' ? [0, 4, 7] : ch.quality === 'min' ? [0, 3, 7] : [0, 3, 6];
    if (ch.seventh === '7') iv.push(ch.quality === 'dim' ? 9 : 10);
    if (ch.seventh === 'maj7') iv.push(11);
    return iv;
  }

  function chordName(ch, key) {
    const q = { maj: '', min: 'm', dim: '°' }[ch.quality];
    const s = ch.seventh === '7' ? '7' : ch.seventh === 'maj7' ? 'maj7' : '';
    // Chords outside the key follow their numeral: ♭VII in C is B♭, not A♯.
    let names = usesFlats(key) ? FLAT : SHARP;
    if (key) {
      const acc = numeralFor(ch, key)[0];
      if (acc === '♭') names = FLAT;
      else if (acc === '♯') names = SHARP;
    }
    return names[mod(ch.root)] + q + s;
  }

  const qualityWord = (ch) => ({ maj: 'major', min: 'minor', dim: 'diminished' }[ch.quality]);

  const diatonic = (key) =>
    key.mode === 'major'
      ? ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']
      : ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'];

  // Diatonic chords plus a few common "borrowed" ones for experimenting.
  const borrowed = (key) => (key.mode === 'major' ? ['♭VII', 'iv', 'V7'] : ['V', 'IV', 'V7']);

  // --- Voicings -------------------------------------------------------------
  const vkey = (ch) => `${ch.root}:${ch.quality}${ch.seventh ? ':' + ch.seventh : ''}`;
  const OPEN = {
    '0:maj': [-1, 3, 2, 0, 1, 0], '0:maj:7': [-1, 3, 2, 3, 1, 0], '0:maj:maj7': [-1, 3, 2, 0, 0, 0],
    '2:maj': [-1, -1, 0, 2, 3, 2], '2:min': [-1, -1, 0, 2, 3, 1], '2:maj:7': [-1, -1, 0, 2, 1, 2], '2:min:7': [-1, -1, 0, 2, 1, 1],
    '4:maj': [0, 2, 2, 1, 0, 0], '4:min': [0, 2, 2, 0, 0, 0], '4:maj:7': [0, 2, 0, 1, 0, 0], '4:min:7': [0, 2, 0, 0, 0, 0],
    '5:maj': [-1, -1, 3, 2, 1, 1], '5:maj:maj7': [-1, -1, 3, 2, 1, 0],
    '7:maj': [3, 2, 0, 0, 0, 3], '7:maj:7': [3, 2, 0, 0, 0, 1],
    '9:maj': [-1, 0, 2, 2, 2, 0], '9:min': [-1, 0, 2, 2, 1, 0], '9:maj:7': [-1, 0, 2, 0, 2, 0], '9:min:7': [-1, 0, 2, 0, 1, 0],
    '11:maj:7': [-1, 2, 1, 2, 0, 2],
  };

  // CAGED shapes as fret offsets from the root fret (null = muted string).
  const SHAPES = {
    E: { rootString: 0, maj: [0, 2, 2, 1, 0, 0], min: [0, 2, 2, 0, 0, 0], '7': [0, 2, 0, 1, 0, 0], m7: [0, 2, 0, 0, 0, 0], maj7: [0, 2, 1, 1, 0, 0] },
    A: { rootString: 1, maj: [null, 0, 2, 2, 2, 0], min: [null, 0, 2, 2, 1, 0], '7': [null, 0, 2, 0, 2, 0], m7: [null, 0, 2, 0, 1, 0], maj7: [null, 0, 2, 1, 2, 0], dim: [null, 0, 1, 2, 1, null] },
    D: { rootString: 2, maj: [null, null, 0, 2, 3, 2], min: [null, null, 0, 2, 3, 1], '7': [null, null, 0, 2, 1, 2], m7: [null, null, 0, 2, 1, 1], maj7: [null, null, 0, 2, 2, 2], dim: [null, null, 0, 1, 3, 1] },
  };

  function shapeType(ch) {
    if (ch.quality === 'dim') return 'dim';
    if (ch.seventh === '7') return ch.quality === 'min' ? 'm7' : '7';
    if (ch.seventh === 'maj7') return 'maj7';
    return ch.quality;
  }

  function makeVoicing(frets, ch, label, shape, rootFret) {
    let bass = frets.findIndex((f, s) => f >= 0 && mod(OPEN_MIDI[s] + f) === ch.root);
    if (bass < 0) bass = frets.findIndex((f) => f >= 0);
    let alt = bass === 0 ? 2 : bass + 1;
    while (alt < 6 && frets[alt] < 0) alt++;
    if (alt >= 6) alt = bass;
    return { frets, label, shape, rootFret, bass, alt };
  }

  function candidates(ch) {
    const t = shapeType(ch);
    const out = [];
    for (const [name, sh] of Object.entries(SHAPES)) {
      const offs = sh[t];
      if (!offs) continue;
      const r0 = mod(ch.root - OPEN_MIDI[sh.rootString]);
      for (const r of [r0, r0 + 12]) {
        const frets = offs.map((o) => (o == null ? -1 : o + r));
        if (Math.max(...frets) > 15) continue;
        const label = r === 0 ? `Open ${name}-shape` : `${name}-shape · fret ${r}`;
        out.push(makeVoicing(frets, ch, label, name, r));
      }
    }
    return out;
  }

  // position 0 = prefer open chords; otherwise the CAGED shape closest to that fret.
  function chooseVoicing(ch, position) {
    if (!position) {
      const o = OPEN[vkey(ch)];
      if (o) return makeVoicing(o, ch, 'Open chord', 'open', 0);
      return candidates(ch).sort((a, b) => a.rootFret - b.rootFret)[0];
    }
    return candidates(ch).sort((a, b) => Math.abs(a.rootFret - position) - Math.abs(b.rootFret - position))[0];
  }

  // Absolute chord -> numeral in a key (e.g. E major in A minor -> "V").
  function numeralFor(ch, key) {
    const iv = mod(ch.root - key.tonic);
    const sc = SCALES[key.mode];
    let d = sc.indexOf(iv);
    let acc = '';
    if (d < 0) {
      const order = key.mode === 'minor' && iv !== 1 && iv !== 6 ? ['♯', '♭'] : ['♭', '♯'];
      for (const a of order) {
        d = sc.indexOf(mod(a === '♭' ? iv + 1 : iv - 1));
        if (d >= 0) { acc = a; break; }
      }
    }
    let r = ROMAN[d];
    if (ch.quality !== 'maj') r = r.toLowerCase();
    return acc + r + (ch.quality === 'dim' ? '°' : '') + (ch.seventh || '');
  }

  // "F#m7", "Bb", "Dsus4", "G/B" -> { root, quality, seventh } (extensions simplified).
  const LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function parseChordName(name) {
    const m = name.match(/^([A-G])([#♯b♭]?)([^/]*)/);
    if (!m) return null;
    const root = mod(LETTER[m[1]] + (/[#♯]/.test(m[2]) ? 1 : /[b♭]/.test(m[2]) ? -1 : 0));
    const rest = m[3];
    const quality = /^(dim|°|o)/.test(rest) ? 'dim' : /^(m(?!aj)|min|-)/.test(rest) ? 'min' : 'maj';
    const seventh = /maj7|M7|Δ/.test(rest) ? 'maj7' : /7/.test(rest) ? '7' : '';
    return { root, quality, seventh };
  }

  return {
    SCALES, DEGREE, INTERVAL, OPEN_MIDI, mod,
    noteName, keyName, scalePcs, degreeOf, degreeClass, numeralFor, parseChordName,
    chordFromNumeral, chordIntervals, chordName, qualityWord,
    diatonic, borrowed, chooseVoicing,
  };
})();

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

  // A chord: { root, quality, seventh, add, bass }
  //   quality: maj | min | dim | aug | sus2 | sus4 | hdim (m7♭5) | five (power chord)
  //   seventh: '' | '7' | 'maj7'      add: extra intervals (2 = 9th, 5 = 11th, 9 = 6th)
  //   bass: pitch class of a slash bass (G/B), or null
  const BASE = {
    maj: [0, 4, 7], min: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8],
    sus2: [0, 2, 7], sus4: [0, 5, 7], hdim: [0, 3, 6, 10], five: [0, 7],
  };

  function chordIntervals(ch) {
    const iv = [...(BASE[ch.quality] || BASE.maj)];
    if (ch.seventh === '7') iv.push(ch.quality === 'dim' ? 9 : 10);
    if (ch.seventh === 'maj7') iv.push(11);
    for (const a of ch.add || []) if (!iv.includes(a)) iv.push(a);
    return iv;
  }

  // Text after the root: "m", "7", "maj9", "add9", "7sus4", "m7♭5", "6", "5" …
  // For numerals (withQuality = false) the case of the numeral already says minor.
  function chordSuffix(ch, withQuality) {
    const has = (i) => (ch.add || []).includes(i);
    if (ch.quality === 'hdim') return withQuality ? 'm7♭5' : 'ø7';
    if (ch.quality === 'five') return '5';
    let s = (withQuality ? { min: 'm', dim: '°', aug: '+' } : { dim: '°', aug: '+' })[ch.quality] || '';
    if (ch.seventh) {
      // the highest stacked tone names the chord: 7 → 9 → 11 → 13
      const top = has(9) ? '13' : has(5) ? '11' : has(2) ? '9' : '7';
      const maj = ch.seventh === 'maj7' ? 'maj' : '';
      s += ch.quality === 'min' && maj && withQuality ? `(maj${top})` : maj + top;
    } else if (has(9)) {
      s += has(2) ? '6/9' : '6';
    }
    if (ch.quality === 'sus2' || ch.quality === 'sus4') s += ch.quality;
    // altered tones
    if (has(1)) s += '♭9';
    if (has(3) && !['min', 'dim', 'hdim'].includes(ch.quality)) s += '♯9';
    if (has(6) && !['dim', 'hdim'].includes(ch.quality)) s += '♯11';
    if (has(8) && ch.quality !== 'aug') s += '♭13';
    const adds = [];
    if (has(2) && !ch.seventh && !has(9)) adds.push('add9');
    if (has(5) && !ch.seventh) adds.push('add11');
    if (adds.length) s += withQuality ? adds.join('') : `(${adds.join(',')})`;
    return s;
  }

  const hasBass = (ch) => ch.bass != null && mod(ch.bass) !== mod(ch.root);

  function chordName(ch, key) {
    // Chords outside the key follow their numeral: ♭VII in C is B♭, not A♯.
    let names = usesFlats(key) ? FLAT : SHARP;
    if (key) {
      const acc = numeralFor(ch, key)[0];
      if (acc === '♭') names = FLAT;
      else if (acc === '♯') names = SHARP;
    }
    return names[mod(ch.root)] + chordSuffix(ch, true) + (hasBass(ch) ? '/' + names[mod(ch.bass)] : '');
  }

  const sameChord = (a, b) => !!a && !!b && a.root === b.root && a.quality === b.quality &&
    (a.seventh || '') === (b.seventh || '') &&
    JSON.stringify([...(a.add || [])].sort()) === JSON.stringify([...(b.add || [])].sort()) &&
    (a.bass ?? null) === (b.bass ?? null);

  // Role of an interval inside a chord, for hover text: "root", "3rd", "9th", "4th (sus4)" …
  function roleName(iv, ch) {
    switch (mod(iv)) {
      case 0: return 'root';
      case 1: return '♭9th';
      case 2: return ch.quality === 'sus2' ? '2nd (sus2)' : '9th';
      case 3: return (ch.add || []).includes(3) && !['min', 'dim', 'hdim'].includes(ch.quality) ? '♯9th' : '♭3rd';
      case 4: return '3rd';
      case 5: return ch.quality === 'sus4' ? '4th (sus4)' : '11th';
      case 6: return (ch.add || []).includes(6) && !['dim', 'hdim'].includes(ch.quality) ? '♯11th' : '♭5th';
      case 7: return '5th';
      case 8: return ch.quality === 'aug' ? '♯5th' : '♭6th';
      case 9: return ch.quality === 'dim' && ch.seventh ? '°7th' : '6th';
      case 10: return '♭7th';
      default: return '7th';
    }
  }

  const qualityWord = (ch) => ({
    maj: 'major', min: 'minor', dim: 'diminished', aug: 'augmented', sus2: 'suspended 2nd',
    sus4: 'suspended 4th', hdim: 'half-diminished', five: 'power chord',
  }[ch.quality] || 'major');

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

  // Shapes exist for plain chords; sus/add/aug/power chords fall back to the nearest one.
  function shapeType(ch) {
    if (ch.quality === 'dim' || ch.quality === 'hdim') return 'dim';
    const q = ch.quality === 'min' ? 'min' : 'maj';
    if (ch.seventh === '7') return q === 'min' ? 'm7' : '7';
    if (ch.seventh === 'maj7') return 'maj7';
    return q;
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
      // passing diminished chords lean up (C♯° in C = ♯i°); minor keys raise 3/6/7
      const dimLike = ch.quality === 'dim' || ch.quality === 'hdim';
      const order = dimLike || (key.mode === 'minor' && iv !== 1 && iv !== 6) ? ['♯', '♭'] : ['♭', '♯'];
      for (const a of order) {
        d = sc.indexOf(mod(a === '♭' ? iv + 1 : iv - 1));
        if (d >= 0) { acc = a; break; }
      }
    }
    let r = ROMAN[d];
    if (['min', 'dim', 'hdim'].includes(ch.quality)) r = r.toLowerCase();
    // slash bass as the degree it sits on: G/B in G → I/3
    return acc + r + chordSuffix(ch, false) + (hasBass(ch) ? '/' + DEGREE[mod(ch.bass - key.tonic)] : '');
  }

  // Numeral of the plain triad (I, ♭VII, vi…): for comparing with the key's chords.
  const baseNumeral = (ch, key) => numeralFor({
    root: ch.root, quality: ch.quality === 'min' ? 'min' : ['dim', 'hdim'].includes(ch.quality) ? 'dim' : 'maj',
  }, key);

  // "F#m7", "Bb", "Gadd9", "Em(add9)", "D7sus4", "Cmaj9", "Bm7b5", "C5", "G/B" -> chord.
  const LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const accOf = (a) => (/[#♯]/.test(a) ? 1 : /[b♭]/.test(a) ? -1 : 0);
  function parseChordName(name) {
    const m = name.replace('6/9', '69').match(/^([A-G])([#♯b♭]?)([^/]*)(?:\/([A-G])([#♯b♭]?))?/);
    if (!m) return null;
    const root = mod(LETTER[m[1]] + accOf(m[2]));
    const bass = m[4] ? mod(LETTER[m[4]] + accOf(m[5])) : null;
    let rest = m[3].replace(/[()]/g, '');
    if (/^(m7b5|m7♭5|ø)/.test(rest)) return { root, quality: 'hdim', seventh: '', add: [], bass };
    if (/^5$/.test(rest)) return { root, quality: 'five', seventh: '', add: [], bass };

    // altered tones (♭9 ♯9 ♯11 ♭13 ♭5 ♯5): pull them out before reading 7/9/11/13
    const alt = [];
    rest = rest.replace(/([b#♭♯])(5|9|11|13)/g, (_, a, n) => {
      const flat = /[b♭]/.test(a);
      alt.push({ 5: flat ? 6 : 8, 9: flat ? 1 : 3, 11: flat ? 4 : 6, 13: flat ? 8 : 9 }[n]);
      return '';
    });
    let sixNine = false;
    rest = rest.replace(/69/, () => { sixNine = true; return ''; });

    let quality = 'maj';
    if (/^(dim|°|o)/.test(rest)) quality = 'dim';
    else if (/^(aug|\+)/.test(rest)) quality = 'aug';
    else if (/^(m(?!aj)|min|-)/.test(rest)) quality = 'min';
    if (/sus2/.test(rest)) quality = 'sus2';
    else if (/sus4?/.test(rest)) quality = 'sus4';

    const add = [];
    for (const a of rest.match(/add\d+/g) || []) {
      const n = +a.slice(3);
      if (n === 9 || n === 2) add.push(2);
      else if (n === 11 || n === 4) add.push(5);
      else if (n === 13 || n === 6) add.push(9);
    }
    const core = rest.replace(/sus[24]?/g, '').replace(/add\d+/g, '');
    const seventh = /maj(7|9|11|13)|M(7|9)|Δ/.test(core) ? 'maj7' : /7|9|11|13/.test(core) ? '7' : '';
    if (/9|11|13/.test(core)) add.push(2);  // 9/11/13 chords include the 9th
    if (/11/.test(core)) add.push(5);
    if (/13/.test(core)) add.push(9);       // the 13th is the 6th an octave up
    if (/(^|[^1])6/.test(core)) add.push(9); // C6, Am6 (not the 3 of 13)
    if (sixNine) add.push(9, 2);
    add.push(...alt);
    return { root, quality, seventh, add: [...new Set(add)], bass };
  }

  return {
    SCALES, DEGREE, INTERVAL, OPEN_MIDI, mod,
    noteName, keyName, scalePcs, degreeOf, degreeClass, numeralFor, baseNumeral, parseChordName,
    chordFromNumeral, chordIntervals, chordName, sameChord, roleName, qualityWord,
    diatonic, borrowed, chooseVoicing,
  };
})();

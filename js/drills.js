// Quick drills, all built from the song you're learning (its key and chords).

const Drills = (() => {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const ear = { answer: null, options: [], score: 0, total: 0, locked: false };
  const numq = { key: null, answer: null, score: 0, total: 0, locked: false };
  const find = { pc: null, targets: [], found: new Set(), marks: {}, start: 0, active: false };

  const tonicNum = (key) => (key.mode === 'major' ? 'I' : 'i');
  const voicing = (num, key) => Theory.chooseVoicing(Theory.chordFromNumeral(num, key), 0);

  // ---- Ear: which numeral? ----
  function earNew() {
    const key = state.key;
    const fromTab = $('#earSongOnly').checked && state.chords.length;
    // plain triad numerals (Gadd9 → I), so every option can be played and named
    let opts = fromTab ? [...new Set(state.chords.map((c) => Theory.baseNumeral(c.chord, key)))] : Theory.diatonic(key);
    if (!opts.includes(tonicNum(key))) opts = [tonicNum(key), ...opts];
    let ans;
    do { ans = pick(opts); } while (opts.length > 1 && ans === ear.answer);
    Object.assign(ear, { answer: ans, options: opts, locked: false });
    $('#earFeedback').textContent = '';
    renderEarOptions();
    earPlay();
  }

  function earPlay() {
    if (!ear.answer) return earNew();
    const ctx = AudioEngine.ensure();
    const t = ctx.currentTime + 0.05;
    AudioEngine.strum(voicing(tonicNum(state.key), state.key).frets, t, 0.05);
    AudioEngine.strum(voicing(ear.answer, state.key).frets, t + 1.4, 0.05);
  }

  function renderEarOptions() {
    const el = $('#earOptions');
    el.innerHTML = '';
    ear.options.forEach((num) => {
      const ch = Theory.chordFromNumeral(num, state.key);
      const b = document.createElement('button');
      b.className = `opt ${Theory.degreeClass(ch.root, state.key)}`;
      b.textContent = num;
      b.onclick = () => {
        if (ear.locked) return;
        ear.locked = true;
        ear.total++;
        const right = num === ear.answer;
        if (right) ear.score++;
        const ansCh = Theory.chordFromNumeral(ear.answer, state.key);
        el.querySelectorAll('.opt').forEach((x) => {
          if (x.textContent === ear.answer) x.classList.add('right');
          else if (x === b) x.classList.add('wrong');
        });
        $('#earFeedback').textContent = right
          ? `Yes! ${ear.answer} = ${Theory.chordName(ansCh, state.key)}.`
          : `It was ${ear.answer} (${Theory.chordName(ansCh, state.key)}). Hit ↻ to hear it again.`;
        $('#earScore').textContent = `${ear.score} / ${ear.total}`;
        if (right) setTimeout(earNew, 1300);
      };
      el.appendChild(b);
    });
  }

  // ---- Numerals: name it ----
  function numNew() {
    const mode = Math.random() < 0.7 ? 'major' : 'minor';
    const key = { tonic: Math.floor(Math.random() * 12), mode };
    const nums = Theory.diatonic(key);
    const ans = pick(nums.slice(1));
    Object.assign(numq, { key, answer: ans, locked: false });
    const ch = Theory.chordFromNumeral(ans, key);
    $('#numQ').innerHTML = `Key of <b>${Theory.keyName(key)}</b>. Which numeral is <b class="big">${Theory.chordName(ch, key)}</b>?`;
    $('#numFeedback').textContent = '';
    const el = $('#numOptions');
    el.innerHTML = '';
    nums.forEach((num) => {
      const b = document.createElement('button');
      b.className = `opt ${Theory.degreeClass(Theory.chordFromNumeral(num, key).root, key)}`;
      b.textContent = num;
      b.onclick = () => {
        if (numq.locked) return;
        numq.locked = true;
        numq.total++;
        const right = num === ans;
        if (right) numq.score++;
        el.querySelectorAll('.opt').forEach((x) => {
          if (x.textContent === ans) x.classList.add('right');
          else if (x === b) x.classList.add('wrong');
        });
        const scale = Theory.SCALES[key.mode].map((s) => Theory.noteName(key.tonic + s, key));
        const deg = nums.indexOf(ans);
        $('#numFeedback').innerHTML =
          `${right ? 'Correct.' : 'Not quite.'} Count up the scale: ` +
          scale.slice(0, deg + 1).map((n, i) => (i === deg ? `<b>${n}</b>` : n)).join(' ') +
          ` → note ${deg + 1} → <b>${ans}</b>`;
        $('#numScore').textContent = `${numq.score} / ${numq.total}`;
        setTimeout(numNew, right ? 1400 : 3200);
      };
      el.appendChild(b);
    });
  }

  // ---- Fretboard: find the note ----
  function findNew() {
    const scale = [...Theory.scalePcs(state.key)];
    let pc;
    do { pc = pick(scale); } while (scale.length > 1 && pc === find.pc);
    const targets = [];
    for (let s = 0; s < 6; s++) for (let f = 0; f <= 12; f++) {
      if (Theory.mod(Theory.OPEN_MIDI[s] + f) === pc) targets.push(`${s}-${f}`);
    }
    Object.assign(find, { pc, targets, found: new Set(), marks: {}, start: performance.now(), active: true });
    renderFind();
  }

  function renderFind() {
    const name = find.pc == null ? '' : Theory.noteName(find.pc, state.key);
    $('#findTarget').textContent = name || '?';
    $('#findStatus').textContent = find.active
      ? `${find.found.size} / ${find.targets.length} found`
      : find.pc == null ? 'Press “New note” to start.' : $('#findStatus').textContent;
    Fretboard.render($('#drillBoard'), {
      idPrefix: 'db', key: state.key, chord: null, voicing: null,
      labelMode: 'none', showScale: false, showChordTones: false,
      marks: find.marks, reveal: true,
      onClick: (s, f) => {
        AudioEngine.pluck(s, Theory.OPEN_MIDI[s] + f);
        if (!find.active) return;
        const id = `${s}-${f}`;
        if (find.targets.includes(id)) {
          find.found.add(id);
          find.marks[id] = 'found';
        } else if (f <= 12) {
          find.marks[id] = 'wrong';
          setTimeout(() => { if (find.marks[id] === 'wrong') { delete find.marks[id]; renderFind(); } }, 600);
        }
        if (find.found.size === find.targets.length) {
          find.active = false;
          const secs = ((performance.now() - find.start) / 1000).toFixed(1);
          renderFind();
          $('#findStatus').textContent = `All ${find.targets.length} ${Theory.noteName(find.pc, state.key)}s in ${secs}s 🎉`;
          return;
        }
        renderFind();
      },
    });
  }

  function enter() {
    $('#drillKey').textContent = state.song
      ? `${Theory.keyName(state.key)} (from “${state.song.title}”)`
      : `${Theory.keyName(state.key)} (import a tab to drill in its key)`;
    $('#earSongOnlyWrap').classList.toggle('hidden', !state.song);
    ear.answer = null;
    $('#earOptions').innerHTML = '';
    $('#earFeedback').textContent = 'Press “New question”, then listen.';
    find.active = false;
    find.pc = null;
    find.marks = {};
    renderFind();
    if (!numq.key) numNew();
  }

  function init() {
    $('#earNew').onclick = earNew;
    $('#earRepeat').onclick = earPlay;
    $('#earSongOnly').onchange = () => { ear.answer = null; earNew(); };
    $('#findNew').onclick = findNew;
    $('#numSkip').onclick = numNew;
  }

  return { init, enter };
})();

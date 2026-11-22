// The "→ Fretwise" bookmark button. It runs ON the tab website (in your browser, as you
// see the page), finds the block of text with the most tab lines, and copies it to the
// clipboard with the page title as a "# Title" first line. Must stay self-contained:
// it is turned into a javascript: URL via toString().

function fretwiseGrab() {
  var isTab = function (l) {
    var t = l.trim();
    return (t.match(/-/g) || []).length >= 4 &&
      /^[eEBGDAbgd]?[#b]?\s*[|:]?[-0-9|:hpbrxX/\\~()^.*sS=<>[\] ]+$/.test(t);
  };
  var best = '', bestN = 0;
  var scan = function (sel) {
    var els = document.querySelectorAll(sel);
    for (var i = 0; i < els.length; i++) {
      var e = els[i];
      // <pre>/<code> keep exact whitespace in textContent; other blocks need innerText for <br>s.
      var t = e.tagName === 'TEXTAREA' ? e.value : /^(PRE|CODE)$/.test(e.tagName) ? e.textContent : e.innerText;
      if (!t || t.length > 300000) continue;
      var lines = t.split('\n'), n = 0;
      for (var j = 0; j < lines.length; j++) if (isTab(lines[j])) n++;
      if (n >= 6 && (n > bestN || (n === bestN && t.length < best.length))) { bestN = n; best = t; }
    }
  };
  scan('pre, code, textarea');
  if (!best) scan('article, section, main, div');
  if (!best) { alert('Fretwise: no guitar tab found on this page.'); return; }

  var title = document.title.split(/ @ | \| | – | - Ultimate| TAB by| Tab by| Chords by/)[0].trim() || 'Untitled tab';
  var out = '# ' + title + '\n' + best;
  var done = function () {
    alert('Fretwise: copied ' + bestN + ' tab lines from "' + title + '".\nNow go to Fretwise → + Import tab → Paste.');
  };
  var fallback = function () {
    var ta = document.createElement('textarea');
    ta.value = out;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    done();
  };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(out).then(done, fallback);
  else fallback();
}

const BOOKMARKLET_HREF = 'javascript:' + encodeURIComponent('(' + fretwiseGrab.toString() + ')()');

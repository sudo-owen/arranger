/* Shared fake data + tiny render helpers for the layout mockups.
   Plain script (not a module) so these open straight off the filesystem. */
(function () {
  const ROLE_COLOR = {
    melody: 'var(--melody)', bass: 'var(--bass)', drums: 'var(--drums)',
    winds: 'var(--winds)', brass: 'var(--brass)',
  };

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** A line of notes as [startFrac, widthFrac, row] over `rows` rows. */
  function line(seed, opts) {
    const o = Object.assign({ steps: 32, density: 0.7, rows: 14, low: 2, high: 11, minLen: 1, maxLen: 3 }, opts);
    const r = mulberry32(seed);
    const out = [];
    let s = 0;
    let row = Math.floor((o.low + o.high) / 2);
    while (s < o.steps) {
      const len = o.minLen + Math.floor(r() * (o.maxLen - o.minLen + 1));
      if (r() < o.density) {
        row += Math.floor(r() * 5) - 2;
        row = Math.max(o.low, Math.min(o.high, row));
        out.push([s / o.steps, (len * 0.92) / o.steps, row]);
      }
      s += len;
    }
    return out;
  }

  /** Percussion-ish: dense, two rows. */
  function drumLine(seed, steps) {
    const r = mulberry32(seed);
    const out = [];
    for (let s = 0; s < steps; s++) {
      if (s % 4 === 0) out.push([s / steps, 0.9 / steps, 13]);
      if (s % 4 === 2) out.push([s / steps, 0.9 / steps, 12]);
      if (r() < 0.5) out.push([s / steps, 0.9 / steps, 11]);
    }
    return out;
  }

  /**
   * Render lines into a .roll element.
   * lines: [{ role, notes }]   dividers: [fraction, ...]   head: fraction or null
   */
  function paint(el, lines, dividers, head) {
    el.innerHTML = '';
    const rows = 15;
    for (const d of dividers || []) {
      const s = document.createElement('span');
      s.className = 'div';
      s.style.left = (d * 100) + '%';
      el.appendChild(s);
    }
    for (const ln of lines) {
      for (const [x, w, row] of ln.notes) {
        const i = document.createElement('i');
        i.style.left = (x * 100) + '%';
        i.style.width = Math.max(0.6, w * 100) + '%';
        i.style.top = ((row / rows) * 100) + '%';
        i.style.background = ROLE_COLOR[ln.role] || 'var(--melody)';
        el.appendChild(i);
      }
    }
    if (head != null) {
      const h = document.createElement('span');
      h.className = 'head';
      h.style.left = (head * 100) + '%';
      el.appendChild(h);
    }
  }

  /** A melody-only roll, for hook cards. */
  function hookLines(seed) {
    return [{ role: 'melody', notes: line(seed, { steps: 16, density: 0.85, low: 5, high: 11, maxLen: 2 }) }];
  }

  /** A full five-role roll, for bed / arrangement cards. */
  function bandLines(seed, steps) {
    steps = steps || 32;
    return [
      { role: 'melody', notes: line(seed * 3 + 1, { steps, density: 0.8, low: 2, high: 6 }) },
      { role: 'brass', notes: line(seed * 3 + 2, { steps: steps / 2, density: 0.45, low: 6, high: 8, maxLen: 2 }) },
      { role: 'winds', notes: line(seed * 3 + 3, { steps, density: 0.35, low: 8, high: 9 }) },
      { role: 'bass', notes: line(seed * 3 + 4, { steps, density: 0.9, low: 10, high: 10, maxLen: 1 }) },
      { role: 'drums', notes: drumLine(seed * 3 + 5, steps) },
    ];
  }

  const HOOKS = [
    { id: 1, name: 'Gallop', scheme: 'sequence ↑', detail: '4 pitches · 2 bars' },
    { id: 2, name: 'Fanfare', scheme: 'immediate', detail: '3 pitches · 2 bars' },
    { id: 3, name: 'Syncopated 16ths', scheme: 'sequence ↑', detail: '5 pitches · 2 bars' },
    { id: 4, name: 'Driving 8ths', scheme: 'call + answer', detail: '4 pitches · 2 bars' },
    { id: 5, name: 'Riff / ostinato', scheme: 'ostinato', detail: '3 pitches · 1 bar' },
    { id: 6, name: 'Descending run', scheme: 'sequence ↓', detail: '5 pitches · 2 bars' },
  ];

  const BEDS = [
    { id: 1, prog: 'i–♭VI–♭VII–i', desc: 'full band · pulse lead' },
    { id: 2, prog: 'i–iv–V–i', desc: 'brass-forward' },
    { id: 3, prog: 'i–♭VII–♭VI–V', desc: 'Andalusian · thin' },
    { id: 4, prog: 'vi–IV–I–V', desc: 'bright · winds' },
    { id: 5, prog: 'i–♭VI–iv–V', desc: 'stabs · sparse' },
    { id: 6, prog: 'i–v–♭VI–♭VII', desc: 'walking bass' },
  ];

  const FORMS = [
    { id: 1, label: '40 bars · 60s', sections: [['intro', 4], ['A', 8], ["A'", 8], ['B', 8], ['A"', 8], ['tag', 4]] },
    { id: 2, label: '40 bars · 60s', sections: [['A', 8], ["A'", 8], ['B', 8], ['C', 8], ['A"', 8]] },
    { id: 3, label: '40 bars · 60s', sections: [['intro', 8], ['A', 16], ['B', 8], ['A"', 8]] },
  ];

  const LAYERS = [
    { role: 'melody', label: 'melody', locked: true },
    { role: 'brass', label: 'brass', locked: false },
    { role: 'winds', label: 'winds', locked: false },
    { role: 'bass', label: 'bass', locked: false },
    { role: 'drums', label: 'drums', locked: false },
  ];

  const STAGES = [
    { key: 'hook', label: 'Hook', no: '01' },
    { key: 'bed', label: 'Bed', no: '02' },
    { key: 'mood', label: 'Mood', no: '03' },
    { key: 'form', label: 'Form', no: '04' },
    { key: 'vary', label: 'Vary', no: '05' },
  ];

  /** Describes what a mood point does — the copy that would sit under the pad. */
  function moodText(urgency, fortune) {
    const u = urgency > 0.66 ? 'frantic' : urgency > 0.33 ? 'driving' : 'restrained';
    const f = fortune > 0.66 ? 'triumphant' : fortune > 0.33 ? 'neutral' : 'desperate';
    const bits = [];
    bits.push(urgency > 0.66 ? '16th hats, fills every bar' : urgency > 0.33 ? '8th hats, fill every 4' : 'sparse kit');
    bits.push(fortune > 0.66 ? 'major brightening, brass fanfare' : fortune > 0.33 ? 'natural minor' : 'diminished colour, thin brass');
    return { name: u + ' / ' + f, detail: bits.join(' · ') };
  }

  window.MOCK = {
    ROLE_COLOR, mulberry32, line, drumLine, paint, hookLines, bandLines,
    HOOKS, BEDS, FORMS, LAYERS, STAGES, moodText,
  };
})();

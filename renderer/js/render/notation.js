// Grand-staff notation renderer. Pure function: built score -> SVG string + layout map.
// No DOM access, so it can be unit-tested and rasterized in Node.
//
// Supported (Phase 1): treble/bass clefs, key signatures (up to 7 sharps/flats), time signature,
// whole/half/quarter/eighth notes and rests, dotted values, chords, accidentals (with per-measure
// memory), ledger lines, stems, flags, paired eighth beams, finger numbers, lyrics, chord symbols,
// dynamics, double/final/repeat bar lines, automatic line breaking.
// Includes ties, slurs, eighth-note triplets, articulation marks and pedal spans; navigation repeats are handled by playback.

import { GLYPHS } from './glyphs.js';
import { keySignatureInfo, keyAlteration } from '../core/music.js';

const TREBLE_BASE = 4 * 7 + 2; // E4: bottom line of treble staff (diatonic index)
const BASS_BASE = 2 * 7 + 4; // G2: bottom line of bass staff

const KEY_POSITIONS = {
  treble: {
    sharp: ['F5', 'C5', 'G5', 'D5', 'A4', 'E5', 'B4'],
    flat: ['B4', 'E5', 'A4', 'D5', 'G4', 'C5', 'F4'],
  },
  bass: {
    sharp: ['F3', 'C3', 'G3', 'D3', 'A2', 'E3', 'B2'],
    flat: ['B2', 'E3', 'A2', 'D3', 'G2', 'C3', 'F2'],
  },
};

const STEP_INDEX = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const diatonicOf = (name) => Number(name.slice(-1)) * 7 + STEP_INDEX[name[0]];

const n2 = (v) => Math.round(v * 100) / 100;
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const STYLE = `
.ink{fill:var(--ink,#1c1b1f)}
.stroke{stroke:var(--ink,#1c1b1f);fill:none}
.staffline{stroke:var(--staff,#3a3a42);stroke-width:1;fill:none}
.barline{stroke:var(--ink,#1c1b1f);fill:none}
.hole{fill:var(--paper,#fff)}
.txt{font-family:"Segoe UI",system-ui,Arial,sans-serif;fill:var(--ink,#1c1b1f)}
.lyric{font-size:11px;fill:var(--muted,#55555f)}
.finger{font-size:10px;font-weight:600;fill:var(--muted,#55555f)}
.chordsym{font-size:13px;font-weight:700}
.dyn{font-family:Georgia,"Times New Roman",serif;font-style:italic;font-weight:700;font-size:15px}
.timesig{font-family:Georgia,"Times New Roman",serif;font-weight:700;font-size:28px;text-anchor:middle}
.note .nh,.note .acc,.note .dot,.note .flag{fill:var(--ink,#1c1b1f)}
.note .stem,.note .ledger{stroke:var(--ink,#1c1b1f)}
.music-mark{stroke:var(--ink,#1c1b1f);fill:none;stroke-width:1.2}
.music-mark-text{font-family:Georgia,'Times New Roman',serif;fill:var(--ink,#1c1b1f);font-size:12px;font-weight:700}
.note.is-current .nh,.note.is-current .acc,.note.is-current .dot,.note.is-current .flag,.note.is-current .finger{fill:var(--hl-current,#2563eb)}
.note.is-current .stem{stroke:var(--hl-current,#2563eb)}
.note.is-correct .nh,.note.is-correct .acc,.note.is-correct .dot,.note.is-correct .flag,.note.is-correct .finger{fill:var(--hl-correct,#16a34a)}
.note.is-correct .stem{stroke:var(--hl-correct,#16a34a)}
.note.is-wrong .nh,.note.is-wrong .acc,.note.is-wrong .dot,.note.is-wrong .flag,.note.is-wrong .finger{fill:var(--hl-wrong,#dc2626)}
.note.is-wrong .stem{stroke:var(--hl-wrong,#dc2626)}
.note.is-active .nh,.note.is-active .acc,.note.is-active .dot,.note.is-active .flag,.note.is-active .finger{fill:var(--hl-current,#2563eb)}
.note.is-active .stem{stroke:var(--hl-current,#2563eb)}
.note.is-warn .nh,.note.is-warn .acc,.note.is-warn .dot,.note.is-warn .flag,.note.is-warn .finger{fill:var(--hl-warn,#d97706)}
.note.is-warn .stem{stroke:var(--hl-warn,#d97706)}
.cursor{fill:var(--cursor,rgba(37,99,235,.16));stroke:none}
`;

/**
 * @param {object} score  result of buildScore()
 * @param {object} opts   { width=900, lineSpacing=10 }
 * @returns {{svg:string,width:number,height:number,layout:object}}
 */
export function renderScore(score, opts = {}) {
  const s = opts.lineSpacing ?? 10;
  const width = opts.width ?? 900;
  const marginL = 34;
  const marginR = 18;
  const rx = 0.62 * s; // notehead half width
  const ry = 0.48 * s; // notehead half height
  const stemLen = 3.5 * s;
  const key = score.keySignature;
  const keyInfo = keySignatureInfo(key);

  const layout = { events: {}, measures: [], slots: [], systems: [] };

  // ---- 1. Per-measure preparation (slots, accidentals, natural widths) ----------------
  const prepared = score.measures.map((m) => prepareMeasure(m, score, key, s, rx));

  // ---- 2. Header widths -----------------------------------------------------------------
  const clefW = 3.4 * s;
  const keyW = keyInfo.count ? keyInfo.count * 0.95 * s + 0.8 * s : 0;
  const timeW = 2.6 * s;
  const contentRight = width - marginR;

  // ---- 3. Break measures into systems ----------------------------------------------------
  const systems = [];
  let cur = null;
  const startX = (first) => marginL + clefW + keyW + (first ? timeW : 0);
  prepared.forEach((pm) => {
    const first = systems.length === 0;
    const avail = contentRight - startX(first);
    if (!cur) {
      cur = { measures: [], fixed: 0, flex: 0, first };
      systems.push(cur);
    } else {
      const f = cur.fixed + pm.fixed;
      const x = cur.flex + pm.flex;
      if (f + x > avail && cur.measures.length > 0) {
        cur = { measures: [], fixed: 0, flex: 0, first: false };
        systems.push(cur);
      }
    }
    cur.measures.push(pm);
    cur.fixed += pm.fixed;
    cur.flex += pm.flex;
  });

  // ---- 4. Vertical metrics ------------------------------------------------------------------
  const topPad = 5.5 * s;
  const staffGap = 7 * s;
  const bottomPad = 3.4 * s;
  const sysHeight = topPad + 4 * s + staffGap + 4 * s + bottomPad;
  const height = Math.ceil(systems.length * sysHeight + 0.6 * s);

  // ---- 5. Draw ------------------------------------------------------------------------------------
  const parts = [];
  const sysCount = systems.length;

  systems.forEach((sys, si) => {
    const y0 = si * sysHeight + 0.5 * s;
    const trebleTop = y0 + topPad;
    const trebleBottom = trebleTop + 4 * s;
    const bassTop = trebleBottom + staffGap;
    const bassBottom = bassTop + 4 * s;
    const xStart = startX(sys.first);
    const avail = contentRight - xStart;
    let k = sys.flex > 0 ? (avail - sys.fixed) / sys.flex : 1;
    if (si === sysCount - 1) k = Math.min(k, sysCount === 1 ? 2.2 : 1.25);
    k = Math.max(k, 0.6);

    const ctx = {
      s, rx, ry, stemLen, key, keyInfo,
      trebleTop, trebleBottom, bassTop, bassBottom,
    };

    // staff lines
    const sysEndX = xStart + sys.measures.reduce((acc, pm) => acc + pm.fixed + pm.flex * k, 0);
    for (const top of [trebleTop, bassTop]) {
      for (let i = 0; i < 5; i++) {
        const y = n2(top + i * s);
        parts.push(`<line class="staffline" x1="${n2(marginL)}" y1="${y}" x2="${n2(sysEndX)}" y2="${y}"/>`);
      }
    }
    // system left barline + brace
    parts.push(`<line class="barline" stroke-width="1.4" x1="${marginL}" y1="${n2(trebleTop)}" x2="${marginL}" y2="${n2(bassBottom)}"/>`);
    parts.push(brace(marginL - 5, trebleTop, bassBottom));

    // clefs
    parts.push(glyph('trebleClef', marginL + 0.9 * s, trebleTop + 3 * s, 0, 'ink', clefTreble(s)));
    parts.push(glyph('bassClef', marginL + 0.7 * s, bassTop + 1 * s, 0, 'ink', clefBass(s)));

    // key signature
    let kx = marginL + clefW;
    if (keyInfo.count) {
      for (const [clef, top] of [['treble', trebleTop], ['bass', bassTop]]) {
        const base = clef === 'treble' ? TREBLE_BASE : BASS_BASE;
        const bottomY = top + 4 * s;
        keyInfo.letters.forEach((_, i) => {
          const pos = diatonicOf(KEY_POSITIONS[clef][keyInfo.type][i]);
          const y = bottomY - (pos - base) * (s / 2);
          parts.push(accidental(keyInfo.type, kx + i * 0.95 * s + 0.4 * s, y, s));
        });
      }
      kx += keyW;
    }
    // time signature (first system only)
    if (sys.first) {
      const tx = kx + 1.1 * s;
      parts.push(`<text class="timesig txt" x="${n2(tx)}" y="${n2(trebleTop + 1.0 * s)}" dominant-baseline="central">${score.timeSignature.num}</text>`);
      parts.push(`<text class="timesig txt" x="${n2(tx)}" y="${n2(trebleTop + 3.0 * s)}" dominant-baseline="central">${score.timeSignature.den}</text>`);
      parts.push(`<text class="timesig txt" x="${n2(tx)}" y="${n2(bassTop + 1.0 * s)}" dominant-baseline="central">${score.timeSignature.num}</text>`);
      parts.push(`<text class="timesig txt" x="${n2(tx)}" y="${n2(bassTop + 3.0 * s)}" dominant-baseline="central">${score.timeSignature.den}</text>`);
    }

    // measures
    let mx = xStart;
    sys.measures.forEach((pm, mi) => {
      const mWidth = pm.fixed + pm.flex * k;
      const isLastOfPiece = pm.measure.index === score.measures.length - 1;
      const slotStartX = mx + pm.padL;
      let acc = 0;
      const slotX = new Map();
      pm.slots.forEach((slot) => {
        slotX.set(slot.beat, slotStartX + acc);
        acc += slot.width * k;
      });

      // events
      const mctx = { ...ctx, mx, mWidth, slotX, pm, k };
      for (const staff of ['rh', 'lh']) {
        parts.push(drawStaffMeasure(pm.measure.staves[staff], staff, mctx, layout, si));
      }

      // Repeat endings and navigation labels.
      const ending = (score.endings || []).find((e) => e.startMeasure === pm.measure.index);
      if (ending) {
        const ey = trebleTop - 2.2 * s;
        parts.push(`<path class="music-mark" d="M ${n2(mx+2)} ${n2(ey+0.7*s)} L ${n2(mx+2)} ${n2(ey)} L ${n2(mx+mWidth-2)} ${n2(ey)}"/>`);
        parts.push(`<text class="music-mark-text" x="${n2(mx+4)}" y="${n2(ey-2)}">${ending.pass}.</text>`);
      }
      if (score.navigation?.dcAlFine && pm.measure.index === score.measures.length - 1) {
        parts.push(`<text class="music-mark-text" x="${n2(mx+mWidth-3*s)}" y="${n2(trebleTop-2.4*s)}">D.C. al Fine</text>`);
      }
      if (score.navigation?.dcAlFine && pm.measure.index === score.navigation.fineMeasure) {
        parts.push(`<text class="music-mark-text" x="${n2(mx+mWidth-2*s)}" y="${n2(trebleTop-1.0*s)}">Fine</text>`);
      }

      // chord symbol / dynamic
      const firstSlotX = slotX.get(pm.slots[0].beat);
      if (pm.measure.chordSymbol) {
        parts.push(`<text class="chordsym txt" x="${n2(firstSlotX)}" y="${n2(trebleTop - 3.3 * s)}">${esc(pm.measure.chordSymbol)}</text>`);
      }
      if (pm.measure.dynamic) {
        parts.push(`<text class="dyn txt" x="${n2(firstSlotX)}" y="${n2(trebleBottom + 5.6 * s)}">${esc(pm.measure.dynamic)}</text>`);
      }

      // Opening repeat barline for the playback repeat range.
      if (score.repeat && pm.measure.index === score.repeat.startMeasure) {
        parts.push(barLine(mx + 3, trebleTop, bassTop, bassBottom, 'repeat-start', s));
      }

      // bar line at end of measure
      const bx = mx + mWidth;
      const barKind = score.repeat && pm.measure.index === score.repeat.endMeasure ? 'repeat' : isLastOfPiece ? score.ending : 'single';
      parts.push(barLine(bx, trebleTop, bassTop, bassBottom, barKind, s));

      layout.measures.push({
        index: pm.measure.index, system: si, x: n2(mx), width: n2(mWidth),
        yTop: n2(trebleTop), yBottom: n2(bassBottom),
      });
      pm.slots.forEach((slot) => {
        layout.slots.push({
          startBeat: pm.measure.index * score.timeSignature.beatsPerMeasure + slot.beat,
          x: n2(slotX.get(slot.beat) + slot.cxOffset),
          system: si, yTop: n2(trebleTop - 1.2 * s), yBottom: n2(bassBottom + 1.2 * s),
        });
      });
      mx = bx;
    });

    layout.systems.push({ index: si, yTop: n2(trebleTop), yBottom: n2(bassBottom) });
  });

  layout.slots.sort((a, b) => a.startBeat - b.startBeat);
  parts.push(drawScoreMarks(score, layout, s));

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" class="score" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img">` +
    `<style>${STYLE}</style>` +
    `<g class="score-body">${parts.join('')}</g>` +
    `<g class="overlay"></g></svg>`;

  return { svg, width, height, layout };
}

function drawScoreMarks(score, layout, s) {
  const parts = [];
  const markPair = (pair, kind) => {
    const a = layout.events[pair.from], b = layout.events[pair.to];
    if (!a || !b) return;
    const above = kind === 'slur';
    if (a.system === b.system) {
      const x1 = a.cx + 3, x2 = b.cx - 3;
      const y = above ? Math.min(a.yTop, b.yTop) - 0.8*s : Math.max(a.yBottom, b.yBottom) + 0.55*s;
      const depth = Math.max(0.8*s, Math.abs(x2-x1)*0.09);
      const cy = above ? y-depth : y+depth;
      parts.push(`<path class="music-mark ${kind}" d="M ${n2(x1)} ${n2(y)} Q ${n2((x1+x2)/2)} ${n2(cy)} ${n2(x2)} ${n2(y)}"/>`);
    } else {
      const y1 = above ? a.yTop-0.8*s : a.yBottom+0.5*s;
      const y2 = above ? b.yTop-0.8*s : b.yBottom+0.5*s;
      const d = above ? -0.8*s : 0.8*s;
      parts.push(`<path class="music-mark ${kind}" d="M ${n2(a.cx+2)} ${n2(y1)} Q ${n2(a.cx+10)} ${n2(y1+d)} ${n2(a.cx+18)} ${n2(y1)}"/>`);
      parts.push(`<path class="music-mark ${kind}" d="M ${n2(b.cx-18)} ${n2(y2)} Q ${n2(b.cx-10)} ${n2(y2+d)} ${n2(b.cx-2)} ${n2(y2)}"/>`);
    }
  };
  (score.ties || []).forEach((pair) => markPair(pair, 'tie'));
  (score.slurs || []).forEach((pair) => markPair(pair, 'slur'));
  const findSlot = (beat) => layout.slots.reduce((best, slot) => !best || Math.abs(slot.startBeat-beat) < Math.abs(best.startBeat-beat) ? slot : best, null);
  for (const span of score.pedal || []) {
    const a = findSlot(span.startBeat), b = findSlot(span.endBeat);
    if (!a || !b || a.system !== b.system) continue;
    const y = Math.max(a.yBottom, b.yBottom) + 1.7*s;
    parts.push(`<text class="music-mark-text" x="${n2(a.x)}" y="${n2(y)}">Ped.</text>`);
    parts.push(`<path class="music-mark" d="M ${n2(a.x+18)} ${n2(y-2)} L ${n2(b.x)} ${n2(y-2)} l -3 -3 m 3 3 l -3 3"/>`);
  }
  return parts.join('');
}

// =============================================================================================
// Measure preparation
// =============================================================================================

function prepareMeasure(measure, score, key, s, rx) {
  // Slots: unique onset beats across both staves.
  const beats = new Set();
  for (const staff of ['rh', 'lh']) measure.staves[staff].forEach((e) => beats.add(e.beatInMeasure));
  const sorted = [...beats].sort((a, b) => a - b);
  const bpm = score.timeSignature.beatsPerMeasure;

  // Accidentals with per-staff, per-measure memory.
  const accMap = new Map(); // eventId -> array aligned with event.pitches
  for (const staff of ['rh', 'lh']) {
    const memory = new Map();
    measure.staves[staff].forEach((e) => {
      if (e.rest) return;
      accMap.set(
        e.id,
        e.pitches.map((p) => {
          const id = `${p.step}${p.octave}`;
          const current = memory.has(id) ? memory.get(id) : keyAlteration(key, p.step);
          if (p.alter === current) return null;
          memory.set(id, p.alter);
          return p.alter === 1 ? 'sharp' : p.alter === -1 ? 'flat' : 'natural';
        })
      );
    });
  }

  const slots = sorted.map((beat, i) => {
    const next = i + 1 < sorted.length ? sorted[i + 1] : bpm;
    const gap = next - beat;
    const evs = [];
    for (const staff of ['rh', 'lh']) {
      measure.staves[staff].forEach((e) => {
        if (e.beatInMeasure === beat) evs.push(e);
      });
    }
    const hasAcc = evs.some((e) => (accMap.get(e.id) || []).some(Boolean));
    const hasDot = evs.some((e) => e.dotted);
    const hasChordFinger = evs.some((e) => e.pitches.length > 1 && e.fingers.length);
    const lyricLen = Math.max(0, ...evs.map((e) => (e.lyric ? e.lyric.length : 0)));
    const accW = hasAcc ? 1.15 * s : 0;
    const fingerW = hasChordFinger ? 0.9 * s : 0;
    const lead = accW + fingerW + rx + 0.4 * s; // distance from slot start to notehead centre
    let width = 2.3 * s + 1.6 * s * Math.sqrt(gap) + accW + fingerW + (hasDot ? 0.5 * s : 0);
    if (lyricLen) width = Math.max(width, lyricLen * 0.56 * s + 0.9 * s + 0.2 * s);
    return { beat, gap, width, cxOffset: lead };
  });

  const padL = 1.0 * s;
  const padR = 0.5 * s;
  return {
    measure,
    slots,
    accMap,
    padL,
    padR,
    fixed: padL + padR,
    flex: slots.reduce((a, sl) => a + sl.width, 0),
  };
}

// =============================================================================================
// Staff + event drawing
// =============================================================================================

function staffMetrics(staff, ctx) {
  const treble = staff === 'rh';
  const top = treble ? ctx.trebleTop : ctx.bassTop;
  const base = treble ? TREBLE_BASE : BASS_BASE;
  const bottom = top + 4 * ctx.s;
  const yOf = (diatonic) => bottom - (diatonic - base) * (ctx.s / 2);
  const posOf = (diatonic) => diatonic - base; // 0 = bottom line, 8 = top line
  return { treble, top, bottom, mid: top + 2 * ctx.s, yOf, posOf };
}

function drawStaffMeasure(events, staff, ctx, layout, systemIndex) {
  const { s, slotX, pm } = ctx;
  const sm = staffMetrics(staff, ctx);
  const out = [];

  // Find beam pairs (eighth + eighth starting on a beat).
  const beamOf = new Map(); // eventId -> {partner, role:'first'|'second'}
  for (let i = 0; i < events.length - 1; i++) {
    const a = events[i];
    const b = events[i + 1];
    if (
      a.duration === 'e' && b.duration === 'e' && !a.rest && !b.rest && !a.dotted && !b.dotted &&
      Number.isInteger(a.beatInMeasure) && Math.abs(b.beatInMeasure - a.beatInMeasure - 0.5) < 1e-9 &&
      !beamOf.has(a.id)
    ) {
      beamOf.set(a.id, { partner: b, role: 'first' });
      beamOf.set(b.id, { partner: a, role: 'second' });
    }
  }

  const geometry = new Map(); // eventId -> {cx, heads, stemDir, ...} for beam pass

  events.forEach((ev, idx) => {
    const slotStart = slotX.get(ev.beatInMeasure);
    const slot = pm.slots.find((sl) => sl.beat === ev.beatInMeasure);
    let cx = slotStart + slot.cxOffset;

    if (ev.rest) {
      if (ev.wholeMeasureRest) cx = ctx.mx + ctx.mWidth / 2;
      out.push(drawRest(ev, cx, sm, s));
      layout.events[ev.id] = { cx: n2(cx), yTop: n2(sm.mid - s), yBottom: n2(sm.mid + s), system: systemIndex, staff };
      return;
    }

    const accs = pm.accMap.get(ev.id) || [];
    const g = computeNoteGeometry(ev, cx, sm, ctx, beamOf.get(ev.id));
    geometry.set(ev.id, g);
    out.push({ ev, g, accs, idx });
  });

  // Beam pass: align stem tips for beamed pairs.
  const beamsDrawn = new Set();
  const beamSvg = [];
  for (const [id, info] of beamOf) {
    if (info.role !== 'first' || beamsDrawn.has(id)) continue;
    const a = geometry.get(id);
    const b = geometry.get(info.partner.id);
    if (!a || !b) continue;
    const dir = a.stemDir; // computed jointly
    let beamY;
    if (dir === 'up') {
      beamY = Math.min(a.topY - ctx.stemLen, b.topY - ctx.stemLen, sm.mid);
    } else {
      beamY = Math.max(a.botY + ctx.stemLen, b.botY + ctx.stemLen, sm.mid);
    }
    a.stemTip = beamY;
    b.stemTip = beamY;
    a.beamed = b.beamed = true;
    const x1 = a.stemX - 0.65;
    const x2 = b.stemX + 0.65;
    const th = 0.5 * s;
    const y1 = dir === 'up' ? beamY : beamY - th;
    beamSvg.push(`<rect class="ink beam" x="${n2(x1)}" y="${n2(y1)}" width="${n2(x2 - x1)}" height="${n2(th)}"/>`);
    beamsDrawn.add(id);
  }

  const finalOut = [];
  for (const item of out) {
    if (typeof item === 'string') {
      finalOut.push(item);
    } else {
      finalOut.push(drawNote(item.ev, item.g, item.accs, sm, ctx));
      layout.events[item.ev.id] = {
        cx: n2(item.g.cx), yTop: n2(Math.min(item.g.topY, item.g.stemTip ?? item.g.topY)),
        yBottom: n2(Math.max(item.g.botY, item.g.stemTip ?? item.g.botY)),
        system: systemIndex, staff,
      };
    }
  }
  const tripletSvg = [];
  for (let i = 0; i <= events.length - 3; i++) {
    const tri = events.slice(i, i + 3);
    if (tri.every((ev) => ev.duration === 't' && !ev.rest) && Math.abs(tri[1].beatInMeasure - tri[0].beatInMeasure - 1/3) < 1e-6 && Math.abs(tri[2].beatInMeasure - tri[1].beatInMeasure - 1/3) < 1e-6) {
      const gs = tri.map((ev) => geometry.get(ev.id)).filter(Boolean);
      if (gs.length === 3) {
        const x1 = gs[0].cx - 2, x2 = gs[2].cx + 2;
        const y = Math.min(...gs.map((g) => g.topY)) - 1.8 * s;
        const mid = (x1 + x2) / 2;
        tripletSvg.push(`<path class="music-mark" d="M ${n2(x1)} ${n2(y+3)} L ${n2(x1)} ${n2(y)} L ${n2(mid-5)} ${n2(y)} M ${n2(mid+5)} ${n2(y)} L ${n2(x2)} ${n2(y)} L ${n2(x2)} ${n2(y+3)}"/>`);
        tripletSvg.push(`<text class="music-mark-text" x="${n2(mid)}" y="${n2(y+3)}" text-anchor="middle">3</text>`);
      }
      i += 2;
    }
  }
  return finalOut.join('') + beamSvg.join('') + tripletSvg.join('');
}

function computeNoteGeometry(ev, cx, sm, ctx, beamInfo) {
  const { s, rx, stemLen } = ctx;
  const ds = ev.pitches.map((p) => p.diatonic).sort((a, b) => a - b);

  // Stem direction: farthest note from the middle line decides; ties go down. Beamed pairs decide jointly.
  const allDs = beamInfo ? [...ds, ...beamInfo.partner.pitches.map((p) => p.diatonic)] : ds;
  const midDia = (sm.treble ? TREBLE_BASE : BASS_BASE) + 4;
  const farthestAbove = Math.max(...allDs) - midDia;
  const farthestBelow = midDia - Math.min(...allDs);
  const stemDir = farthestAbove >= farthestBelow ? 'down' : 'up';

  const hasStem = ev.duration !== 'w';
  const heads = ds.map((d) => ({ d, y: sm.yOf(d), displaced: false }));
  if (heads.length > 1) {
    if (stemDir === 'up') {
      for (let i = 1; i < heads.length; i++) {
        if (heads[i].d - heads[i - 1].d === 1 && !heads[i - 1].displaced) heads[i].displaced = true;
      }
    } else {
      for (let i = heads.length - 2; i >= 0; i--) {
        if (heads[i + 1].d - heads[i].d === 1 && !heads[i + 1].displaced) heads[i].displaced = true;
      }
    }
  }
  const shift = ev.duration === 'w' ? 1.68 * s - 0.4 : 2 * rx - 1.3;
  heads.forEach((h) => {
    h.x = cx + (h.displaced ? (stemDir === 'up' ? shift : -shift) : 0);
  });

  const topY = Math.min(...heads.map((h) => h.y));
  const botY = Math.max(...heads.map((h) => h.y));
  const stemX = stemDir === 'up' ? cx + rx - 0.65 : cx - rx + 0.65;
  let stemTip = null;
  if (hasStem) {
    stemTip = stemDir === 'up' ? Math.min(topY - stemLen, sm.mid) : Math.max(botY + stemLen, sm.mid);
  }
  return { cx, heads, topY, botY, stemDir, stemX, stemTip, hasStem, beamed: false };
}

function drawNote(ev, g, accs, sm, ctx) {
  const { s, rx, ry } = ctx;
  const parts = [];
  const hollow = ev.duration === 'w' || ev.duration === 'h';
  const whole = ev.duration === 'w';

  // ledger lines
  const ledgerSet = new Set();
  g.heads.forEach((h) => {
    const p = sm.posOf(h.d);
    if (p <= -2) {
      const lowest = p % 2 === 0 ? p : p + 1;
      for (let q = -2; q >= lowest; q -= 2) ledgerSet.add(q);
    }
    if (p >= 10) {
      const highest = p % 2 === 0 ? p : p - 1;
      for (let q = 10; q <= highest; q += 2) ledgerSet.add(q);
    }
  });
  ledgerSet.forEach((q) => {
    const y = sm.bottom - q * (s / 2);
    const half = whole ? 1.1 * s : 0.95 * s;
    parts.push(`<line class="ledger" stroke-width="1" x1="${n2(g.cx - half)}" y1="${n2(y)}" x2="${n2(g.cx + half)}" y2="${n2(y)}"/>`);
  });

  // noteheads
  g.heads.forEach((h, i) => {
    if (whole) {
      parts.push(`<ellipse class="nh" cx="${n2(h.x)}" cy="${n2(h.y)}" rx="${n2(0.84 * s)}" ry="${n2(ry)}"/>`);
      parts.push(`<ellipse class="hole" cx="${n2(h.x)}" cy="${n2(h.y)}" rx="${n2(0.26 * s)}" ry="${n2(0.5 * s)}" transform="rotate(-62 ${n2(h.x)} ${n2(h.y)})"/>`);
    } else if (hollow) {
      parts.push(`<ellipse class="nh" cx="${n2(h.x)}" cy="${n2(h.y)}" rx="${n2(rx)}" ry="${n2(ry)}" transform="rotate(-22 ${n2(h.x)} ${n2(h.y)})"/>`);
      parts.push(`<ellipse class="hole" cx="${n2(h.x)}" cy="${n2(h.y)}" rx="${n2(0.46 * s)}" ry="${n2(0.2 * s)}" transform="rotate(-38 ${n2(h.x)} ${n2(h.y)})"/>`);
    } else {
      parts.push(`<ellipse class="nh" cx="${n2(h.x)}" cy="${n2(h.y)}" rx="${n2(rx)}" ry="${n2(ry)}" transform="rotate(-22 ${n2(h.x)} ${n2(h.y)})"/>`);
    }
    // accidental (aligned with sorted pitch order; pitches are sorted ascending as are heads)
    const acc = accs[i];
    if (acc) {
      const ax = h.x - (whole ? 0.84 * s : rx) - 0.5 * s;
      parts.push(accidental(acc, ax, h.y, s, 'acc'));
    }
    // dot
    if (ev.dotted) {
      const onLine = sm.posOf(h.d) % 2 === 0;
      const dy = onLine ? h.y - s / 2 : h.y;
      const dx = h.x + (whole ? 0.84 * s : rx) + 0.45 * s;
      parts.push(`<circle class="dot" cx="${n2(dx)}" cy="${n2(dy)}" r="${n2(0.16 * s)}"/>`);
    }
  });

  // stem
  if (g.hasStem) {
    const base = g.stemDir === 'up' ? g.botY : g.topY;
    parts.push(`<line class="stem" stroke-width="1.3" x1="${n2(g.stemX)}" y1="${n2(base)}" x2="${n2(g.stemX)}" y2="${n2(g.stemTip)}"/>`);
  }
  // flag
  if (g.hasStem && ['e', 't'].includes(ev.duration) && !g.beamed) {
    parts.push(flag(g.stemX, g.stemTip, g.stemDir, s));
  }

  // finger numbers
  if (ev.fingers.length) {
    if (ev.pitches.length === 1) {
      const f = ev.fingers[0];
      let y;
      if (sm.treble) {
        const rowY = ctx.trebleTop - 1.15 * s;
        const edge = g.stemDir === 'up' && g.hasStem ? g.stemTip : g.topY - 0.7 * s;
        y = Math.min(rowY, edge - 0.5 * s);
      } else {
        const rowY = ctx.bassBottom + 2.1 * s;
        const edge = g.stemDir === 'down' && g.hasStem ? g.stemTip : g.botY + 0.7 * s;
        y = Math.max(rowY, edge + 1.0 * s);
      }
      parts.push(`<text class="finger txt" text-anchor="middle" x="${n2(g.cx)}" y="${n2(y)}">${f}</text>`);
    } else {
      g.heads.forEach((h, i) => {
        const hasAcc = Boolean(accs[i]);
        const fx = h.x - rx - (hasAcc ? 1.6 * s : 0.5 * s);
        parts.push(`<text class="finger txt" text-anchor="end" x="${n2(fx)}" y="${n2(h.y + 0.35 * s)}">${ev.fingers[i]}</text>`);
      });
    }
  }

  // lyric (between the staves)
  if (ev.lyric) {
    const y = ctx.trebleBottom + 3.4 * s;
    parts.push(`<text class="lyric txt" text-anchor="middle" x="${n2(g.cx)}" y="${n2(y)}">${esc(ev.lyric)}</text>`);
  }

  const arts = ev.articulations || [];
  if (arts.includes('staccato')) {
    parts.push(`<circle class="dot" cx="${n2(g.cx + rx + 0.65*s)}" cy="${n2(g.botY + 0.65*s)}" r="${n2(0.18*s)}"/>`);
  }
  if (arts.includes('accent')) {
    parts.push(`<path class="music-mark" d="M ${n2(g.cx-rx)} ${n2(g.botY+1.0*s)} L ${n2(g.cx+0.6*s)} ${n2(g.botY+1.25*s)} L ${n2(g.cx-rx)} ${n2(g.botY+1.5*s)}"/>`);
  }
  if (arts.includes('fermata')) {
    const fy = g.topY - 1.4*s;
    parts.push(`<path class="music-mark" d="M ${n2(g.cx-0.65*s)} ${n2(fy)} Q ${n2(g.cx)} ${n2(fy-0.75*s)} ${n2(g.cx+0.65*s)} ${n2(fy)}"/>`);
    parts.push(`<circle class="dot" cx="${n2(g.cx)}" cy="${n2(fy-0.25*s)}" r="${n2(0.15*s)}"/>`);
  }
  return `<g class="note" data-id="${ev.id}" data-midi="${ev.pitches.map((p) => p.midi).join(',')}">${parts.join('')}</g>`;
}

function drawRest(ev, cx, sm, s) {
  const id = ev.id;
  const wrap = (inner) => `<g class="note rest" data-id="${id}">${inner}</g>`;
  const dot = ev.dotted ? `<circle class="dot ink" cx="${n2(cx + 1.3 * s)}" cy="${n2(sm.mid - s / 2)}" r="${n2(0.16 * s)}"/>` : '';
  if (ev.duration === 'w' || ev.wholeMeasureRest) {
    const lineY = sm.bottom - 3 * s; // 4th line from the bottom
    return wrap(`<rect class="ink" x="${n2(cx - 0.6 * s)}" y="${n2(lineY)}" width="${n2(1.2 * s)}" height="${n2(0.5 * s)}"/>`);
  }
  if (ev.duration === 'h') {
    return wrap(`<rect class="ink" x="${n2(cx - 0.6 * s)}" y="${n2(sm.mid - 0.5 * s)}" width="${n2(1.2 * s)}" height="${n2(0.5 * s)}"/>${dot}`);
  }
  if (ev.duration === 'q') {
    return wrap(glyph('quarterRest', cx, sm.mid, 0, 'ink', restQuarter(s)) + dot);
  }
  return wrap(glyph('eighthRest', cx, sm.mid - 0.2 * s, 0, 'ink', restEighth(s)) + dot);
}

// =============================================================================================
// Glyph helpers
// =============================================================================================

/** Scale factors + anchors per glyph: { k, ax, ay } where (ax, ay) is the font-unit point placed at (x, y). */
const clefTreble = (s) => ({ k: (7.9 * s) / 1191, ax: 331, ay: 190 });
const clefBass = (s) => ({ k: (3.5 * s) / 591, ax: 200, ay: 700 });
const restQuarter = (s) => ({ k: (3.0 * s) / 596, ax: 159.5, ay: 360 });
const restEighth = (s) => ({ k: (2.0 * s) / 366, ax: 126, ay: 349 });

function glyph(name, x, y, _unused, cls, m) {
  const { k, ax, ay } = m;
  const tx = x - ax * k;
  const ty = y + ay * k;
  return `<path class="${cls}" transform="translate(${n2(tx)},${n2(ty)}) scale(${k.toFixed(5)},${(-k).toFixed(5)})" d="${GLYPHS[name].d}"/>`;
}

function accidental(kind, x, y, s, cls = 'ink') {
  // x is the glyph's centre x, y the note line/space centre.
  const specs = {
    sharp: { name: 'sharp', k: (2.7 * s) / 954, ax: 207, ay: 198 },
    natural: { name: 'natural', k: (2.7 * s) / 965, ax: 190, ay: 192 },
    flat: { name: 'flat', k: (2.3 * s) / 836, ax: 192, ay: 150 },
  };
  const sp = specs[kind];
  return glyph(sp.name, x, y, 0, cls === 'acc' ? 'acc' : 'ink', sp);
}

function flag(x, tipY, dir, s) {
  // Simple eighth flag; mirrored for stems pointing down.
  if (dir === 'up') {
    const d = `M${n2(x)},${n2(tipY)} c0,${n2(0.9 * s)} ${n2(1.9 * s)},${n2(1.4 * s)} ${n2(1.3 * s)},${n2(3.0 * s)} c0.3,${n2(-1.4 * s)} ${n2(-0.6 * s)},${n2(-1.7 * s)} ${n2(-1.3 * s)},${n2(-2.0 * s)} z`;
    return `<path class="flag" d="${d}"/>`;
  }
  const d = `M${n2(x)},${n2(tipY)} c0,${n2(-0.9 * s)} ${n2(1.9 * s)},${n2(-1.4 * s)} ${n2(1.3 * s)},${n2(-3.0 * s)} c0.3,${n2(1.4 * s)} ${n2(-0.6 * s)},${n2(1.7 * s)} ${n2(-1.3 * s)},${n2(2.0 * s)} z`;
  return `<path class="flag" d="${d}"/>`;
}

function brace(x, top, bottom) {
  const mid = (top + bottom) / 2;
  const h = bottom - top;
  const d =
    `M${n2(x + 6)},${n2(top)} C${n2(x - 2)},${n2(top + h * 0.12)} ${n2(x + 4)},${n2(mid - h * 0.12)} ${n2(x - 6)},${n2(mid)} ` +
    `C${n2(x + 4)},${n2(mid + h * 0.12)} ${n2(x - 2)},${n2(bottom - h * 0.12)} ${n2(x + 6)},${n2(bottom)}`;
  return `<path class="stroke" stroke-width="2.4" stroke-linecap="round" d="${d}"/>`;
}

function barLine(x, trebleTop, bassTop, bassBottom, kind, s) {
  const line = (xx, w) => `<line class="barline" stroke-width="${w}" x1="${n2(xx)}" y1="${n2(trebleTop)}" x2="${n2(xx)}" y2="${n2(bassBottom)}"/>`;
  if (kind === 'final') return line(x - 4.5, 1.2) + line(x - 1.5, 3.2);
  if (kind === 'repeat-start') {
    const dots = [];
    for (const top of [trebleTop, bassTop]) {
      for (const sp of [1.5, 2.5]) dots.push(`<circle class="ink" cx="${n2(x + 9)}" cy="${n2(top + sp * s)}" r="${n2(0.2 * s)}"/>`);
    }
    return line(x + 1.5, 1.2) + line(x + 5, 3.2) + dots.join('');
  }
  if (kind === 'repeat') {
    const dots = [];
    for (const top of [trebleTop, bassTop]) {
      for (const sp of [1.5, 2.5]) {
        dots.push(`<circle class="ink" cx="${n2(x - 9)}" cy="${n2(top + sp * s)}" r="${n2(0.2 * s)}"/>`);
      }
    }
    return line(x - 5.5, 1.2) + line(x - 2, 3.2) + dots.join('');
  }
  return line(x, 1.2);
}

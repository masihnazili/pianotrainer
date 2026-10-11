// Render a lesson JSON to an HTML file for visual inspection: node scripts/render-test.mjs in.json out.html [width]
import fs from 'node:fs';
import { buildScore } from '../renderer/js/core/music.js';
import { renderScore } from '../renderer/js/render/notation.js';
const [,, inp, out, w] = process.argv;
const lesson = JSON.parse(fs.readFileSync(inp, 'utf8'));
const scores = lesson.scores || [lesson.score];
const html = scores.map(sc => { const r = renderScore(buildScore(sc), { width: Number(w) || 900 }); return r.svg; }).join('<hr>');
fs.writeFileSync(out, `<!doctype html><body style="margin:0;background:#fff">${html}</body>`);

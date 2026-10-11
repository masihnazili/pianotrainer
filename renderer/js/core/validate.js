// Lesson validation: used by the content loader at runtime and by the test-suite on every content file.
import { buildScore } from './music.js';

/** @returns {string[]} list of human-readable problems (empty = valid) */
export function validateLesson(lesson) {
  const errors = [];
  const need = (cond, msg) => { if (!cond) errors.push(msg); };

  need(lesson && typeof lesson === 'object', 'lesson must be an object');
  if (!lesson || typeof lesson !== 'object') return errors;
  need(typeof lesson.id === 'string' && lesson.id, 'lesson.id is required');
  need(typeof lesson.title === 'string' && lesson.title, 'lesson.title is required');
  need(Array.isArray(lesson.steps) && lesson.steps.length > 0, 'lesson.steps must be a non-empty array');

  const seen = new Set();
  (lesson.steps || []).forEach((step, i) => {
    const where = `${lesson.id}/step[${i}]`;
    need(step && typeof step.id === 'string', `${where}: id is required`);
    if (step?.id) {
      need(!seen.has(step.id), `${where}: duplicate step id "${step.id}"`);
      seen.add(step.id);
    }
    if (step?.type === 'text') {
      need(Array.isArray(step.body) && step.body.length > 0, `${where}: text step needs body[]`);
    } else if (step?.type === 'exercise') {
      need(step.score && typeof step.score === 'object', `${where}: exercise needs score`);
      try {
        buildScore(step.score);
      } catch (e) {
        errors.push(`${where}: ${e.message}`);
      }
      need(Array.isArray(step.hands) && step.hands.length > 0 && step.hands.every((h) => h === 'rh' || h === 'lh'),
        `${where}: hands must be a non-empty subset of ["rh","lh"]`);
      need(Number.isFinite(step.tempo) && step.tempo >= 30 && step.tempo <= 220, `${where}: tempo must be 30..220`);
      if (step.score && typeof step.score === 'object') {
        const builtIds = new Set();
        let builtScore = null;
        try { builtScore = buildScore(step.score); builtScore.timeline.forEach((ev) => builtIds.add(ev.id)); } catch {}
        for (const pair of [...(step.score.ties || []), ...(step.score.slurs || [])]) {
          need(Array.isArray(pair) && pair.length === 2 && builtIds.has(pair[0]) && builtIds.has(pair[1]), `${where}: tie/slur references an unknown event`);
        }
        for (const [id, art] of Object.entries(step.score.articulations || {})) {
          need(builtIds.has(id), `${where}: articulation references unknown event "${id}"`);
          const arts = Array.isArray(art) ? art : [art];
          need(arts.every((x) => ['staccato', 'accent', 'fermata'].includes(x)), `${where}: unsupported articulation on "${id}"`);
        }
        for (const span of step.score.pedal || []) {
          need(Number.isFinite(span.startBeat) && Number.isFinite(span.endBeat) && span.startBeat >= 0 && span.endBeat > span.startBeat && span.endBeat <= (builtScore?.totalBeats ?? Infinity), `${where}: invalid pedal span`);
        }
        if (step.score.navigation?.dcAlFine) {
          need(Number.isInteger(step.score.navigation.fineMeasure) && step.score.navigation.fineMeasure >= 0 && step.score.navigation.fineMeasure < (step.score.staves?.rh?.length || step.score.staves?.lh?.length || 0), `${where}: D.C. al Fine needs a valid fineMeasure`);
        }
      }
    } else {
      errors.push(`${where}: unknown step type "${step?.type}"`);
    }
  });
  return errors;
}

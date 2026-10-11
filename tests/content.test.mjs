import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateLesson } from '../renderer/js/core/validate.js';
import { buildScore } from '../renderer/js/core/music.js';
import { renderScore } from '../renderer/js/render/notation.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'renderer', 'content');
const index = JSON.parse(fs.readFileSync(path.join(root, 'index.json'), 'utf8'));

for (const unit of index.units) {
  for (const rel of unit.lessons) {
    test(`lesson ${rel} is valid and renders`, () => {
      const lesson = JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
      assert.deepEqual(validateLesson(lesson), []);
      for (const step of lesson.steps.filter((s) => s.type === 'exercise')) {
        const r = renderScore(buildScore(step.score), { width: 800 });
        assert.ok(r.svg.startsWith('<svg'));
        assert.ok(!r.svg.includes('NaN'), `NaN in SVG of ${step.id}`);
        assert.ok(!r.svg.includes('undefined'), `undefined in SVG of ${step.id}`);
        // every playable event has a layout position
        const built = buildScore(step.score);
        for (const ev of built.timeline) assert.ok(r.layout.events[ev.id], `no layout for ${ev.id}`);
      }
    });
  }
}

test('validateLesson reports problems', () => {
  const bad = { id: 'x', title: 'x', steps: [
    { type: 'exercise', id: 'a', hands: ['rh'], tempo: 60, score: { timeSignature: '4/4', staves: { rh: ['C4/q'] } } },
    { type: 'text', id: 'a', body: [] },
    { type: 'wat', id: 'c' },
  ] };
  const errs = validateLesson(bad);
  assert.ok(errs.some((e) => /1 beats|beats/.test(e)));
  assert.ok(errs.some((e) => /duplicate/.test(e)));
  assert.ok(errs.some((e) => /unknown step type/.test(e)));
});

test('course lessons define a practical assessment based on a real exercise', () => {
  for (const unit of index.units.filter((u) => u.id !== 'dev')) {
    for (const rel of unit.lessons) {
      const lesson = JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
      assert.ok(lesson.assessment, `${rel} needs an assessment`);
      const source = lesson.steps.find((step) => step.id === lesson.assessment.sourceStepId);
      assert.ok(source && source.type === 'exercise', `${rel} assessment must reference an exercise`);
      assert.ok(lesson.assessment.pass.minAccuracy > 0 && lesson.assessment.pass.minAccuracy <= 1);
    }
  }
});


test('beginner course lessons expose outcomes, a practice routine and a final integrated checkpoint', () => {
  for (const unit of index.units.filter((u) => u.id !== 'dev')) {
    for (const rel of unit.lessons) {
      const lesson = JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
      assert.ok(Array.isArray(lesson.learningOutcomes) && lesson.learningOutcomes.length >= 3, `${rel} needs visible learning outcomes`);
      assert.ok(Array.isArray(lesson.practiceRoutine) && lesson.practiceRoutine.length >= 3, `${rel} needs a practice routine`);
      assert.ok(lesson.steps.some((step) => step.id === 'lesson-goals' && step.type === 'text'), `${rel} needs learner-visible goals`);
      assert.ok(lesson.steps.some((step) => step.id === 'practice-routine' && step.type === 'text'), `${rel} needs a learner-visible practice routine`);
      const exercises = lesson.steps.filter((step) => step.type === 'exercise');
      assert.equal(lesson.assessment.sourceStepId, exercises.at(-1)?.id, `${rel} assessment should target the integrated final checkpoint`);
      assert.equal(lesson.assessment.pass.minAccuracy, 0.85, `${rel} should use the common 85% threshold`);
    }
  }
});

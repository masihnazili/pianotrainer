// Application controller.
//   Phase 1: lessons, notation, playback, on-screen keyboard.
//   Phase 2: MIDI controller input, computer-keyboard fallback, practice modes ("wait" and "with the beat"),
//            evaluation and result summary.
// Later phases: microphone input (Phase 3), course gating (Phase 4), progress analytics (Phase 6), expressive playback (Phase 7).

import { buildScore, parsePitch } from './core/music.js';
import { validateLesson } from './core/validate.js';
import { renderScore } from './render/notation.js';
import { PianoSynth } from './audio/synth.js';
import { ScorePlayer } from './audio/transport.js';
import { PianoKeyboard } from './ui/keyboard.js';
import { InputHub, ComputerKeyboardInput } from './input/hub.js';
import { MidiInput } from './input/midi.js';
import { MicrophoneInput } from './input/microphone.js';
import { Practice } from './ui/practice.js';
import { setNoteState, clearNoteStates, ensureCursor, hideCursor, moveCursor } from './ui/score-view.js';

const $ = (id) => document.getElementById(id);
const faNum = (n) => Number(n).toLocaleString('fa-IR', { useGrouping: false });

const S = {
  steps: [],
  index: -1,
  mode: 'listen', // 'listen' | 'wait' | 'rhythm'
  built: null,
  rendered: null,
  synth: new PianoSynth(),
  hub: new InputHub(),
  midi: null,
  microphone: null,
  player: null,
  practice: null,
  keyboard: null,
  playing: false,
  settings: { metronome: true, countIn: true, hands: 'both', hint: true, localSound: true, latencyMs: 0, soundMode: 'synth' },
  courseLessons: [],
  progress: { completedSteps: new Set(), completedLessons: new Set(), attempts: [] },
};

const MODE_HELP = {
  listen: 'برنامه نت‌ها را برایتان می‌نوازد. هر نت را هم می‌توانید روی صفحه کلیک کنید.',
  wait: 'نت (یا آکورد) روشن‌شده را بنوازید. برنامه منتظر می‌ماند و فقط با نت درست جلو می‌رود. می‌توانید با کنترلر MIDI، کیبورد روی صفحه یا کلیدهای A S D F G H J K بنوازید (Z و X = تغییر اکتاو).',
  rhythm: 'بعد از شمارش اولیه، نت‌ها را همراه ضرب مترونوم بنوازید. اگر دست دیگری در تمرین نیست، برنامه همراهی آن را می‌نوازد.',
};

// ---------------------------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------------------------

async function boot() {
  loadSettings();

  S.keyboard = new PianoKeyboard($('keyboard'), {
    low: 36, high: 84,
    onPress: (m) => S.hub.note('noteOn', m, 'screen'),
    onRelease: (m) => S.hub.note('noteOff', m, 'screen', 0),
  });
  new ComputerKeyboardInput(S.hub);
  S.hub.on(handleInput);

  S.player = new ScorePlayer(S.synth, {
    onNoteOn: highlightOn,
    onNoteOff: highlightOff,
    onBeat,
    onEnd: () => (S.mode === 'rhythm' ? S.practice.playerEnded() : onPlaybackEnd()),
  });

  S.practice = new Practice({
    synth: S.synth,
    player: S.player,
    keyboard: S.keyboard,
    scoreRoot: $('score'),
    getBuilt: () => S.built,
    getStep: () => S.steps[S.index].step,
    getRendered: () => S.rendered,
    getSettings: () => ({ ...S.settings, hint: S.steps[S.index]?.isAssessment ? false : S.settings.hint }),
    onState: () => updatePlayButton(),
    onFinish: showResult,
    onCountIn: (n) => { if (n === null) $('countin').hidden = true; },
  });

  S.midi = new MidiInput({ onEvent: (ev) => S.hub.emit(ev), onChange: updateDevices });
  S.microphone = new MicrophoneInput({ onEvent: (ev) => S.hub.emit(ev), onStatus: updateMicStatus });
  setupMidiUi();
  setupMicrophoneUi();

  bindControls();
  try {
    await loadContent();
  } catch (e) {
    showBanner(`Failed to load content:\n${e.message}`);
    return;
  }
  loadCourseProgress();
  setupProgressDashboard();
  buildSidebar();
  if (S.steps.length) selectStep(0);

  let t;
  new ResizeObserver(() => {
    clearTimeout(t);
    t = setTimeout(() => { if (S.built && !S.playing && !S.practice.active) drawScore(); }, 150);
  }).observe($('score-wrap'));

  if (new URLSearchParams(location.search).has('debug')) {
    window.__piano = { S, hub: S.hub, midi: S.midi, practice: S.practice };
  }
}

async function loadContent() {
  const index = await (await fetch('content/index.json')).json();
  const problems = [];
  for (const unit of index.units) {
    for (const path of unit.lessons) {
      const res = await fetch(`content/${path}`);
      if (!res.ok) { problems.push(`${path}: HTTP ${res.status}`); continue; }
      const lesson = await res.json();
      const errs = validateLesson(lesson);
      if (errs.length) { problems.push(...errs); continue; }
      const lessonKey = `${unit.id}:${lesson.id}`;
      const isCourse = unit.id !== 'dev';
      const entry = { unit, lesson, lessonKey, isCourse, courseLessonIndex: isCourse ? S.courseLessons.length : -1 };
      if (isCourse) S.courseLessons.push(entry);
      lesson.steps.forEach((step, stepIndex) => S.steps.push({ ...entry, step, stepIndex, isAssessment: false }));
      if (isCourse && lesson.assessment) {
        const source = lesson.steps.find((step) => step.id === lesson.assessment.sourceStepId && step.type === 'exercise');
        if (!source) { problems.push(`${path}: assessment.sourceStepId must reference an exercise`); continue; }
        const a = lesson.assessment;
        S.steps.push({ ...entry, stepIndex: lesson.steps.length, isAssessment: true, step: {
          ...source, id: `${lesson.id}-assessment`, type: 'assessment',
          title: a.title || 'آزمون عملی پایان درس',
          instructions: a.instructions || 'قطعه را بدون کمک اجرا کنید تا درس بعدی باز شود.',
          hands: a.hands || source.hands, tempo: a.tempo || source.tempo,
          pass: a.pass || { minAccuracy: 0.8 },
        }});
      }
    }
  }
  if (problems.length) showBanner(`Content problems:\n${problems.join('\n')}`);
}

function loadCourseProgress() {
  try {
    const raw = JSON.parse(localStorage.getItem('piano-trainer.course-progress') || '{}');
    S.progress.completedSteps = new Set(raw.completedSteps || []);
    S.progress.completedLessons = new Set(raw.completedLessons || []);
    S.progress.attempts = Array.isArray(raw.attempts) ? raw.attempts : [];
  } catch { /* reset malformed progress */ }
}

function saveCourseProgress() {
  try {
    localStorage.setItem('piano-trainer.course-progress', JSON.stringify({
      completedSteps: [...S.progress.completedSteps],
      completedLessons: [...S.progress.completedLessons],
      attempts: S.progress.attempts.slice(-500),
    }));
  } catch { /* progress remains available for this session */ }
}

function stepKey(item) { return `${item.lessonKey}:${item.step.id}`; }

function isLessonUnlocked(item) {
  if (!item.isCourse || item.courseLessonIndex <= 0) return true;
  const previous = S.courseLessons[item.courseLessonIndex - 1];
  return !!previous && S.progress.completedLessons.has(previous.lessonKey);
}

function isStepUnlocked(item) {
  if (!isLessonUnlocked(item)) return false;
  if (S.progress.completedSteps.has(stepKey(item))) return true;
  return S.steps.filter((x) => x.lessonKey === item.lessonKey && x.stepIndex < item.stepIndex)
    .every((x) => S.progress.completedSteps.has(stepKey(x)));
}

function updateNavigation() {
  $('btn-prev').disabled = S.index <= 0;
  const next = S.steps[S.index + 1];
  $('btn-next').disabled = !next || !isStepUnlocked(next);
  $('pager-pos').textContent = `${faNum(S.index + 1)} از ${faNum(S.steps.length)}`;
  document.querySelectorAll('.step-btn').forEach((b) => b.classList.toggle('active', Number(b.dataset.index) === S.index));
}

// ---------------------------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------------------------

function buildSidebar() {
  const nav = $('sidebar');
  nav.innerHTML = '';
  let lastUnit = null;
  let lastLesson = null;
  S.steps.forEach((item, i) => {
    if (item.unit !== lastUnit) {
      lastUnit = item.unit;
      nav.append(h('div', { class: 'unit-title' }, item.unit.title));
    }
    if (item.lesson !== lastLesson) {
      lastLesson = item.lesson;
      nav.append(h('div', { class: 'lesson-title' }, item.lesson.titleFa || item.lesson.title));
    }
    const unlocked = isStepUnlocked(item);
    const done = S.progress.completedSteps.has(stepKey(item));
    const ico = item.isAssessment ? '🏅' : item.step.type === 'text' ? '📖' : '🎹';
    const status = done ? '✓' : unlocked ? '' : '🔒';
    nav.append(h('button', {
      class: `step-btn${unlocked ? '' : ' locked'}${done ? ' done' : ''}`,
      type: 'button', 'data-index': String(i), disabled: !unlocked,
      title: unlocked ? item.step.title : 'برای بازشدن این مرحله، مراحل قبلی را کامل کنید',
      onclick: () => selectStep(i),
    }, h('span', { class: 'ico' }, ico), h('span', { class: 'step-label' }, item.step.title), h('span', { class: 'step-status' }, status)));
  });
}

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  el.append(...kids);
  return el;
}

// ---------------------------------------------------------------------------------------------
// Step display
// ---------------------------------------------------------------------------------------------

function selectStep(i) {
  if (i < 0 || i >= S.steps.length || !isStepUnlocked(S.steps[i])) return;
  stopAll();
  S.index = i;
  const item = S.steps[i];
  const { step } = item;
  document.querySelectorAll('.mode').forEach((b) => { b.hidden = false; });
  if (step.type === 'text' && item.isCourse) {
    S.progress.completedSteps.add(stepKey(item));
    saveCourseProgress();
    buildSidebar();
  }
  updateNavigation();
  $('step-title').textContent = step.title;
  $('step-instructions').textContent = step.instructions || '';
  $('result').hidden = true;
  clearKeyboard();

  if (step.type === 'text') {
    S.built = S.rendered = null;
    $('score-wrap').hidden = true;
    $('controls').hidden = true;
    $('practice-opts').hidden = true;
    $('modes').hidden = true;
    $('mode-help').textContent = '';
    const body = $('text-body');
    body.hidden = false;
    body.replaceChildren(...step.body.map((p) => h('p', {}, p)));
    (step.highlight || []).forEach((name) => S.keyboard.setState(parsePitch(name).midi, 'target', true));
  } else {
    $('text-body').hidden = true;
    $('score-wrap').hidden = false;
    $('modes').hidden = false;
    document.querySelectorAll('.mode').forEach((b) => { b.hidden = item.isAssessment && b.dataset.mode !== 'rhythm'; });
    try {
      S.built = buildScore(step.score);
    } catch (e) {
      showBanner(e.message);
      return;
    }
    $('tempo').value = step.tempo;
    updateTempoOut();
    drawScore();
    setMode(item.isAssessment ? 'rhythm' : 'listen');
  }
  $('banner').hidden = true;
  $('main').scrollTo({ top: 0 });
}

function drawScore() {
  const wrap = $('score-wrap');
  const width = Math.max(560, Math.floor(wrap.clientWidth - 14));
  S.rendered = renderScore(S.built, { width });
  $('score').innerHTML = S.rendered.svg;
  ensureCursor($('score'));
}

// ---------------------------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------------------------

function setMode(mode) {
  if (S.steps[S.index]?.isAssessment && mode !== 'rhythm') return;
  stopAll();
  S.mode = mode;
  document.querySelectorAll('.mode').forEach((b) => {
    const on = b.dataset.mode === mode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });
  $('mode-help').textContent = MODE_HELP[mode];
  $('result').hidden = true;
  clearNoteStates($('score'));
  hideCursor($('score'));
  clearKeyboard();

  const show = (id, on) => { $(id).hidden = !on; };
  $('controls').hidden = false;
  show('ctl-tempo', mode !== 'wait');
  show('ctl-hands', mode === 'listen');
  show('ctl-metro', mode !== 'wait');
  show('ctl-countin', mode !== 'wait');
  $('practice-opts').hidden = false;
  $('opt-hint').closest('label').hidden = mode === 'listen' || S.steps[S.index]?.isAssessment;
  $('opt-hint').checked = S.settings.hint;
  show('ctl-latency', mode === 'rhythm');
  updatePlayButton();
}

function updatePlayButton() {
  const running = S.mode === 'listen' ? S.playing : S.practice.active;
  $('btn-play').textContent = running ? '■ توقف' : S.mode === 'listen' ? '▶ پخش' : '▶ شروع تمرین';
}

function stopAll() {
  if (S.playing) { S.player.stop(); S.playing = false; }
  S.practice?.stop({ silent: true });
  $('countin').hidden = true;
  if (S.built) { clearNoteStates($('score')); hideCursor($('score')); }
  clearKeyboard();
  if (S.practice) updatePlayButton();
}

// ---------------------------------------------------------------------------------------------
// Piano sound settings — the sample engine shares the same noteOn/noteOff API as the synth.
// ---------------------------------------------------------------------------------------------

let vstPluginCache = [];
let vstAdapter = null;
let vstEventsUnsubscribe = null;

function nativeVstApi() {
  return window.pianoNative?.vstHost || null;
}

function setVstStatus(message, isError = false) {
  const node = $('vst-status');
  if (!node) return;
  node.textContent = message;
  node.style.color = isError ? 'var(--danger, #b42318)' : '';
}

function makeVstAdapter(api) {
  const send = (payload) => api.request(payload).catch((error) => {
    setVstStatus(`ارتباط با میزبان قطع شد: ${error.message || error}`, true);
  });
  const delay = (ms) => Math.max(0, Math.min(30000, Number(ms) || 0));
  return {
    noteOn: (midi, velocity, delayMs = 0) => send({ cmd: 'noteOn', midi, velocity, delayMs: delay(delayMs) }),
    noteOff: (midi, delayMs = 0) => send({ cmd: 'noteOff', midi, delayMs: delay(delayMs) }),
    sustain: (down, delayMs = 0) => send({ cmd: 'sustain', down: !!down, delayMs: delay(delayMs) }),
    allNotesOff: () => send({ cmd: 'allNotesOff' }),
    setVolume: (value) => send({ cmd: 'volume', value: Math.max(0, Math.min(1.5, Number(value) || 0)) }),
  };
}

async function scanVstPlugins() {
  const api = nativeVstApi();
  if (!api) {
    setVstStatus('میزبان VST3 فقط داخل نسخهٔ دسکتاپ Electron قابل استفاده است؛ در مرورگر فعال نیست.', true);
    return false;
  }
  $('btn-vst-scan').disabled = true;
  $('btn-vst-load').disabled = true;
  setVstStatus('در حال راه‌اندازی میزبان صوتی و اسکن مسیرهای استاندارد VST3…');
  try {
    await api.start();
    const result = await api.request({ cmd: 'scan' });
    vstPluginCache = result.plugins || [];
    const select = $('vst-plugin-select');
    select.replaceChildren();
    if (!vstPluginCache.length) {
      select.add(new Option('پلاگین VST3 پیدا نشد', ''));
      setVstStatus('پلاگینی پیدا نشد. مطمئن شو یک ساز VST3 نصب است؛ مسیرهای اسکن‌شده در راهنمای native/vst-host آمده‌اند.', true);
      return false;
    }
    select.add(new Option('انتخاب ساز…', ''));
    vstPluginCache.forEach((plugin) => {
      const suffix = plugin.manufacturer ? ` — ${plugin.manufacturer}` : '';
      select.add(new Option(`${plugin.name}${suffix}${plugin.instrument ? '' : ' (ممکن است ساز نباشد)'}`, plugin.file));
    });
    setVstStatus(`${faNum(result.count)} پلاگین VST3 پیدا شد. یک ساز را انتخاب کن و «بارگذاری پلاگین» را بزن.`);
    return true;
  } catch (error) {
    setVstStatus(error.message || String(error), true);
    return false;
  } finally {
    $('btn-vst-scan').disabled = false;
    $('btn-vst-load').disabled = false;
  }
}

async function loadSelectedVstPlugin() {
  const api = nativeVstApi();
  const file = $('vst-plugin-select').value;
  if (!api) { setVstStatus('این قابلیت فقط در برنامهٔ دسکتاپ فعال است.', true); return; }
  if (!file) { setVstStatus('ابتدا یک پلاگین را از فهرست انتخاب کن.', true); return; }
  $('btn-vst-load').disabled = true;
  setVstStatus('در حال بارگذاری پلاگین؛ بار اول ممکن است چند ثانیه طول بکشد…');
  try {
    const result = await api.request({ cmd: 'load', file });
    vstAdapter = makeVstAdapter(api);
    S.synth.setExternalHost(vstAdapter);
    S.synth.allNotesOff();
    S.synth.setSoundMode('vst3');
    S.settings.soundMode = 'vst3';
    $('sound-engine').value = 'vst3';
    $('btn-vst-test').disabled = false;
    saveSettings();
    setVstStatus(`ساز «${result.name}» بارگذاری شد. موتور VST3 فعال است.`);
    updateSoundStatus();
  } catch (error) {
    setVstStatus(error.message || String(error), true);
  } finally {
    $('btn-vst-load').disabled = false;
  }
}

async function testVstSound() {
  if (S.synth.soundMode !== 'vst3' || !vstAdapter) {
    setVstStatus('اول یک ساز را بارگذاری کن.', true);
    return;
  }
  await S.synth.init();
  const notes = [60, 64, 67];
  notes.forEach((midi, i) => setTimeout(() => S.synth.noteOn(midi, 0.75), i * 110));
  setTimeout(() => notes.forEach((midi) => S.synth.noteOff(midi)), 900);
  setVstStatus('سه نت آزمایشی پخش شدند. اگر صدایی نمی‌شنوی، خروجی صوتی و ساز انتخابی را بررسی کن.');
}

function setupSoundSettings() {
  const panel = $('sound-settings');
  const toggle = (open) => {
    panel.hidden = !open;
    $('btn-sound-settings').setAttribute('aria-expanded', String(open));
  };
  $('btn-sound-settings').addEventListener('click', () => toggle(panel.hidden));
  $('btn-close-sound').addEventListener('click', () => toggle(false));
  S.synth.setSoundMode('synth'); // sample buffers and VST instances are session-only
  S.settings.soundMode = 'synth';
  $('sound-engine').value = 'synth';
  $('vst-controls').hidden = true;
  $('sound-engine').addEventListener('change', async () => {
    const requested = $('sound-engine').value;
    if (requested === 'vst3') {
      $('vst-controls').hidden = false;
      if (vstAdapter) {
        S.synth.setSoundMode('vst3');
        S.settings.soundMode = 'vst3';
        saveSettings();
        updateSoundStatus();
      } else {
        const scanned = await scanVstPlugins();
        if (!scanned) $('sound-engine').value = S.synth.soundMode;
      }
      return;
    }
    if (S.synth.soundMode === 'vst3') S.synth.allNotesOff();
    const active = S.synth.setSoundMode(requested);
    S.settings.soundMode = active;
    $('sound-engine').value = active;
    $('vst-controls').hidden = true;
    saveSettings();
    updateSoundStatus();
  });
  $('btn-vst-scan').addEventListener('click', scanVstPlugins);
  $('btn-vst-load').addEventListener('click', loadSelectedVstPlugin);
  $('btn-vst-test').addEventListener('click', testVstSound);
  if (nativeVstApi()) {
    vstEventsUnsubscribe = nativeVstApi().onEvent((message) => {
      if (message.event === 'hostExit') {
        vstAdapter = null;
        S.synth.setExternalHost(null);
        if (S.synth.soundMode === 'vst3') S.synth.setSoundMode('synth');
        $('sound-engine').value = S.synth.soundMode;
        $('btn-vst-test').disabled = true;
        setVstStatus('میزبان VST3 بسته شد؛ صدای پیش‌فرض فعال شد.', true);
        updateSoundStatus();
      }
    });
  }
  $('sample-files').addEventListener('change', async () => {
    const files = [...($('sample-files').files || [])];
    if (!files.length) return;
    $('sound-status').textContent = 'در حال بارگذاری و آماده‌سازی نمونه‌های صوتی…';
    try {
      const report = await S.synth.loadSampleFiles(files);
      if (!report.loaded) {
        $('sound-status').textContent = 'فایل قابل استفاده‌ای پیدا نشد. از WAV استفاده کن و نام فایل را مثل 60.wav یا C4.wav بگذار.';
        $('sound-engine').value = 'synth';
        return;
      }
      S.settings.soundMode = 'samples';
      $('sound-engine').value = 'samples';
      $('vst-controls').hidden = true;
      saveSettings();
      $('sound-status').textContent = `${faNum(report.loaded)} نمونه بارگذاری شد؛ ${faNum(report.skipped)} فایل نادیده گرفته شد. موتور سمپل‌شده فعال است. نت‌های بدون نمونه از نزدیک‌ترین نت موجود با تغییر کوک پخش می‌شوند.`;
    } catch (error) {
      S.synth.setSoundMode('synth');
      $('sound-engine').value = 'synth';
      $('sound-status').textContent = `بارگذاری ناموفق بود: ${error.message || error}`;
    }
  });
  $('btn-clear-samples').addEventListener('click', () => {
    S.synth.clearSampleBank();
    S.settings.soundMode = 'synth';
    $('sound-engine').value = 'synth';
    $('sample-files').value = '';
    $('vst-controls').hidden = true;
    saveSettings();
    updateSoundStatus();
  });
  updateSoundStatus();
}

function updateSoundStatus() {
  if (S.synth.soundMode === 'vst3' && vstAdapter) {
    $('sound-status').textContent = 'موتور VST3 فعال است. صدای نت‌ها از ساز Native بارگذاری‌شده می‌آید؛ مترونوم همچنان از موتور داخلی استفاده می‌کند.';
  } else if (S.synth.sampleBank.size) {
    $('sound-status').textContent = `${faNum(S.synth.sampleBank.size)} نت نمونه‌شده آماده است. موتور فعلی: ${S.synth.soundMode === 'samples' ? 'سمپل‌شده' : 'سنتزشده'}.`;
  } else {
    $('sound-status').textContent = 'بانک سمپل بارگذاری نشده؛ صدای سنتزشده فعال است. فایل‌های WAV با نام شمارهٔ MIDI (مثلاً 60.wav) یا نام نت (مثلاً C4.wav) را انتخاب کن.';
  }
}

// ---------------------------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------------------------

function bindControls() {
  $('btn-play').addEventListener('click', onPrimary);
  setupSoundSettings();
  $('btn-prev').addEventListener('click', () => selectStep(S.index - 1));
  $('btn-next').addEventListener('click', () => selectStep(S.index + 1));
  document.querySelectorAll('.mode').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  $('tempo').addEventListener('input', updateTempoOut);
  $('tempo').addEventListener('change', () => { if (S.mode === 'listen' && S.playing) startPlayback(); });

  $('hands').value = S.settings.hands;
  $('metronome').checked = S.settings.metronome;
  $('countin-on').checked = S.settings.countIn;
  $('opt-hint').checked = S.settings.hint;
  $('opt-local').checked = S.settings.localSound;
  $('opt-latency').value = S.settings.latencyMs;
  updateLatencyOut();

  $('hands').addEventListener('change', () => { S.settings.hands = $('hands').value; saveSettings(); });
  $('metronome').addEventListener('change', () => { S.settings.metronome = $('metronome').checked; saveSettings(); if (S.mode === 'listen' && S.playing) startPlayback(); });
  $('countin-on').addEventListener('change', () => { S.settings.countIn = $('countin-on').checked; saveSettings(); });
  $('opt-hint').addEventListener('change', () => { S.settings.hint = $('opt-hint').checked; saveSettings(); });
  $('opt-local').addEventListener('change', () => { S.settings.localSound = $('opt-local').checked; saveSettings(); });
  $('opt-latency').addEventListener('input', () => {
    S.settings.latencyMs = Number($('opt-latency').value);
    updateLatencyOut();
    saveSettings();
  });

  // Click a note in the score to hear it.
  $('score').addEventListener('click', async (e) => {
    const g = e.target.closest?.('.note');
    if (!g || g.classList.contains('rest') || !g.dataset.midi || S.practice.active) return;
    await S.synth.init();
    const midis = g.dataset.midi.split(',').map(Number);
    midis.forEach((m) => { S.synth.noteOn(m, 0.8); S.keyboard.setState(m, 'pressed', true); });
    setTimeout(() => midis.forEach((m) => { S.synth.noteOff(m); S.keyboard.setState(m, 'pressed', false); }), 450);
  });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !['INPUT', 'SELECT', 'BUTTON'].includes(document.activeElement?.tagName)) {
      e.preventDefault();
      if (!$('controls').hidden) onPrimary();
    }
  });
}

function updateTempoOut() {
  $('tempo-out').textContent = `${faNum($('tempo').value)} ضرب/دقیقه`;
}

function updateLatencyOut() {
  const v = Number($('opt-latency').value);
  $('latency-out').textContent = `${faNum(v)} میلی‌ثانیه`;
}

function onPrimary() {
  if (S.mode === 'listen') {
    S.playing ? stopPlayback() : startPlayback();
  } else if (S.practice.active) {
    stopAll();
  } else {
    startPractice();
  }
}

// ---------------------------------------------------------------------------------------------
// Listen mode playback
// ---------------------------------------------------------------------------------------------

async function startPlayback() {
  if (!S.built) return;
  clearNoteStates($('score'));
  clearKeyboard();
  S.playing = true;
  updatePlayButton();
  const hands = S.settings.hands === 'both' ? ['rh', 'lh'] : [S.settings.hands];
  await S.player.start(S.built, {
    tempo: Number($('tempo').value),
    hands,
    metronome: S.settings.metronome,
    countIn: S.settings.countIn,
  });
}

function stopPlayback() {
  S.player.stop();
  onPlaybackEnd();
}

function onPlaybackEnd() {
  S.playing = false;
  $('countin').hidden = true;
  clearNoteStates($('score'));
  hideCursor($('score'));
  clearKeyboard();
  updatePlayButton();
}

function onBeat({ beat, countIn }) {
  const badge = $('countin');
  if (countIn) {
    badge.hidden = false;
    badge.textContent = faNum(Math.abs(beat));
  } else {
    badge.hidden = true;
  }
}

function highlightOn(note) {
  $('countin').hidden = true;
  setNoteState($('score'), note.id, 'current');
  if (S.mode === 'listen') {
    note.midis.forEach((m) => S.keyboard.setState(m, 'target', true));
    moveCursor($('score'), S.rendered, note.startBeat);
  }
}

function highlightOff(note) {
  setNoteState($('score'), note.id, null);
  if (S.mode === 'listen') note.midis.forEach((m) => S.keyboard.setState(m, 'target', false));
}

function clearKeyboard() {
  ['target', 'pressed', 'correct', 'wrong'].forEach((s) => S.keyboard?.clearState(s));
}

// ---------------------------------------------------------------------------------------------
// Practice
// ---------------------------------------------------------------------------------------------

async function startPractice() {
  if (!S.built) return;
  $('result').hidden = true;
  clearKeyboard();
  await S.synth.init(); // make sure audio is running before the first note
  await S.practice.start(S.mode, {
    tempo: Number($('tempo').value),
    metronome: S.settings.metronome,
    countIn: S.settings.countIn,
  });
}

function showResult(summary, passed) {
  const item = S.steps[S.index];
  if (item?.isCourse) {
    S.progress.attempts.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(), lessonKey: item.lessonKey,
      lessonTitle: item.lesson.titleFa || item.lesson.title, stepId: item.step.id,
      stepTitle: item.step.title, isAssessment: !!item.isAssessment,
      mode: summary.mode || S.mode, accuracy: Number(summary.accuracy) || 0,
      passed: !!passed, total: Number(summary.total) || 0,
      errors: Number(summary.errors) || Number(summary.extras) || 0,
      missed: Number(summary.missed) || 0,
      meanAbsOffsetMs: Number(summary.meanAbsOffsetMs ?? summary.meanOffsetMs) || 0,
      tendency: summary.tendency || 'unknown',
    });
    S.progress.attempts = S.progress.attempts.slice(-500);
    saveCourseProgress();
    renderProgressDashboard();
  }
  if (passed && item?.isCourse) {
    S.progress.completedSteps.add(stepKey(item));
    if (item.isAssessment) S.progress.completedLessons.add(item.lessonKey);
    saveCourseProgress();
    buildSidebar();
    updateNavigation();
  }
  const el = $('result');
  const pct = `٪${faNum(Math.round(summary.accuracy * 100))}`;
  const lines = [];
  if (summary.mode === 'wait') {
    lines.push(`نت‌های بدون اشتباه از اولین تلاش: ${faNum(summary.firstTry)} از ${faNum(summary.total)}`);
    lines.push(`تعداد اشتباه‌ها: ${faNum(summary.errors)}`);
  } else {
    lines.push(`نت‌های به‌موقع: ${faNum(summary.hits)} از ${faNum(summary.total)}`);
    lines.push(`دقیق: ${faNum(summary.perfect)} · خوب: ${faNum(summary.good)} · قابل‌قبول: ${faNum(summary.ok)} · از دست رفته: ${faNum(summary.missed)}`);
    if (summary.extras) lines.push(`نت‌های اضافه یا نابه‌جا: ${faNum(summary.extras)}`);
    if (summary.hits) {
      const t = { late: 'گرایش دارید کمی دیر بزنید.', early: 'گرایش دارید کمی زود بزنید.', steady: 'ضرب‌تان ثابت بود.' }[summary.tendency];
      lines.push(`میانگین خطای زمانی: ${faNum(summary.meanAbsOffsetMs)} میلی‌ثانیه. ${t}`);
      if (summary.tendency !== 'steady') {
        lines.push('اگر مطمئنید درست می‌زنید و صدا دیر می‌رسد، «جبران تأخیر» را تنظیم کنید.');
      }
    }
  }
  el.className = `result ${passed ? 'pass' : 'retry'}`;
  el.replaceChildren(
    h('div', { class: 'verdict' }, `${passed ? '✅ آفرین! این تمرین را گذراندید.' : '🔁 هنوز کمی مانده؛ یک بار دیگر تلاش کنید.'} — دقت ${pct}`),
    h('div', { class: 'stats' }, ...lines.flatMap((l, i) => (i ? [document.createElement('br'), l] : [l]))),
    h('button', { class: 'btn', type: 'button', onclick: () => startPractice() }, 'تلاش دوباره')
  );
  el.hidden = false;
  el.scrollIntoView?.({ block: 'nearest' });
}

// ---------------------------------------------------------------------------------------------
// Phase 6: progress analytics and adaptive review
function setupProgressDashboard() {
  $('btn-progress')?.addEventListener('click', () => {
    $('progress-dashboard').hidden = !$('progress-dashboard').hidden;
    if (!$('progress-dashboard').hidden) renderProgressDashboard();
  });
  $('btn-progress-close')?.addEventListener('click', () => { $('progress-dashboard').hidden = true; });
  renderProgressDashboard();
}
function statCard(label, value) {
  return h('div', { class: 'stat-card' }, h('span', { class: 'muted' }, label), h('strong', {}, value));
}
function renderProgressDashboard() {
  const root = $('progress-dashboard'); if (!root) return;
  root.replaceChildren();
  const attempts = S.progress.attempts || [];
  const total = S.courseLessons.length, completed = S.progress.completedLessons.size;
  const avg = attempts.length ? attempts.reduce((n,a)=>n+a.accuracy,0)/attempts.length : 0;
  const recent = attempts.filter(a => Date.parse(a.at) >= Date.now()-7*86400000);
  const recentAvg = recent.length ? recent.reduce((n,a)=>n+a.accuracy,0)/recent.length : 0;
  const head = h('div',{class:'dashboard-head'},
    h('div',{},h('h2',{},'گزارش پیشرفت و مرور هوشمند'),h('p',{class:'muted'},'گزارش از تلاش‌های ثبت‌شده در این نسخه ساخته می‌شود.')),
    h('button',{class:'btn small',type:'button',onclick:()=>{root.hidden=true}},'بستن'));
  root.append(head);
  const stats=h('div',{class:'progress-stats'});
  stats.append(statCard('درس‌های گذرانده‌شده',`${completed} از ${total}`),statCard('میانگین دقت کل',attempts.length?`${Math.round(avg*100)}٪`:'—'),statCard('تلاش‌های ۷ روز اخیر',String(recent.length)),statCard('میانگین دقت ۷ روز اخیر',recent.length?`${Math.round(recentAvg*100)}٪`:'—'));
  root.append(stats,h('h3',{},'عملکرد به تفکیک درس'));
  const byLesson=new Map(); attempts.forEach(a=>{if(!byLesson.has(a.lessonKey))byLesson.set(a.lessonKey,[]);byLesson.get(a.lessonKey).push(a)});
  const rows=[];
  S.courseLessons.forEach(lesson=>{const arr=byLesson.get(lesson.lessonKey)||[];if(arr.length||S.progress.completedLessons.has(lesson.lessonKey))rows.push({lesson,arr,mean:arr.length?arr.reduce((n,a)=>n+a.accuracy,0)/arr.length:1})});
  if(!rows.length) root.append(h('p',{class:'muted'},'هنوز تلاشی ثبت نشده. یک تمرین را اجرا کن تا گزارش ساخته شود.'));
  else {const table=h('div',{class:'progress-table'});rows.forEach(({lesson,arr,mean})=>{
    const title=lesson.lesson.titleFa||lesson.lesson.title;
    const bar = h('div',{class:'progress-row-bar'}, h('div',{class:'progress-bar'}, h('span',{style:`width:${Math.round(mean*100)}%`})));
    const reviewBtn = h('button',{class:'btn small',type:'button',onclick:()=>jumpToLessonReview(lesson)},mean<.8?'مرور ضعف':'مرور درس');
    table.append(h('div',{class:'progress-row'},
      h('div',{class:'progress-row-title'},title), bar,
      h('strong',{},arr.length?`${Math.round(mean*100)}٪`:'گذرانده‌شده'),
      h('span',{class:'muted'},`${arr.length} تلاش`), reviewBtn));
  });root.append(table)}
  root.append(h('h3',{},'مرور هوشمند پیشنهادی'));
  const weak=[...byLesson.entries()].map(([key,arr])=>({lesson:S.courseLessons.find(l=>l.lessonKey===key),arr,mean:arr.reduce((n,a)=>n+a.accuracy,0)/arr.length,errors:arr.reduce((n,a)=>n+a.errors+a.missed,0)})).filter(x=>x.lesson).sort((a,b)=>a.mean-b.mean).slice(0,3);
  if(!weak.length) root.append(h('p',{class:'muted'},'بعد از چند تلاش، درس‌هایی که بیشترین نیاز به مرور دارند اینجا نمایش داده می‌شوند.'));
  else {
    const list = h('div',{class:'review-list'});
    weak.forEach(({lesson,arr,mean,errors}) => {
      const reason = mean < .8 ? 'میانگین دقت زیر ۸۰٪ است' : errors ? 'اشتباه یا نت ازدست‌رفته ثبت شده' : 'برای تثبیت، مرور فاصله‌دار پیشنهاد می‌شود';
      const detail = `${reason} · دقت ${Math.round(mean*100)}٪ · ${arr.length} تلاش`;
      const body = h('div',{},h('strong',{},lesson.lesson.titleFa||lesson.lesson.title),h('p',{class:'muted'},detail));
      const btn = h('button',{class:'btn primary small',type:'button',onclick:()=>jumpToLessonReview(lesson)},'شروع مرور');
      list.append(h('div',{class:'review-item'},body,btn));
    });
    root.append(list);
  }

  root.append(h('div',{class:'dashboard-actions'},h('button',{class:'btn',type:'button',onclick:exportProgress},'خروجی گزارش (JSON)'),h('button',{class:'btn',type:'button',onclick:resetProgress},'پاک‌کردن گزارش و پیشرفت')));
}
function jumpToLessonReview(lesson) {
  $('progress-dashboard').hidden=true;
  const all=S.steps.map((x,i)=>({x,i})).filter(({x})=>x.lessonKey===lesson.lessonKey&&!x.isAssessment&&x.step.type==='exercise');
  const chosen=all.find(({x})=>!S.progress.completedSteps.has(stepKey(x)))||all[0];
  if(chosen) selectStep(chosen.i); else {const i=S.steps.findIndex(x=>x.lessonKey===lesson.lessonKey&&!x.isAssessment);if(i>=0)selectStep(i)}
}
function exportProgress() {
  const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),completedLessons:[...S.progress.completedLessons],completedSteps:[...S.progress.completedSteps],attempts:S.progress.attempts},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=h('a',{href:url,download:'piano-trainer-progress.json'});document.body.append(a);a.click();a.remove();URL.revokeObjectURL(url);
}
function resetProgress() {
  if(!confirm('همهٔ پیشرفت و تاریخچهٔ تلاش‌ها پاک شود؟ این کار قابل بازگشت نیست.'))return;
  S.progress.completedSteps.clear();S.progress.completedLessons.clear();S.progress.attempts=[];saveCourseProgress();buildSidebar();updateNavigation();renderProgressDashboard();
}

// Input (MIDI + screen + computer keyboard all arrive through the hub)
// ---------------------------------------------------------------------------------------------

function handleInput(ev) {
  if (ev.type === 'noteOn') {
    S.keyboard.setState(ev.midi, 'pressed', true);
    // Microphone input is already acoustic; synthesizing it would create feedback.
    if (ev.source !== 'microphone' && (ev.source !== 'midi' || S.settings.localSound)) soundOn(ev.midi, ev.velocity);
    S.practice.handle(ev);
  } else if (ev.type === 'noteOff') {
    S.keyboard.setState(ev.midi, 'pressed', false);
    if (ev.source !== 'microphone' && (ev.source !== 'midi' || S.settings.localSound)) S.synth.noteOff(ev.midi);
  }
}

function soundOn(midi, velocity) {
  if (S.synth.ctx) {
    if (S.synth.ctx.state === 'suspended') S.synth.ctx.resume();
    S.synth.noteOn(midi, velocity);
  } else {
    S.synth.init().then(() => S.synth.noteOn(midi, velocity));
  }
}

function setupMidiUi() {
  const btn = $('btn-midi');
  if (!MidiInput.supported) {
    $('device-label').textContent = 'MIDI در این محیط پشتیبانی نمی‌شود (می‌توانید با کیبورد صفحه یا کامپیوتر بنوازید)';
    btn.hidden = true;
    return;
  }
  btn.addEventListener('click', () => connectMidi());
  $('midi-select').addEventListener('change', () => S.midi.select($('midi-select').value));
  const isElectron = /Electron\//.test(navigator.userAgent);
  let remembered = false;
  try { remembered = localStorage.getItem('piano-trainer.midi') === '1'; } catch { /* ignore */ }
  if (isElectron || remembered) connectMidi({ quiet: true });
}

async function connectMidi({ quiet = false } = {}) {
  try {
    await S.midi.connect();
    try { localStorage.setItem('piano-trainer.midi', '1'); } catch { /* ignore */ }
    $('btn-midi').hidden = true;
  } catch (e) {
    if (!quiet) $('device-label').textContent = `اتصال MIDI ممکن نشد: ${e.message}`;
  }
}

function setupMicrophoneUi() {
  const btn = $('btn-mic');
  if (!MicrophoneInput.supported) {
    btn.title = 'میکروفون در این محیط پشتیبانی نمی‌شود؛ نسخه دسکتاپ یا localhost را باز کنید.';
    btn.disabled = true;
    btn.textContent = '🎙️ میکروفون در دسترس نیست';
    return;
  }
  btn.addEventListener('click', async () => {
    if (S.microphone.running) {
      S.microphone.stop();
      return;
    }
    btn.disabled = true;
    btn.textContent = 'در حال درخواست دسترسی…';
    try {
      await S.microphone.start();
    } catch (e) {
      updateMicStatus('stopped');
      $('device-label').textContent = `میکروفون فعال نشد: ${e.message}`;
    } finally {
      btn.disabled = false;
    }
  });
}

function updateMicStatus(status) {
  const btn = $('btn-mic');
  if (!btn) return;
  const active = status === 'listening';
  btn.classList.toggle('active', active);
  btn.textContent = active ? '■ قطع میکروفون' : '🎙️ استفاده از میکروفون';
  btn.setAttribute('aria-pressed', String(active));
  if (active) $('device-label').textContent = 'میکروفون فعال است — برای تمرین تک‌نتی بنوازید';
  else if (S.midi?.devices?.length) updateDevices(S.midi.devices);
  else $('device-label').textContent = 'کنترلر MIDI: متصل نیست';
}

function updateDevices(devices) {
  $('device').classList.toggle('connected', devices.length > 0);
  if (!S.microphone?.running) {
    $('device-label').textContent = devices.length
      ? `کنترلر: ${devices[0].name}${devices.length > 1 ? ` (و ${faNum(devices.length - 1)} دستگاه دیگر)` : ''}`
      : 'کنترلر MIDI: دستگاهی پیدا نشد — آن را وصل کنید';
  }
  const sel = $('midi-select');
  sel.hidden = devices.length < 2;
  sel.replaceChildren(
    h('option', { value: 'all' }, 'همه‌ی دستگاه‌ها'),
    ...devices.map((d) => h('option', { value: d.id }, d.name))
  );
  sel.value = S.midi.selected;
}

// ---------------------------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------------------------

function showBanner(msg) {
  const b = $('banner');
  b.textContent = msg;
  b.hidden = false;
}

function loadSettings() {
  try {
    const raw = localStorage.getItem('piano-trainer.settings');
    if (raw) Object.assign(S.settings, JSON.parse(raw));
  } catch { /* storage unavailable: use defaults */ }
}

function saveSettings() {
  try { localStorage.setItem('piano-trainer.settings', JSON.stringify(S.settings)); } catch { /* ignore */ }
}

boot();

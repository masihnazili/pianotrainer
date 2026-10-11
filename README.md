# Piano Trainer — فاز ۹: زیرساخت صدای سمپل‌شده

اپلیکیشن آموزش پیانو (ویندوز). این بسته شامل **فاز ۰** (معماری، فرمت درس)، **فاز ۱** (رندر نت، پخش صدا، کیبورد روی صفحه)، **فاز ۲** (ورودی MIDI و ارزیابی نوازندگی) و **فاز ۳** (ورودی میکروفون برای پیانوی آکوستیک) است.

## اجرا روی ویندوز

1. [Node.js LTS](https://nodejs.org) را نصب کنید (نسخه ۲۰ یا بالاتر).
2. در پوشه‌ی پروژه:

```bat
npm install
npm start
```

بدون Electron، در مرورگر هم می‌توان اجرا کرد: `npm run dev:web` و بعد باز کردن http://localhost:5173
تست‌ها: `npm test` (تست‌های مرورگری اختیاری: `tests/e2e/phase2.mjs`)

## در فاز ۱ چه کار می‌کند

- فهرست درس‌ها در نوار کنار؛ هر درس شامل درسنامه و تمرین.
- نمایش حامل بزرگ (کلید سل و فا، میزان‌نما، کلیدها تا ۷ دیز/بمل، آکورد، ایست‌ها، نقطه‌دار، چنگ با بیم، شماره انگشت، شعر، علامت دینامیک، نام آکورد، خط پایان و تکرار).
- پخش با صدای پیانو، مترونوم، شمارش اولیه، تنظیم تمپو، انتخاب دست راست/چپ/هر دو.
- مکان‌نمای متحرک روی نت و روشن شدن کلیدها هم‌زمان با پخش.
- کیبورد روی صفحه (کلیک = صدا) و کلیک روی هر نت برای شنیدن آن. کلید Space = پخش/توقف.
- صفحه‌ی «ابزار توسعه ← نمایشگاه نت‌نویسی» برای دیدن همه‌ی امکانات رندر.

## در فاز ۲ چه اضافه شد

- **اتصال کنترلر MIDI:** در Electron خودکار وصل می‌شود؛ در مرورگر دکمه‌ی «اتصال کنترلر». اتصال و قطع در حین کار (hot-plug) و انتخاب دستگاه وقتی چند کنترلر وصل است.
- **بدون کنترلر هم می‌شود تمرین کرد:** کیبورد روی صفحه یا کلیدهای کامپیوتر (A S D F G H J K = کلیدهای سفید از دوی میانی (C4) به بالا، W E T Y U = کلیدهای سیاه، Z و X = تغییر اکتاو).
- **سه حالت برای هر تمرین:**
  - 👂 *گوش‌دادن* — برنامه می‌نوازد.
  - 🎯 *منتظر نت* — برنامه تا زدن نت (یا آکورد) درست صبر می‌کند؛ نت غلط شمرده می‌شود و کلید مربوط قرمز چشمک می‌زند.
  - 🥁 *با ضرب* — شمارش اولیه + مترونوم؛ هر نت باید در بازه‌ی زمانی خودش زده شود (دقیق / خوب / قابل‌قبول / از دست رفته / اضافه). دستی که در تمرین نیست را برنامه همراهی می‌کند.
- رنگ نت‌ها در حامل: سبز = درست، نارنجی = درست ولی با اشتباه قبلی یا زمان‌بندی ضعیف یا از دست رفته، آبی = نت فعلی.
- خلاصه‌ی نتیجه با درصد دقت، تعداد اشتباه‌ها، میانگین خطای زمانی و گرایش به زود/دیر زدن. آستانهٔ عمومی قبولی آزمون پایانی درس در نسخهٔ ۰٫۸ برابر ۸۵٪ است؛ در هر درس با `assessment.pass.minAccuracy` قابل تنظیم است.
- **جبران تأخیر:** اگر صدا با تأخیر شنیده می‌شود، لغزنده‌ی «جبران تأخیر» زمان‌بندی را تنظیم می‌کند.
- گزینه‌ی «صدای برنامه برای کنترلر» را خاموش کنید اگر پیانوی دیجیتال خودش صدا می‌دهد (تا صدا دوبار شنیده نشود).

## فاز ۳: تمرین با میکروفون

- دکمه‌ی «استفاده از میکروفون» اجازه‌ی دسترسی به میکروفون را می‌گیرد و نت غالبِ صدای ساز را به رویدادهای نت تبدیل می‌کند.
- برای تمرین‌های تک‌نتیِ پیانوی آکوستیک یا سازهایی که صدای مشخص دارند مناسب است؛ تشخیص آکوردها و چند نت هم‌زمان از طریق میکروفون قابل اتکا نیست. برای ارزیابی دقیق آکورد و ریتم، کنترلر MIDI همچنان گزینه‌ی پیشنهادی است.
- برای کاهش بازخورد صوتی، صدای تولیدشده‌ی برنامه هنگام ورودی میکروفون پخش نمی‌شود. ممکن است محیط پر سر و صدا یا صدای سازهای دیگر روی تشخیص اثر بگذارد.
- مرورگر باید اجازه‌ی میکروفون داشته باشد؛ در وب، صفحه را از `localhost` یا بستر امن باز کنید.

## فاز ۴: مسیر آموزشی و آزمون عملی

- هر درس شامل درسنامه‌ها و تمرین‌های هدایت‌شده است؛ برای عبور از تمرین باید حدنصاب همان تمرین کسب شود.
- آزمون عملی پایان هر درس از یک تمرین معتبر همان درس ساخته می‌شود و در حالت «با ضرب» اجرا می‌شود.
- حدنصاب آزمون پایانی در نسخهٔ ۰٫۸ برابر ۸۵٪ است و در `assessment.pass.minAccuracy` قابل تنظیم است.
- مراحل بعدی تا تکمیل پیش‌نیازها قفل هستند؛ قبولی آزمون پایانی درس بعدی را باز می‌کند.
- پیشرفت مراحل و قبولی‌ها به‌صورت محلی در مرورگر/نسخه دسکتاپ ذخیره می‌شود.

## وضعیت نسخهٔ فعلی (فاز ۸)

- ۱۲ درس اصلی؛ برای هر درس هدف‌های یادگیری، روش تمرین مرحله‌ای و یک آزمون عملی نهایی متصل به تمرین تلفیقی وجود دارد.
- موضوعات دوره با فهرست سرفصل‌های منبع در بازهٔ صفحات ۴ تا ۹۶ تطبیق داده شده‌اند؛ همهٔ قطعه‌ها و تمرین‌های چاپی کتاب رونویسی نشده‌اند.
- `CURRICULUM_AUDIT.md` وضعیت پوشش و محدودیت‌های آموزشی را توضیح می‌دهد.
- `npm test` شامل اعتبارسنجی محتوای درس‌ها، رندر نت‌نویسی و منطق تمرین است.
- صدای پیانو فعلاً سنتزشده است؛ صدای واقعی مبتنی بر سمپل در فاز جداگانه بررسی می‌شود.

مستندات: `docs/ARCHITECTURE.md` و `docs/LESSON_FORMAT.md`


## Phase 5 — content audit and expanded course

See `CONTENT_AUDIT_PHASE5.md` for page-range coverage and known gaps. The main course now includes 12 sequential lessons covering the book topics from pages 4–96 with original practice patterns. This is topic coverage, not a transcription of every copyrighted piece. Every main lesson includes a practical assessment. Phase 8 sets the final-assessment threshold to 85%.


## Phase 5 — content audit and expanded course

See `CONTENT_AUDIT_PHASE5.md` for page-range coverage and known gaps. The main course now includes 12 sequential lessons covering the book topics from pages 4–96 with original practice patterns. This is topic coverage, not a transcription of every copyrighted piece. Every main lesson includes a practical assessment. Phase 8 sets the final-assessment threshold to 85%.


## Phase 6 — Progress analytics and smart review

- Stores up to 500 course practice attempts locally with timestamp, lesson, step, mode, accuracy, pass/fail, errors/misses and timing tendency.
- Adds a **پیشرفت من** dashboard with overall completion, total and last-7-day accuracy, per-lesson summaries and weakest lessons.
- Suggests up to three lesson reviews based on observed low accuracy and errors.
- Supports exporting progress as JSON and clearing progress after confirmation.
- Progress remains in this browser profile; it is not synced across devices. Older attempts cannot be reconstructed retroactively.

## Design refresh — Refined

The interface now follows an editorial, modern-minimal design direction inspired by the Refined skill: warm neutral surfaces, restrained blue accents, clearer typography hierarchy, consistent spacing, stronger focus-visible states, and responsive navigation/dashboard layouts. See `DESIGN_SYSTEM.md` for tokens, component rules, accessibility criteria, anti-patterns, and a QA checklist.


## Phase 5 — Expanded course content audit

- Added original exercises and supplemental instruction for rests/dynamics/repeats, dotted-half values and legato, block/broken chords and pedal technique, waltz meter and dotted-quarter rhythms, seventh/octave intervals, blues motifs, syncopation, eighth rests and triplet counting.
- See `CONTENT_AUDIT_PHASE5.md` for the page-range map, estimated coverage method, and limitations.
- Coverage estimate: all source page ranges are mapped to lessons; estimated instructional/practice coverage is 76%. This is a documented content audit, not a claim that every score and notation mark from the copyrighted book is reproduced.
- This was the known status at the end of Phase 5; triplets, D.C. al Fine, first/second endings, and several articulation marks were implemented in Phase 7. Physical pedal-input grading remains out of scope.


## Phase 7 — Expressive notation and playback navigation

- Adds eighth-note triplet token `t` (three notes occupy one quarter-note beat) to score parsing, notation rendering, playback scheduling and rhythm evaluation.
- Renders slurs, ties, staccato dots, accents, fermatas, pedal spans, alternate-ending brackets and D.C. al Fine / Fine labels.
- Playback honors tie continuation, staccato shortening, accent velocity, fermata extension, and sustain pedal spans.
- Expands repeat ranges with first/second endings and D.C. al Fine into the actual playback order.
- Tied destination notes are not counted as new expected key presses in practice/evaluation.
- Adds three hands-on technique exercises to the final review lesson to exercise the new features.
- Browser audio uses a synthesized piano-like tone rather than licensed acoustic-piano samples; the sustain pedal behavior is simulated in the Web Audio synth.


### Known Phase 7 limitations

- The current sound generator remains a Web Audio synthesized piano-like timbre. A realistic sampled grand-piano library is not bundled in this archive; adding one requires including a redistributable sample set and increases package size.
- The repeat/navigation engine is implemented for lesson playback and practice scheduling. The score display uses the original written page with repeat/ending/navigation marks; it does not animate a separate page layout for each repeated pass.
- The renderer draws cross-system ties/slurs as short continuation arcs; pedal span lines are only drawn when the span is contained within one system. Playback timing still honors the pedal span.


## Phase 8 — complete beginner curriculum

- Every lesson now exposes learning outcomes and a repeatable practice routine.
- Added an original integrated checkpoint to all 12 course lessons and linked the final assessment to that checkpoint.
- Added targeted instruction/practice for ties versus slurs, right-hand chord shapes, note finding, intervals, extended hand position, syncopation, dynamics, triplets, and final readiness.
- See `CURRICULUM_AUDIT.md` for source-topic mapping and remaining limits.
- Validation: `npm test` — 53 tests passed, 0 failed.


## فاز ۹ — صدای پیانو و بانک سمپل

- از دکمهٔ **صدای پیانو** در نوار بالایی، موتور صدای سنتزشده یا سمپل‌شده را انتخاب کن.
- برای استفاده از صدای طبیعی‌تر، فایل‌های WAV خودت را بارگذاری کن. نام هر فایل باید شمارهٔ MIDI مثل `60.wav` یا نام نت مثل `C4.wav` باشد. هر فایل یک نت پایه را مشخص می‌کند؛ نت‌های بین نمونه‌ها با تغییر کوک پخش می‌شوند.
- فایل‌ها در همان اجرای برنامه نگه داشته می‌شوند و پس از راه‌اندازی مجدد باید دوباره انتخاب شوند. برنامه هیچ بانک صدای شخص ثالثی را همراه خود توزیع نمی‌کند.
- فاز ۹ به‌تنهایی میزبان VST3 نداشت. فاز ۱۰ منبع میزبان Native و اتصال رابط کاربری را اضافه می‌کند؛ باینری هنوز باید روی ویندوز ساخته و با یک ساز واقعی آزمایش شود.
- تست‌ها: `npm test`.

## Native VST3 host (Phase 10)

A first native-host implementation is now included under `native/vst-host/`: a JUCE/CMake sidecar process scans standard VST3 folders, loads one instrument, routes audio to the Windows output device, and receives MIDI note/sustain/volume commands from Electron through a restricted IPC bridge. The sound settings panel includes scan/load/test controls.

The native binary is not bundled in the source ZIP and has not been built or audio-tested in this environment. On Windows, follow `native/vst-host/README.md` to build it with Visual Studio C++ Build Tools, CMake, Git, and JUCE. Until the binary exists, the UI reports that VST hosting needs to be built; the built-in synth and WAV sample engine remain available. Plugin editor windows, custom scan folders, real-time-safe lock-free handoff, packaging, and Windows audio-latency verification remain future work.
## Windows installer (automated)

The GitHub Actions workflow at `.github/workflows/release-windows.yml` runs the JavaScript tests, configures and builds the native VST3 host with Visual Studio 2022, and packages a Windows x64 NSIS installer. Run it from the repository's **Actions** tab (or push to `main`/`master`); download `piano-trainer-windows-installer` from the completed workflow's Artifacts section.

**Important:** this workflow is a build pipeline, not proof that the native VST host already works. It will fail if JUCE cannot be fetched, native code does not compile, or packaging fails. The VST3 host does not bundle an instrument plugin or piano sample library. The JUCE licensing terms must be reviewed before redistributing a build that includes JUCE.


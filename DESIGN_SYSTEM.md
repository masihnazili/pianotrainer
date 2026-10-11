# Refined Design System — Piano Studio

## Intent
Create a calm, editorial piano-learning workspace that feels like a focused music studio: restrained typography, warm paper-like surfaces, clear hierarchy, and blue as the single primary interaction color.

## Foundations

- **Style:** modern minimal, editorial, music-focused.
- **Typography:** Playfair Display/Georgia for Latin display headings with Vazirmatn/Segoe UI/Tahoma/system fallbacks for Persian UI and body copy. Do not rely on remote font downloads for core usability.
- **Palette:** page `#f6f5f1`; surface `#fffefa`; ink `#1d2428`; muted text `#687177`; border `#e4e2dc`; primary `#3b82f6`; primary soft `#eaf2ff`; success `#16845b`; warning `#d97706`; danger `#dc4c4c`.
- **Spacing:** use a consistent 4/8/12/16/24/32 px rhythm where practical.
- **Shape:** 11–20 px corner radii depending on control/card hierarchy; avoid excessive shadows.

## Component rules

- **Top bar:** quiet surface, brand lockup and subtitle at the start, device connection and actions grouped together. Allow wrapping on small screens.
- **Lesson navigation:** use muted text by default, a soft-blue active row with a 3 px accent edge, explicit completed/locked states, and a visible keyboard focus ring.
- **Lesson card:** one strong title, muted instruction text, generous spacing, readable line-height; score area stays on a clean paper-like surface.
- **Practice modes:** segmented control with one obvious active state. Do not use color alone to convey selection.
- **Primary action:** dark slate filled button for strong action hierarchy; blue remains the system accent for current notes, focus, and score visualization.
- **Virtual keyboard:** dark frame, light keys, clear pressed/correct/wrong/target states. Keep keyboard labels readable.
- **Progress dashboard:** four compact stat cards on wide screens, two on small screens; tables collapse to concise rows and recommendations stack vertically.
- **States:** default, hover, focus-visible, active, disabled, success, retry/error, and empty state must remain visually distinguishable.

## Accessibility and responsive behavior

- Preserve RTL layout for Persian and LTR layout for the score and piano keyboard.
- All interactive controls must remain native buttons/inputs/selects and be keyboard reachable.
- Focus indicator: 3 px translucent blue outline with 2 px offset.
- Respect `prefers-reduced-motion`.
- At 860 px and below, stack top bar, course navigation, and main content; at 560 px and below, simplify device controls and practice modes.
- Never hide essential labels only to save space; avoid horizontal overflow on small screens.
- Keep text contrast at a readable level; verify the final rendered palette against WCAG 2.2 AA before release.

## Content tone
Use concise, confident, supportive Persian. Labels should name actions directly (e.g. «اتصال کنترلر»، «پخش»، «پیشرفت من»). Keep helper text short and actionable.

## Anti-patterns

- Do not add several competing accent colors, heavy gradients, or decorative glass effects.
- Do not use emoji as the only signal for status or meaning.
- Do not use color alone for active, locked, correct, or incorrect states.
- Do not use inconsistent corner radii, arbitrary spacing, or large shadows on every surface.
- Do not reduce focus outlines or use low-contrast muted text for essential instructions.

## QA checklist

- [ ] Verify top bar wrapping and course navigation at 320 px, 560 px, 860 px, and desktop widths.
- [ ] Navigate every button and select using keyboard only; confirm visible focus.
- [ ] Confirm RTL lesson text and LTR score/keyboard render correctly together.
- [ ] Confirm locked, completed, active, correct, wrong, pass, retry, and empty states remain distinct.
- [ ] Confirm reduced-motion preference disables smooth transitions.
- [ ] Run `npm test` before packaging.

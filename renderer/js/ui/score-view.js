// Small helpers to colour notes and move the cursor inside a rendered score (DOM side only).

const STATES = ['current', 'active', 'correct', 'wrong', 'warn'];

/** state: 'current' | 'active' | 'correct' | 'wrong' | 'warn' | null (clears). */
export function setNoteState(root, id, state) {
  const el = root.querySelector(`.note[data-id="${id}"]`);
  if (!el) return;
  STATES.forEach((s) => el.classList.remove(`is-${s}`));
  if (state) el.classList.add(`is-${state}`);
}

export function clearNoteStates(root) {
  root.querySelectorAll('.note').forEach((el) => STATES.forEach((s) => el.classList.remove(`is-${s}`)));
}

export function ensureCursor(root) {
  const overlay = root.querySelector('.overlay');
  if (!overlay) return null;
  overlay.innerHTML = '<rect class="cursor" id="cursor" width="30" height="0" rx="8" visibility="hidden"></rect>';
  return overlay.firstChild;
}

export function hideCursor(root) {
  root.querySelector('#cursor')?.setAttribute('visibility', 'hidden');
}

/** Move the cursor to the slot at startBeat. Returns the slot or null. */
export function moveCursor(root, rendered, startBeat, { scroll = true } = {}) {
  const cur = root.querySelector('#cursor');
  if (!cur || !rendered) return null;
  const slot = rendered.layout.slots.find((sl) => Math.abs(sl.startBeat - startBeat) < 1e-6);
  if (!slot) return null;
  cur.setAttribute('x', slot.x - 15);
  cur.setAttribute('y', slot.yTop);
  cur.setAttribute('height', slot.yBottom - slot.yTop);
  cur.setAttribute('visibility', 'visible');
  if (scroll) cur.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  return slot;
}

/** Latest slot whose startBeat <= beat (for a continuously moving cursor). */
export function slotAtBeat(rendered, beat) {
  let found = null;
  for (const sl of rendered.layout.slots) {
    if (sl.startBeat <= beat + 1e-6) found = sl;
    else break;
  }
  return found;
}

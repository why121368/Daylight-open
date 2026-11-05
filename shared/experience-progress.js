import { EXPERIENCE_STEPS, EXPERIENCE_VERSION } from './experience-fixtures.js';

export const EXPERIENCE_PROGRESS_KEY = 'daylight:experience:progress:v1';
const validStep = value => Number.isInteger(value) && value >= 0 && value <= EXPERIENCE_STEPS.length;
const empty = () => ({ step: 0, furthest: 0 });

export function readExperienceProgress(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(EXPERIENCE_PROGRESS_KEY) || 'null');
    if (saved?.version === EXPERIENCE_VERSION && validStep(saved.step) && validStep(saved.furthest) && saved.furthest >= saved.step) {
      return { step: saved.step, furthest: saved.furthest };
    }
  } catch { /* A browser may deny session storage. The URL remains usable. */ }
  return empty();
}

export function experienceStart(search, storage) {
  const saved = readExperienceProgress(storage);
  const values = new URLSearchParams(search).getAll('step');
  if (!values.length) return saved;
  if (values.length !== 1 || !/^[0-7]$/.test(values[0])) return empty();
  const step = Number(values[0]);
  return { step, furthest: step === 0 ? 0 : Math.max(step, saved.furthest) };
}

export function saveExperienceProgress(storage, progress) {
  if (!validStep(progress.step) || !validStep(progress.furthest) || progress.furthest < progress.step) return false;
  try {
    storage?.setItem(EXPERIENCE_PROGRESS_KEY, JSON.stringify({ version: EXPERIENCE_VERSION, step: progress.step, furthest: progress.furthest }));
    return Boolean(storage);
  } catch { return false; }
}

export function experienceSearch(search, step) {
  if (!validStep(step)) throw new RangeError('Invalid experience step.');
  const next = new URLSearchParams(search);
  next.set('step', String(step));
  return `?${next}`;
}

export function experienceShareUrl(origin, step) {
  if (!validStep(step)) throw new RangeError('Invalid experience step.');
  const url = new URL('/experience', new URL(origin).origin);
  url.searchParams.set('step', String(step));
  return url.href;
}

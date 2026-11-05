const offset = 8 * 3600 * 1000;
export function studyLocalTime(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  return new Date(Date.parse(value) + offset).toISOString().slice(0, 16);
}

/** Native inputs may include seconds/milliseconds; the study records whole minutes. */
export function studyWireTime(value) {
  if (typeof value !== 'string' || !/^2026-11-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?$/.test(value)) return null;
  const minute = value.slice(0, 16);
  const result = `${minute}:00+08:00`;
  return studyLocalTime(result) === minute ? result : null;
}

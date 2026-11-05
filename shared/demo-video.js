/** The chapter interval is [start, end); the final frame belongs to the last chapter. */
export function chapterAtTime(chapters, seconds) {
  if (!chapters.length) return null;
  const time = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return chapters.find(chapter => time >= chapter.start && time < chapter.end)
    || (time >= chapters.at(-1).end ? chapters.at(-1) : chapters[0]);
}

export function chapterById(chapters, id) {
  return chapters.find(chapter => chapter.id === id) || chapters[0];
}

export function videoClock(seconds) {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(value / 60).toString().padStart(2, '0')}:${(value % 60).toString().padStart(2, '0')}`;
}

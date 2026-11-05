import fs from 'node:fs';
import { validateCatalog } from '../../shared/campus-guide.js';

export function shanghaitechCatalog() {
  return validateCatalog(JSON.parse(fs.readFileSync(new URL('./catalogs/shanghaitech-map.json', import.meta.url), 'utf8')));
}

/** Add the official snapshot without deleting existing catalog rows or personal references. */
export function mergeShanghaitechCatalog(current) {
  const existing = validateCatalog(current), imported = shanghaitechCatalog();
  const ids = new Set(existing.places.map(place => place.id));
  const added = imported.places.filter(place => !ids.has(place.id));
  const combined = validateCatalog({ ...existing, meta: { ...existing.meta, title: imported.meta.title, center: imported.meta.center, zoom: imported.meta.zoom, mapImage: imported.meta.mapImage,
    dataSource: existing.meta.dataSource.includes(imported.meta.dataSource) ? existing.meta.dataSource : [imported.meta.dataSource, existing.meta.dataSource].filter(Boolean).join('；').slice(0, 1000),
    notice: `${imported.meta.notice}${existing.meta.isDemo ? ' 保留的示例记录仍标注为示例。' : ''}` }, places: [...existing.places, ...added] });
  return { catalog: combined, added: added.length, retained: existing.places.length };
}

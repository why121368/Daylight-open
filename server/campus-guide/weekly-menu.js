import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { validateCatalog } from '../../shared/campus-guide.js';

export const weeklyMenu = JSON.parse(fs.readFileSync(new URL('./catalogs/menu-2026-11-02.json', import.meta.url), 'utf8'));
export const nextWeeklyMenu = JSON.parse(fs.readFileSync(new URL('./catalogs/menu-2026-11-09.json', import.meta.url), 'utf8'));
const venues = [
  { id: 'shangke', name: '尚科食堂一楼', placeId: 'sht-service-fcd6a84e9af648fdac33832762876cdc', windows: [['breakfast', '早餐档口'], ['self', '自选菜档口']] },
  { id: 'baiyulan', name: '白玉兰食堂', placeId: 'sht-service-b2f5c7d51294404288711fbb6b176905', windows: [['self', '自选菜档口']] },
  { id: 'silu', name: '丝路食堂', placeId: 'sht-service-82c19dfc151744d49444d437bbe69068', windows: [['breakfast', '早餐档口'], ['noodle', '拉面档口'], ['self', '自选菜档口']] },
];

/** Versioned supplied menu supplement. Existing IDs retain administrators' edits. */
export function withWeeklyMenu(catalog) {
  return [weeklyMenu, nextWeeklyMenu].reduce(withMenuSupplement, catalog);
}

function withMenuSupplement(catalog, menu) {
  const version = `menu-${menu.week}`;
  if (catalog.meta.isDemo || catalog.meta.supplements?.includes(version) || !venues.every(v => catalog.places.some(p => p.id === v.placeId))) return catalog;
  const addedVenues = venues.map(v => ({ id: `canteen-${v.id}`, name: v.name, placeId: v.placeId, floor: '1', windows: v.windows.map(([id, name]) => ({ id: `canteen-${v.id}-${id}`, name })) }));
  const addedMenus = menu.menus.map((row, index) => ({
    id: `menu-${menu.week.replaceAll('-', '')}-${createHash('sha256').update(`${index}:${row.venue}:${row.name}`).digest('hex').slice(0, 20)}`,
    venueId: `canteen-${row.venue}`, windowId: `canteen-${row.venue}-${row.window}`, name: row.name, price: row.price,
    availableDays: row.day ? [row.day] : [1, 2, 3, 4, 5, 6, 7], meal: row.meal,
    validFrom: menu.week, validUntil: menu.until, portion: row.portion,
    unit: row.portion || '份', tags: [], menuImageUrl: menu.sources[row.source].image,
    description: `来源：${menu.sources[row.source].name}，${menu.week}–${menu.until}。${menu.notice || ''}${row.meal === 'all' ? '原图未区分餐次；实际供应餐次请向窗口确认。' : ''}${row.name.includes('原图字符缺失') ? '原图菜名不完整，需到窗口核对。' : ''}${row.venue === 'silu' && row.window === 'self' ? '原图注明可提供半价选餐；份量与收费到窗口核对。' : ''}食材采购可能导致调整，以当天公示为准。营养成分与加糖量未提供。`,
  }));
  const merge = (existing, rows) => [...existing, ...rows.filter(row => !existing.some(old => old.id === row.id))];
  const mergedVenues = merge(catalog.venues, addedVenues).map(venue => {
    const added = addedVenues.find(row => row.id === venue.id);
    return added ? { ...venue, windows: merge(venue.windows || [], added.windows) } : venue;
  });
  return validateCatalog({ ...catalog, meta: { ...catalog.meta, notice: catalog.meta.notice.replace('课表、活动、菜单及可导航路网需另行补充。', '本周菜单已录入，活动与私人安排分别以公开通知和本人邮箱为准；校内道路与入口仍需核验。'), supplements: [...(catalog.meta.supplements || []), version] }, venues: mergedVenues, menus: merge(catalog.menus, addedMenus) });
}

import { validateCatalog } from '../../shared/campus-guide.js';

/** These invented sample positions, roads, rooms, activities and menus are not a campus survey. */
export function demoCatalog() {
  const allDays = [1, 2, 3, 4, 5, 6, 7], diningHours = [{ days: allDays, start: '07:00', end: '09:00' }, { days: allDays, start: '11:00', end: '13:30' }, { days: allDays, start: '17:00', end: '20:00' }];
  const definitions = [
    ['demo-gate', '南门（示意）', 'gate', 31.1737, 121.5895, ['校门', '访客入口']],
    ['demo-teaching', '教学中心（示意）', 'teaching', 31.1750, 121.5896, ['教室', '教学楼', '教学中心 101', '教学中心 201']],
    ['demo-library', '图书馆（示意）', 'service', 31.1760, 121.5902, ['借阅', '自习', '打印']],
    ['demo-research', '科研楼（示意）', 'research', 31.1770, 121.5920, ['实验室', '实验楼']],
    ['demo-dining', '校园食堂（示意）', 'dining', 31.1762, 121.5885, ['餐厅', '早餐', '午餐', '晚餐']],
    ['demo-dorm', '学生宿舍（示意）', 'residence', 31.1780, 121.5882, ['宿舍', '生活区']],
    ['demo-sports', '体育中心（示意）', 'sports', 31.1780, 121.5907, ['运动', '篮球', '健身']],
    ['demo-parcel', '校园快递站（示意）', 'service', 31.1745, 121.5877, ['快递', '取件']],
    ['demo-shuttle', '校园班车站（示意）', 'transit', 31.1738, 121.5908, ['班车', '公交', '交通']],
  ];
  const nodes = definitions.map(([id, , , lat, lng]) => ({ id: `node-${id}`, lat, lng, level: 'ground', isDemo: true }));
  nodes.push({ id: 'demo-underground-a', lat: 31.1755, lng: 121.5901, level: 'underground', isDemo: true });
  nodes.push({ id: 'demo-vehicle-entry', lat: 31.1739, lng: 121.5924, level: 'underground', kind: 'entrance', isDemo: true }, { id: 'demo-vehicle-junction', lat: 31.1750, lng: 121.5924, level: 'underground', isDemo: true }, { id: 'demo-vehicle-exit', lat: 31.1762, lng: 121.5924, level: 'underground', kind: 'entrance', isDemo: true });
  const places = definitions.map(([id, name, category, lat, lng, tags]) => ({ id, name, category, lat, lng, nodeId: `node-${id}`, tags, aliases: tags, description: '这是用于体验功能的示意数据，地点位置、名称和开放时间未经校园现场核验，请勿用于真实出行。', address: '校园示意区域', accessible: true, isDemo: true, openHours: category === 'dining' ? diningHours : [{ days: allDays, start: '07:00', end: '22:00' }] }));
  // Original schematic rectangles, solely for trying building-outline maintenance.
  for (const place of places.filter(place => ['demo-teaching', 'demo-library', 'demo-dining'].includes(place.id))) {
    place.polygons = [{ id: `${place.id}-outline`, points: [{ lat: place.lat - 0.00016, lng: place.lng - 0.00023 }, { lat: place.lat - 0.00016, lng: place.lng + 0.00023 }, { lat: place.lat + 0.00016, lng: place.lng + 0.00023 }, { lat: place.lat + 0.00016, lng: place.lng - 0.00023 }] }];
    place.entrances = [{ id: `${place.id}-entrance`, name: '主入口（示意）', lat: place.lat - 0.00016, lng: place.lng, nodeId: place.nodeId, accessible: true, kind: 'main' }];
  }
  for (const place of places.filter(place => ['demo-teaching', 'demo-research'].includes(place.id))) { place.groupId = 'demo-academic'; place.groupName = '教学科研楼群（示意）'; place.occupants = ['示例教学单位']; }
  places.find(place => place.id === 'demo-teaching').englishName = 'Teaching Center (schematic)';
  const connections = [
    ['demo-gate', 'demo-teaching', 160, false], ['demo-gate', 'demo-shuttle', 130, false], ['demo-gate', 'demo-parcel', 210, false],
    ['demo-teaching', 'demo-library', 150, false], ['demo-teaching', 'demo-dining', 190, true], ['demo-library', 'demo-dining', 180, true],
    ['demo-library', 'demo-research', 220, true], ['demo-research', 'demo-sports', 190, false], ['demo-dining', 'demo-dorm', 240, true],
    ['demo-dorm', 'demo-sports', 260, false], ['demo-dining', 'demo-parcel', 240, false],
  ];
  const edges = connections.map(([from, to, distanceMeters, covered], i) => ({ id: `demo-road-${i + 1}`, from: `node-${from}`, to: `node-${to}`, distanceMeters, covered, accessible: true, bidirectional: true, level: 'ground', isDemo: true, description: covered ? '示意连廊（非实测道路）' : '示意露天校园路（非实测道路）' }));
  edges.push({ id: 'demo-underground-1', from: 'node-demo-teaching', to: 'demo-underground-a', distanceMeters: 120, covered: true, accessible: false, bidirectional: true, level: 'underground', isDemo: true, description: '地下通道示意，未现场核验' }, { id: 'demo-underground-2', from: 'demo-underground-a', to: 'node-demo-library', distanceMeters: 110, covered: true, accessible: false, bidirectional: true, level: 'underground', isDemo: true, description: '地下通道示意，未现场核验' });
  edges.push({ id: 'demo-vehicle-road-1', from: 'demo-vehicle-entry', to: 'demo-vehicle-junction', distanceMeters: 130, kind: 'vehicle', level: 'underground', walkable: false, isDemo: true, description: '独立地下车行路示意，非实测导航' }, { id: 'demo-vehicle-road-2', from: 'demo-vehicle-junction', to: 'demo-vehicle-exit', distanceMeters: 140, kind: 'vehicle', level: 'underground', walkable: false, isDemo: true, description: '独立地下车行路示意，非实测导航' });
  return validateCatalog({
    meta: { schemaVersion: 1, revision: 0, title: 'Daylight 校园一图通', description: '校园地图、活动、用餐与一天安排。', timezone: 'Asia/Shanghai', dataSource: 'Daylight 自制示意数据；未复制参考项目地图、活动或菜单。', notice: '当前目录全部为明确标注的示意 / 示例数据，非真实校园导航、实时活动或官方菜单。管理员可一键清除后导入已获授权、经过核验的资料。', isDemo: true, center: { lat: 31.176, lng: 121.590 }, zoom: 16 }, places, nodes, edges,
    events: [
      { id: 'demo-event-academic', title: '示例 · AI 与科研分享会', englishTitle: 'AI Research Sharing (sample)', speaker: '示例主讲人', room: '101', locationText: '教学中心 101（示意）', summary: '体验活动详情、参加意向和日程规划。', description: '这不是一场真实活动。此处用于演示活动时间、地点、主办方、参加意向及签到功能。实际活动由管理员录入并核对来源。', category: 'academic', placeId: 'demo-teaching', start: '2026-10-26T18:30:00+08:00', end: '2026-10-26T20:00:00+08:00', registrationDeadline: '2026-10-26T18:30:00+08:00', organizer: '示例主办方', tags: ['示例', 'AI'], isDemo: true },
      { id: 'demo-event-sports', title: '示例 · 校园运动体验', summary: '演示校园活动筛选。', description: '示例活动，不接受真实报名。', category: 'sports', placeId: 'demo-sports', start: '2026-10-27T16:30:00+08:00', end: '2026-10-27T18:00:00+08:00', organizer: '示例社团', tags: ['示例', '运动'], isDemo: true },
      { id: 'demo-event-career', title: '示例 · 求职简历交流', summary: '从校园活动衔接 Daylight 求职工作台。', description: '示例活动，不代表真实招聘或宣讲。', category: 'career', placeId: 'demo-library', start: '2026-10-28T14:00:00+08:00', end: '2026-10-28T16:00:00+08:00', organizer: '示例职业发展中心', tags: ['示例', '求职'], isDemo: true },
    ],
    venues: [
      { id: 'demo-canteen-1', placeId: 'demo-dining', name: '示例食堂 · 一楼', floor: '1', cuisine: '快餐 / 面食', openHours: diningHours, tags: ['示例', '实惠'], windows: [{ id: 'demo-window-rice', name: '家常菜窗口（示例）', cuisine: '中式', tags: ['米饭'], openHours: diningHours }, { id: 'demo-window-noodle', name: '面食窗口（示例）', cuisine: '面食', tags: ['面条'], openHours: diningHours }], isDemo: true },
      { id: 'demo-canteen-2', placeId: 'demo-dining', name: '示例食堂 · 二楼', floor: '2', cuisine: '轻食 / 风味', openHours: [{ days: allDays, start: '10:30', end: '20:00' }], tags: ['示例', '轻食'], windows: [{ id: 'demo-window-salad', name: '轻食窗口（示例）', cuisine: '轻食', tags: ['清淡'], openHours: [{ days: allDays, start: '10:30', end: '20:00' }] }], isDemo: true },
    ],
    menus: [
      { id: 'demo-menu-rice', venueId: 'demo-canteen-1', windowId: 'demo-window-rice', name: '示例 · 两荤一素套餐', price: 16, tags: ['米饭', '套餐', '示例'], flavor: '家常 / 微辣', meal: 'all', availableDays: allDays, isDemo: true },
      { id: 'demo-menu-noodle', venueId: 'demo-canteen-1', windowId: 'demo-window-noodle', name: '示例 · 番茄鸡蛋面', price: 12, tags: ['面食', '示例'], flavor: '清淡', meal: 'all', availableDays: allDays, isDemo: true },
      { id: 'demo-menu-salad', venueId: 'demo-canteen-2', windowId: 'demo-window-salad', name: '示例 · 鸡肉蔬菜碗', price: 22, tags: ['轻食', '示例'], flavor: '清淡 / 低辣', meal: 'all', availableDays: allDays, isDemo: true },
    ],
    indoorPlans: [{ id: 'demo-plan-teaching-1', placeId: 'demo-teaching', name: '教学中心一楼（示意）', floor: '1', width: 1000, height: 600, isDemo: true, rooms: [
      { id: 'demo-room-101', name: '示意教室 101', number: '101', x: 60, y: 60, width: 240, height: 180, type: 'classroom' },
      { id: 'demo-room-102', name: '示意教室 102', number: '102', x: 350, y: 60, width: 240, height: 180, type: 'classroom' },
      { id: 'demo-room-103', name: '示意教室 103', number: '103', x: 650, y: 60, width: 240, height: 180, type: 'classroom' },
      { id: 'demo-room-stairs', name: '示意楼梯', number: '', x: 60, y: 380, width: 140, height: 140, type: 'stairs' },
      { id: 'demo-room-wc', name: '示意卫生间', number: '', x: 750, y: 380, width: 140, height: 140, type: 'toilet' },
    ], paths: [{ points: [{ x: 80, y: 300 }, { x: 900, y: 300 }] }] }],
    parcelStations: [{ id: 'demo-parcel-station', placeId: 'demo-parcel', name: '校园快递站（示意）', notice: '示意布局与分区，不对应真实快递站。取件码仅在本机浏览器匹配，不发送到服务器。', width: 1000, height: 600, isDemo: true, shelves: [
      { id: 'demo-shelf-a', label: 'A 区（示意）', aliases: ['A', 'A区'], prefixes: ['A'], x: 100, y: 70, width: 200, height: 180, levels: 5 },
      { id: 'demo-shelf-b', label: 'B 区（示意）', aliases: ['B', 'B区'], prefixes: ['B'], x: 400, y: 70, width: 200, height: 180, levels: 5 },
      { id: 'demo-shelf-c', label: 'C 区（示意）', aliases: ['C', 'C区'], prefixes: ['C'], x: 700, y: 70, width: 200, height: 180, levels: 5 },
    ], facilities: [{ id: 'demo-parcel-exit', name: '示意出入口', x: 500, y: 540, type: 'entrance' }, { id: 'demo-parcel-counter', name: '示意服务台', x: 170, y: 470, type: 'counter' }] }], streetViews: [],
  });
}

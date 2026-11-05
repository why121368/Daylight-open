"""Build a captioned walkthrough from verified page captures and project figures.

Requires Pillow and ffmpeg. This produces a three-minute screenshot explainer.
Usage: python scripts/competition-walkthrough.py --ffmpeg /path/to/ffmpeg
"""
from pathlib import Path
import argparse
import json
import subprocess
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
IMAGES = ROOT / 'docs/competition-2026-11-03/images'
FRAMES = ROOT / 'work/competition-video-frames'
FRAMES.mkdir(parents=True, exist_ok=True)
BG, GREEN, MUTED = '#f8f5ed', '#173e30', '#57695f'

def font(size, bold=False):
    candidates = [Path('C:/Windows/Fonts/msyhbd.ttc' if bold else 'C:/Windows/Fonts/msyh.ttc'),
                  Path('/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc' if bold else '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc')]
    path = next((path for path in candidates if path.exists()), None)
    if path is None:
        raise RuntimeError('Install Microsoft YaHei or Noto Sans CJK for Chinese captions.')
    return ImageFont.truetype(str(path), size)

def wrapped(draw, text, xy, width, size=35, color=GREEN, bold=False, spacing=17):
    x, y = xy
    f = font(size, bold)
    line = ''
    for char in text:
        if char == '\n' or draw.textbbox((0, 0), line + char, font=f)[2] > width:
            draw.text((x, y), line, font=f, fill=color)
            y += size + spacing
            line = '' if char == '\n' else char
        else:
            line += char
    if line:
        draw.text((x, y), line, font=f, fill=color)
        y += size + spacing
    return y

scenes = [
    ('从邮件到下一步', 'experience-start-mobile.jpg', ['多个申请同时推进，通知、材料与临时改期分散在收件箱。', '打开同一个 HTTPS 入口，电脑和手机都能开始七步体验。', '原创邮件样例 · 预置提取结果 · 工具实时执行'], 'mobile'),
    ('01  通知变成安排与待办', 'experience-invitation-mobile.jpg', ['面试：11 月 5 日 10:00–10:30。', '材料：11 月 4 日 18:00 前准备一页研究经历。', '时间与材料要求分开记录，原文随时展开核对。'], 'mobile'),
    ('02  冲突留给本人决定', 'experience-conflict-mobile.jpg', ['14:00 的实验室交流与课题组例会重叠。', '日历标记时间冲突，原通知与回复草稿保留。', '用户查看已有安排后，决定如何协调。'], 'mobile'),
    ('03  改期关联新旧安排', 'experience-reschedule-mobile.jpg', ['上午面试调整到 15:00。', '旧安排标为取消，新安排记录变更邮件。', 'previousEventId 与 replacementEventId 双向关联历史。'], 'mobile'),
    ('04  重复邮件直接跳过', 'experience-duplicate-mobile.jpg', ['再次收到同一个邮件 ID。', '日程 4 → 4，待办 1 → 1。', '去重发生在提取前，减少重复计算与重复模型调用。'], 'mobile'),
    ('05  校验失败保持原状态', 'experience-failure-mobile.jpg', ['本步骤的预置提取故意包含无效时间。', '服务端先校验整封，再应用日程与任务。', '日程 4 → 4，待办 1 → 1；失败步骤记录在 Trace 中。'], 'mobile'),
    ('06  修正后重试成功', 'experience-retry-mobile.jpg', ['为同一封邮件提供有效时间，再次处理。', '新增 16:00 补充交流，失败尝试仍可回查。', '日历状态与每次执行结果都有来源。'], 'mobile'),
    ('07  取消留痕，材料保留', 'experience-complete-mobile.jpg', ['15:00 面试取消，释放对应时间。', '取消通知与旧安排保留，材料待办继续由本人处理。', '安排、来源、冲突、变更与恢复构成一条可追踪主线。'], 'mobile'),
    ('打开工具，核对执行', 'experience-tools-mobile.jpg', ['查看实际工具名、参数、状态与耗时。', '日历上下文 → 提取结果 → 冲突检查 → 应用操作 → 回复草稿。', '技术页同时提供真实模型固定回归：15 / 15 通过。'], 'mobile'),
    ('按负载与状态拆分服务', 'architecture.png', ['API / Worker / Scheduler 分离；PostgreSQL 保存权威状态。', '公网单节点 Compose；独立 k3s 容量与故障记录随报告提供。'], 'figure'),
    ('Agent 数据流与恢复路径', 'dataflow.png', ['邮件 ID 去重、有效上下文、结构化提取、整封校验、工具执行、Trace。', '模型固定回归：p50 7.299s / p95 15.795s；逐例结果与 Token 已保存。'], 'figure'),
    ('用实测与公式讨论成本', 'performance.png', ['同公网主机：工作区接口 2.57→0.70s；手机尺寸可用 8.77→2.38s。', '技术页可修改邮件数、Token、缓存比例与单价，按实际负载复算。'], 'figure'),
]

manifest = {'format': 'Actual page screenshot explainer with Chinese captions; silent',
            'durationSeconds': 180, 'resolution': [1920, 1080], 'source': 'Public site captures, gpt-image-2.5 architecture/dataflow, precise performance plot',
            'scenes': []}
for index, (title, filename, captions, kind) in enumerate(scenes):
    im = Image.new('RGB', (1920, 1080), BG)
    d = ImageDraw.Draw(im)
    d.text((70, 36), 'DAYLIGHT  /  2026.11.03', font=font(27, True), fill=GREEN)
    d.text((1335, 39), '实际页面截图与工程讲解 · 字幕版', font=font(24), fill=MUTED)
    d.line((70, 94, 1850, 94), fill='#c6d1c5', width=2)
    src = Image.open(IMAGES / filename).convert('RGB')
    if kind == 'mobile':
        src.thumbnail((395, 850), Image.Resampling.LANCZOS)
        sx, sy = 180 + (395-src.width)//2, 134
        d.rounded_rectangle((sx-12, sy-12, sx+src.width+12, sy+src.height+12), radius=25, fill='#ffffff', outline='#c6d1c5', width=2)
        im.paste(src, (sx, sy))
        y = wrapped(d, title, (730, 160), 1050, 58, bold=True, spacing=20) + 40
        for i, caption in enumerate(captions):
            d.ellipse((737, y+17, 748, y+28), fill='#3b7455')
            y = wrapped(d, caption, (780, y), 995, 35, spacing=19) + 36
        wrapped(d, 'daylight.yunforis.com/experience', (780, 900), 1000, 32, MUTED)
    else:
        d.text((80, 112), title, font=font(46, True), fill=GREEN)
        src.thumbnail((1280, 790), Image.Resampling.LANCZOS)
        im.paste(src, (80 + (1280-src.width)//2, 204 + (790-src.height)//2))
        y = 270
        for caption in captions:
            y = wrapped(d, caption, (1410, y), 410, 32, spacing=18) + 48
        wrapped(d, '技术与实测\ndaylight.yunforis.com/evidence', (1410, 820), 420, 25, MUTED)
    d.line((70, 1022, 1850, 1022), fill='#c6d1c5', width=2)
    d.text((80, 1040), '公开样例：预置提取，工具即时执行。模型回归与测量条件见图文记录。', font=font(21), fill=MUTED)
    d.text((1715, 1038), f'{index+1:02} / 12', font=font(24, True), fill=GREEN)
    frame = FRAMES / f'{index+1:02}.png'
    im.save(frame)
    manifest['scenes'].append({'title': title, 'source': filename, 'seconds': 15, 'captions': captions})

parser = argparse.ArgumentParser()
parser.add_argument('--ffmpeg', required=True)
args = parser.parse_args()
concat = FRAMES / 'concat.txt'
concat.write_text(''.join(f"file '{(FRAMES / f'{i+1:02}.png').as_posix()}'\nduration 15\n" for i in range(12)) + f"file '{(FRAMES/'12.png').as_posix()}'\n", encoding='utf-8')
dest = ROOT / 'public/competition/demo.mp4'
subprocess.run([args.ffmpeg, '-hide_banner', '-loglevel', 'warning', '-y', '-f', 'concat', '-safe', '0', '-i', str(concat), '-t', '180', '-r', '12', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(dest)], check=True)
(ROOT / 'docs/competition-2026-11-03/evidence/video-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'WALKTHROUGH_SAVED {dest} {dest.stat().st_size}')

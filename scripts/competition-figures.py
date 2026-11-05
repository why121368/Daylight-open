"""Render numeric evidence precisely after the image API style pass.
Input values come from the published 2026-11-03 performance report.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/competition-2026-11-03/images'
OUT.mkdir(parents=True, exist_ok=True)
FONT = Path('C:/Windows/Fonts/segoeui.ttf')
BOLD = Path('C:/Windows/Fonts/seguisb.ttf')
if not FONT.exists():
    FONT = Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
    BOLD = Path('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf')
def font(size, bold=False): return ImageFont.truetype(str(BOLD if bold else FONT), size)
im = Image.new('RGB', (1536, 1024), '#f8f5ed')
d = ImageDraw.Draw(im)
green = '#173e30'
d.text((64, 46), 'DAYLIGHT / MEASURED PERFORMANCE', font=font(49, True), fill=green)
d.text((64, 124), 'Same public host / HTTPS / 2026-11-03', font=font(27), fill='#536c5b')
metrics = [
    ('Workspace API pair', 2.57, .70, 3, 'HTTPS request-pair mean'),
    ('Mobile-size workspace ready', 8.77, 2.38, 10, '390 x 844 / 5 contexts per group'),
    ('Existing-mail resync', 17.02, 2.59, 20, 'Same mailbox / 3 runs per group'),
]
for i, (title, before, after, maximum, note) in enumerate(metrics):
    x = 52 + i * 500
    d.rounded_rectangle((x, 210, x+480, 840), radius=18, fill='#fffdf7', outline='#b8c7b8', width=2)
    d.text((x+22, 240), title, font=font(23, True), fill=green)
    bx, bw = x+38, 400
    d.text((bx, 320), f'Before  {before:.2f} s', font=font(27, True), fill='#555f59')
    d.rounded_rectangle((bx, 368, bx+bw*before/maximum, 428), radius=6, fill='#afb4af')
    d.text((bx, 490), f'After  {after:.2f} s', font=font(27, True), fill=green)
    d.rounded_rectangle((bx, 538, bx+bw*after/maximum, 598), radius=6, fill='#38714e')
    d.line((bx, 665, bx+bw, 665), fill=green, width=2)
    for n in range(6):
        tx = bx+bw*n/5
        d.line((tx, 665, tx, 675), fill=green, width=2)
        label = f'{maximum*n/5:g}'
        bounds = d.textbbox((0, 0), label, font=font(18))
        d.text((tx-(bounds[2]-bounds[0])/2, 684), label, font=font(18), fill=green)
    d.text((bx, 732), 'Seconds / independent scale', font=font(18), fill='#536c5b')
    d.text((bx, 780), note, font=font(18), fill='#536c5b')
d.text((64, 888), 'Means from bounded samples. Raw values and p50/p95 are saved with the report.', font=font(24), fill=green)
d.text((64, 940), 'Source: docs/performance-2026-11-03 / bars plotted from zero using exact values', font=font(22), fill='#536c5b')
im.save(OUT/'performance.png')
im.save(ROOT/'public/competition/performance.webp', quality=90)
print('PERFORMANCE_CHART_SAVED')

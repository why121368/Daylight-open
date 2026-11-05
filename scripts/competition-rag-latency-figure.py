"""Retain the generated infographic and typeset its currency line precisely."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import hashlib
import json
import shutil

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / 'docs/competition-rag-latency-2026-11-04'
original = ROOT / 'output/imagegen/rag-concise-20261104.png'
saved = DOC / 'assets/concise-answers-generated.png'
if original.is_file():
    shutil.copy2(original, saved)
image = Image.open(saved).convert('RGB')
assert image.size == (1536, 1024)
draw = ImageDraw.Draw(image)
font_path = next(p for p in [Path('C:/Windows/Fonts/arialbd.ttf'),
    Path('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf')] if p.is_file())
font = ImageFont.truetype(str(font_path), 30)
small = ImageFont.truetype(str(font_path), 18)
# The generated currency abbreviation was vertically compressed; replace only
# the numeric line, using the adjacent card's own paper background.
paper = image.crop((1030, 675, 1500, 688)).resize((470, 78))
image.paste(paper, (1030, 687))
draw = ImageDraw.Draw(image)
green = '#173e30'
draw.text((1265, 691), 'CNY', fill=green, font=small, anchor='mt')
draw.text((1054, 721), '0.061774', fill=green, font=font, anchor='lt')
draw.text((1477, 721), '0.047500', fill=green, font=font, anchor='rt')
draw.line((1248, 737, 1281, 737), fill='#e9ba4c', width=5)
draw.polygon([(1284, 737), (1273, 729), (1273, 745)], fill='#e9ba4c')
final = DOC / 'assets/concise-answers.webp'
image.save(final, 'WEBP', quality=90, method=6)
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
metadata = {
    'model': 'gpt-image-2.5', 'tool': 'imagegen bundled CLI',
    'size': '1536x1024', 'quality': 'high', 'language': 'English',
    'calls': 1, 'previousImageCalls': 10, 'totalImageCalls': 11,
    'prompt': 'latency-prompt.txt', 'promptSha256': sha(DOC / 'latency-prompt.txt'),
    'generated': {'file': saved.relative_to(DOC).as_posix(), 'sha256': sha(saved), 'bytes': saved.stat().st_size},
    'final': {'file': final.relative_to(DOC).as_posix(), 'sha256': sha(final), 'bytes': final.stat().st_size},
    'postprocess': 'Pillow replaces only the compressed currency value line with exact horizontal typography; generated layout and all other labels retained.',
    'billing': 'Supplier invoice; image API returned no billable amount.',
}
(DOC / 'image-generation.json').write_text(json.dumps(metadata, indent=2) + '\n', encoding='utf-8')
print(json.dumps(metadata, indent=2))

"""Create a compact, transparent startup mark from the existing brand image."""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
source = root / 'public/logo.png'
target = root / 'public/logo-small.webp'
with Image.open(source) as image:
    image.convert('RGBA').resize((128, 128), Image.Resampling.LANCZOS).save(
        target, 'WEBP', lossless=True, method=6, exact=True)
print(f'{source.name}: {source.stat().st_size} bytes -> {target.name}: {target.stat().st_size} bytes (128x128, lossless WebP)')

"""Decode every static public step QR and verify its exact URL and file digest.

Requires Pillow and zxing-cpp==3.1.1. Outputs a portable verification receipt.
"""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import sys
from PIL import Image
import zxingcpp

root = Path(__file__).resolve().parents[1]
directory = root / 'public/competition'
catalog = json.loads((directory / 'experience-step-qr.json').read_text(encoding='utf-8'))
assert [row['step'] for row in catalog['records']] == list(range(8))
checks = []
for row in catalog['records']:
    file = directory / row['file']
    data = file.read_bytes()
    assert hashlib.sha256(data).hexdigest() == row['sha256']
    assert len(data) == row['bytes']
    with Image.open(file) as image:
        assert image.size == (768, 768)
        results = zxingcpp.read_barcodes(image)
    expected = f"{catalog['origin']}/experience?step={row['step']}"
    assert len(results) == 1 and results[0].text == row['url'] == expected
    checks.append({'step': row['step'], 'url': row['url'], 'file': row['file'], 'bytes': len(data), 'sha256': row['sha256'], 'ok': True})
report = {'checkedAt': datetime.now(timezone.utc).isoformat(), 'decoder': 'zxing-cpp 3.1.1',
          'origin': catalog['origin'], 'checks': checks, 'ok': True,
          'scope': 'Full PNG bytes and decoded public step URLs; local algorithm verification.'}
output = Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'work/experience-qr-verification.json'
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'ok': True, 'qrFiles': len(checks), 'totalBytes': sum(row['bytes'] for row in checks)}))

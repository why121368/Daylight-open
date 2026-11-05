"""Package the reviewed English figure and carry forward incremental API usage."""
from pathlib import Path
from PIL import Image
import hashlib
import json
import shutil

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / 'docs/competition-continuity-2026-11-04'
sha = lambda file: hashlib.sha256(file.read_bytes()).hexdigest()
(DOC / 'assets').mkdir(exist_ok=True)
(DOC / 'evidence').mkdir(exist_ok=True)
original = DOC / 'assets/continuity-generated.png'
shutil.copy2(ROOT / 'output/imagegen/experience-continuity-20261104.png', original)
final = DOC / 'assets/continuity.webp'
with Image.open(original) as image:
    image.save(final, 'WEBP', quality=88, method=6)
record = {
    'model': 'gpt-image-2.5', 'tool': 'imagegen bundled CLI', 'language': 'English',
    'size': '1536x1024', 'quality': 'high', 'calls': 1, 'previousImageCalls': 13, 'totalImageCalls': 14,
    'prompt': 'continuity-prompt.txt', 'promptSha256': sha(DOC / 'continuity-prompt.txt'),
    'generated': {'file': original.relative_to(DOC).as_posix(), 'bytes': original.stat().st_size, 'sha256': sha(original)},
    'final': {'file': final.relative_to(DOC).as_posix(), 'bytes': final.stat().st_size, 'sha256': sha(final)},
    'postprocess': 'Pillow WebP quality 88, method 6; generated lettering and arrows retained.',
    'review': 'English spelling, exact step URL, replay direction and both refresh/return and phone branches checked.',
    'billing': 'Supplier invoice; API returned no billable amount.',
}
(DOC / 'image-generation.json').write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
previous = ROOT / 'docs/competition-recovery-2026-11-04/evidence/budget-total.json'
budget = json.loads(previous.read_text(encoding='utf-8'))
budget.update({'imageCalls': 14, 'newImageCalls': 1, 'newTextModelCalls': 0, 'newCloudPurchasesCny': 0,
               'previousBudgetPath': previous.relative_to(ROOT).as_posix(), 'previousBudgetSha256': sha(previous)})
(DOC / 'evidence/budget-total.json').write_text(json.dumps(budget, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'imageBytes': final.stat().st_size, 'imageCalls': 14, 'modelCalls': budget['modelCalls']}))

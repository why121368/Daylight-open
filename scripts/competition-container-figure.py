"""Archive the reviewed API figure, WebP and incremental budget ledger."""
from pathlib import Path
from PIL import Image
import hashlib
import json
import shutil

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT/'docs/competition-container-2026-11-04'
sha = lambda file: hashlib.sha256(file.read_bytes()).hexdigest()
(DOC/'assets').mkdir(exist_ok=True)
(DOC/'evidence').mkdir(exist_ok=True)
original = DOC/'assets/container-generated.png'
shutil.copy2(ROOT/'output/imagegen/container-source-20261104.png', original)
final = DOC/'assets/container.webp'
with Image.open(original) as figure:
    figure.save(final, 'WEBP', quality=88, method=6)
record = {
    'model':'gpt-image-2.5','tool':'imagegen bundled CLI','language':'English',
    'size':'1536x1024','quality':'high','calls':1,'previousImageCalls':15,'totalImageCalls':16,
    'prompt':'container-prompt.txt','promptSha256':sha(DOC/'container-prompt.txt'),
    'generated':{'file':original.relative_to(DOC).as_posix(),'bytes':original.stat().st_size,'sha256':sha(original)},
    'final':{'file':final.relative_to(DOC).as_posix(),'bytes':final.stat().st_size,'sha256':sha(final)},
    'postprocess':'Pillow WebP quality 88, method 6; generated lettering and arrows retained.',
    'review':'English labels, five-box order, failure boundary and consistency feedback arrow checked against the prompt.',
    'billing':'Supplier invoice; API returned no billable amount.',
}
(DOC/'image-generation.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
previous = ROOT/'docs/competition-delivery-2026-11-04/evidence/budget-total.json'
budget = json.loads(previous.read_text(encoding='utf-8'))
budget.update({'imageCalls':16,'newImageCalls':1,'newTextModelCalls':0,'newCloudPurchasesCny':0,
               'previousBudgetPath':previous.relative_to(ROOT).as_posix(),'previousBudgetSha256':sha(previous)})
(DOC/'evidence/budget-total.json').write_text(json.dumps(budget,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'imageBytes':final.stat().st_size,'imageCalls':16,'textCalls':budget['modelCalls']}))

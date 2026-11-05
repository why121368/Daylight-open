"""Compress the reviewed image and record its prompt and incremental usage."""
from pathlib import Path
from PIL import Image
import hashlib,json
ROOT=Path(__file__).resolve().parents[1]
DOC=ROOT/'docs/competition-recovery-2026-11-04'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
original=DOC/'assets/recovery-flow-generated.png';final=DOC/'assets/recovery-flow.webp'
Image.open(original).save(final,'WEBP',quality=88,method=6)
record={'model':'gpt-image-2.5','tool':'imagegen bundled CLI','language':'English','size':'1536x1024','quality':'high','calls':1,'previousImageCalls':12,'totalImageCalls':13,'prompt':'recovery-prompt.txt','promptSha256':sha(DOC/'recovery-prompt.txt'),'generated':{'file':original.relative_to(DOC).as_posix(),'bytes':original.stat().st_size,'sha256':sha(original)},'final':{'file':final.relative_to(DOC).as_posix(),'bytes':final.stat().st_size,'sha256':sha(final)},'postprocess':'Pillow WebP quality 88, method 6; generated lettering and arrows retained.','review':'English lettering checked. Backup archive feeds Import data; Fresh project is its preceding prerequisite.','billing':'Supplier invoice; API returned no billable amount.','localPreflight':'System Python SDK import failed before an API request; bundled Python completed the one generation call.'}
(DOC/'image-generation.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
previous=ROOT/'docs/competition-entry-2026-11-04/evidence/budget-total.json'
budget=json.loads(previous.read_text());budget.update({'imageCalls':13,'newImageCalls':1,'newTextModelCalls':0,'newCloudPurchasesCny':0,'previousBudgetPath':previous.relative_to(ROOT).as_posix(),'previousBudgetSha256':sha(previous),'imageModel':'gpt-image-2.5'})
(DOC/'evidence').mkdir(exist_ok=True)
(DOC/'evidence/budget-total.json').write_text(json.dumps(budget,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'webpBytes':final.stat().st_size,'images':13,'modelCalls':budget['modelCalls'],'estimatedModelCny':budget['estimatedModelCny']}))

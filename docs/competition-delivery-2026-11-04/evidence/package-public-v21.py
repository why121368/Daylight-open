from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import os
import shutil
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[2]
if os.name == 'nt': ROOT = Path('\\\\?\\' + str(ROOT))
WORK = ROOT / 'work/delivery-v21'
stage = WORK / 'package-public'
assert not subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip()
stage.mkdir()
commit = subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
shutil.copytree(ROOT / 'dist',stage / 'dist')
checks = ['package.json','scripts/verify-competition.mjs','scripts/verify-competition-resources.py',
          'scripts/bundle-release.mjs','scripts/verify-release.mjs','scripts/demo.mjs','scripts/verify-delivery.mjs',
          'scripts/lib/delivery-integrity.mjs','scripts/lib/release-inventory.mjs','server/delivery-integrity.test.js']
for name in checks:
    (stage/name).parent.mkdir(parents=True,exist_ok=True)
    shutil.copy2(ROOT/name,stage/name)
hashes = {p.relative_to(stage).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(stage.rglob('*')) if p.is_file()}
digests = json.loads(subprocess.check_output(['node','--input-type=module','-e',
    "import {sourceDigest,treeDigest} from './scripts/lib/release-inventory.mjs';console.log(JSON.stringify({source:sourceDigest(process.cwd()),build:treeDigest('dist')}));"],cwd=ROOT,text=True))
manifest = {'createdAt':datetime.now(timezone.utc).isoformat(),
    'scope':'Portable delivery verification scripts, clean installation evidence and updated technical/reproduction pages; complete frontend replacement',
    'baseImage':'daylight:public-competition-20261104-v20',
    'baseImageId':'sha256:512a096ec1d021b77a27143b0deb67d7e8d354063cd26922ab23572a41dc6add',
    'targetImage':'daylight:public-competition-20261104-v21',
    'sourceCommit':commit,'backendSourceCommit':'a8daafc1bf88c747fb1e6104a89c56a6f90ff06b',
    'parentBackendSourceCommit':'9354287b56e670a4a3f1376a68f325df2beadcf9',
    'baseBackendSourceCommit':'db3ee897a696bf5f70365f8c901237f020cf8691',
    'portableDeliverySourceCommit':'fc3ae1de6002bc56d1b4ca2038097862e62e40fe',
    'runtimeFiles':[],'verificationFiles':checks,'sourceDigest':digests['source'],'buildDigest':digests['build'],'hashes':hashes}
content = json.dumps(manifest,ensure_ascii=False,indent=2)+'\n'
(stage/'release-manifest.json').write_text(content,encoding='utf-8')
(ROOT/'docs/competition-delivery-2026-11-04/evidence/release-v21-manifest.json').write_text(content,encoding='utf-8')
archive = WORK/'public-release.tar.gz'
with tarfile.open(archive,'w:gz') as tar:
    for p in sorted(stage.iterdir()):tar.add(p,arcname=p.name)
sha = hashlib.sha256(archive.read_bytes()).hexdigest()
remote = '/opt/daylight-delivery-release-v21'
request = {'upload':[['work/delivery-v21/public-release.tar.gz',remote+'/release.tar.gz'],['work/delivery-v21/deploy.sh',remote+'/deploy.sh']],
    'command':f'cd {remote} && echo "{sha}  release.tar.gz" | sha256sum -c - && sh deploy.sh',
    'download':[[remote+'/'+name,'work/delivery-v21/'+name] for name in ['candidate-production-tests.txt','candidate-delivery-tests.txt','candidate-delivery-checks.json']]}
(WORK/'deploy-request.json').write_text(json.dumps(request),encoding='utf-8')
result = {'files':len(hashes),'completeDistFiles':len([n for n in hashes if n.startswith('dist/')]),
    'bytes':archive.stat().st_size,'archiveSha256':sha,'sourceCommit':commit,'portableDeliverySourceCommit':manifest['portableDeliverySourceCommit']}
(ROOT/'docs/competition-delivery-2026-11-04/evidence/release-v21-archive.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result))

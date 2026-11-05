from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import os
import shutil
import subprocess
import tarfile

ROOT=Path(__file__).resolve().parents[2]
if os.name=='nt': ROOT=Path('\\\\?\\'+str(ROOT))
WORK=ROOT/'work/container-source-20261104'
stage=WORK/'package-public-v22';stage.mkdir()
assert not subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip()
commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
gate=json.loads((ROOT/'work/release-check-srt34g/summary.json').read_text(encoding='utf-8'))
assert gate['ok'] and not gate['dirty'] and gate['sourceCommit']==commit
shutil.copytree(ROOT/'dist',stage/'dist')
checks=['package.json','scripts/verify-competition.mjs','scripts/verify-competition-resources.py',
        'scripts/deploy-check.mjs','scripts/sync-competition-evidence.mjs',
        'scripts/lib/competition-evidence.mjs','scripts/lib/frontend-inputs.mjs','scripts/fixtures/offline-guard.cjs',
        'server/container-source.test.js','server/offline-guard-native.test.js']
for name in checks:
    (stage/name).parent.mkdir(parents=True,exist_ok=True);shutil.copy2(ROOT/name,stage/name)
hashes={p.relative_to(stage).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(stage.rglob('*')) if p.is_file()}
digests=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import {sourceDigest,treeDigest} from './scripts/lib/release-inventory.mjs';console.log(JSON.stringify({source:sourceDigest(process.cwd()),build:treeDigest('dist')}));"],cwd=ROOT,text=True))
assert gate['sourceDigest']==digests['source'] and gate['buildDigest']==digests['build']
manifest={'createdAt':datetime.now(timezone.utc).isoformat(),
    'scope':'Source-container reproducibility tooling, English report, latest public evidence snapshot and complete frontend replacement',
    'baseImage':'daylight:public-competition-20261104-v21',
    'baseImageId':'sha256:55f7a1780e8e8766e2b9a449b8804b333d93c578621cc0a573c9736044bc9dc2',
    'targetImage':'daylight:public-competition-20261104-v22','sourceCommit':commit,
    'backendSourceCommit':'a8daafc1bf88c747fb1e6104a89c56a6f90ff06b',
    'parentBackendSourceCommit':'9354287b56e670a4a3f1376a68f325df2beadcf9',
    'baseBackendSourceCommit':'db3ee897a696bf5f70365f8c901237f020cf8691',
    'runtimeFiles':[],'verificationFiles':checks,'sourceDigest':digests['source'],'buildDigest':digests['build'],'hashes':hashes}
(stage/'release-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
archive=WORK/'public-release-v22.tar.gz'
with tarfile.open(archive,'w:gz') as tar:
    for p in sorted(stage.iterdir()):tar.add(p,arcname=p.name)
sha=hashlib.sha256(archive.read_bytes()).hexdigest();remote='/opt/daylight-container-release-v22'
request={'upload':[['work/container-source-20261104/public-release-v22.tar.gz',remote+'/release.tar.gz'],['work/container-source-20261104/deploy-v22.sh',remote+'/deploy.sh']],
    'command':f'cd {remote} && echo "{sha}  release.tar.gz" | sha256sum -c - && sh deploy.sh',
    'download':[[remote+'/'+name,'work/container-source-20261104/'+name] for name in ['candidate-production-tests.txt','candidate-delivery-tests.txt','candidate-source-tests.txt','candidate-container-checks.json']]}
(WORK/'deploy-request.json').write_text(json.dumps(request),encoding='utf-8')
result={'sourceCommit':commit,'files':len(hashes),'completeDistFiles':len([n for n in hashes if n.startswith('dist/')]),'archiveBytes':archive.stat().st_size,'archiveSha256':sha}
(WORK/'release-v22-archive.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result))

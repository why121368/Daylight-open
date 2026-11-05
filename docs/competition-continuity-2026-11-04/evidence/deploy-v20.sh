#!/bin/sh
set -eu
umask 077
cd /opt/daylight
exec 9>/opt/daylight/.competition-deploy.lock
flock -n 9
build=/opt/daylight-continuity-release-v20
base=daylight:public-competition-20261104-v19
base_id=sha256:2689195d2f2d4c7e346c590a9834784c6e332a9568e18658b573f7cba6ecd982
image=daylight:public-competition-20261104-v20
verification_files='scripts/verify-competition.mjs shared/experience-progress.js shared/experience-fixtures.js server/experience-progress.test.js'
for role in api worker scheduler; do
  test "$(docker inspect "daylight-$role-1" --format '{{.Config.Image}}')" = "$base"
  test "$(docker inspect "daylight-$role-1" --format '{{.Image}}')" = "$base_id"
done
if docker image inspect "$image" >/dev/null 2>&1; then echo TARGET_IMAGE_ALREADY_EXISTS; exit 1; fi
backup=/opt/daylight-backups/before-experience-download-$(date +%Y%m%d%H%M%S)
mkdir -p "$backup/runtime/scripts" "$backup/runtime/shared" "$backup/runtime/server"
cp deploy/compose.env docker-compose.yml compose.lowmem.yml compose.https.yml manage.sh "$backup/"
for file in $verification_files; do if [ -f "$file" ]; then cp "$file" "$backup/runtime/$file"; fi; done
./manage.sh exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup/database.dump"
./manage.sh exec -T postgres pg_restore --list < "$backup/database.dump" > "$backup/database-toc.txt"
test -s "$backup/database-toc.txt"
docker cp daylight-api-1:/app/dist "$backup/dist"
printf '%s\n%s\n' "$base" "$base_id" > "$backup/previous-image.txt"
printf 'BACKUP=%s\n' "$backup"
cd "$build"
python3 - <<'PY'
import tarfile
from pathlib import PurePosixPath
with tarfile.open('release.tar.gz') as tar:
    for entry in tar.getmembers():
        p=PurePosixPath(entry.name)
        assert not p.is_absolute() and '..' not in p.parts
        assert entry.isfile() or entry.isdir()
        assert entry.name=='release-manifest.json' or p.parts[0] in ['dist','scripts','shared','server']
PY
tar -xzf release.tar.gz
python3 - <<'PY'
import hashlib,json
from pathlib import Path
m=json.loads(Path('release-manifest.json').read_text())
assert m['baseImage']=='daylight:public-competition-20261104-v19'
assert m['baseImageId']=='sha256:2689195d2f2d4c7e346c590a9834784c6e332a9568e18658b573f7cba6ecd982'
assert len(m['sourceCommit'])==40 and m['runtimeFiles']==[]
assert m['verificationFiles']==['scripts/verify-competition.mjs', 'shared/experience-progress.js', 'shared/experience-fixtures.js', 'server/experience-progress.test.js']
for name,digest in m['hashes'].items():
    assert name.startswith('dist/') or name in m['verificationFiles']
    assert hashlib.sha256(Path(name).read_bytes()).hexdigest()==digest,name
assert {p.as_posix() for p in Path('dist').rglob('*') if p.is_file()}=={n for n in m['hashes'] if n.startswith('dist/')}
Path('Dockerfile').write_text('FROM '+m['baseImageId']+'\nUSER root\nRUN rm -rf /app/dist\nCOPY --chown=node:node scripts/ /app/scripts/\nCOPY --chown=node:node shared/ /app/shared/\nCOPY --chown=node:node server/ /app/server/\nCOPY --chown=node:node dist/ /app/dist/\nLABEL org.opencontainers.image.revision="'+m['sourceCommit']+'"\nUSER node\n')
print('RELEASE_HASHES_OK',len(m['hashes']))
PY
docker build --network=none -t "$image" .
docker run --rm --network=none --memory=512m --cpus=1 --tmpfs /tmp:uid=1000,gid=1000,mode=1777,size=134217728 -e DAYLIGHT_RUNTIME=production --entrypoint node "$image" --test --test-concurrency=1 /app/server/metrics.test.js /app/server/metrics-bounds.test.js /app/server/service-health.test.js /app/server/experience.test.js /app/server/experience-progress.test.js > candidate-production-tests.txt
tail -n 9 candidate-production-tests.txt
docker run --rm -i --network=none --entrypoint node "$image" --input-type=module <<'NODE' > candidate-continuity-checks.json
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const base='/app/dist/competition/';
const read=name=>fs.readFileSync(base+name);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const s=JSON.parse(read('continuity-assets/evidence/bundle-summary.json'));
const inventory=JSON.parse(read('continuity-assets/evidence/bundle-inventory.json'));
const behavior=JSON.parse(read('continuity-assets/evidence/local-behavior.json'));
const finalBehavior=JSON.parse(read('continuity-assets/evidence/final-build-behavior.json'));
const layouts=JSON.parse(read('continuity-assets/evidence/local-layouts.json'));
const qr=JSON.parse(read('continuity-assets/evidence/local-qr-verification.json'));
const qrCatalog=JSON.parse(read('experience-step-qr.json'));
const staticQr=JSON.parse(read('continuity-assets/evidence/static-qr-verification.json'));
const downloadLayouts=JSON.parse(read('continuity-assets/evidence/local-layouts-v20.json'));
assert.equal(qrCatalog.origin,'https://daylight.yunforis.com');
assert.deepEqual(qrCatalog.records.map(row=>row.step),[0,1,2,3,4,5,6,7]);
assert.equal(staticQr.ok,true);assert.equal(staticQr.checks.length,8);
assert.equal(downloadLayouts.length,3);assert.deepEqual(downloadLayouts.map(row=>row.viewport.width),[1440,390,320]);
assert.ok(downloadLayouts.every(row=>row.ok && row.downloadIsAnchor));
for(const row of qrCatalog.records){assert.equal(row.url,`${qrCatalog.origin}/experience?step=${row.step}`);assert.equal(sha(read(row.file)),row.sha256);assert.equal(read(row.file).length,row.bytes);assert.equal(staticQr.checks[row.step].sha256,row.sha256);}
const budget=JSON.parse(read('continuity-assets/evidence/budget-total.json'));
const image=JSON.parse(read('continuity-assets/image-generation.json'));
assert.equal(behavior.length,15);assert.ok(behavior.every(row=>row.ok));
assert.equal(layouts.length,3);assert.ok(layouts.every(row=>row.ok));
assert.equal(finalBehavior.ok,true);assert.equal(finalBehavior.step,'3');assert.equal(finalBehavior.focusedResult,true);
assert.equal(qr.ok,true);assert.equal(qr.text,'http://127.0.0.1:3202/experience?step=3');
assert.equal(s.qrcodeExcludedFromInitialExperience,true);assert.equal(s.initialJavaScriptAddedGzipBytes,1614);
assert.equal(s.initialExperienceJavaScript.gzipBytes,167601);assert.equal(s.deferredShare.gzipBytes,17091);
assert.equal(sha(read('continuity-assets/evidence/bundle-inventory.json')),s.inventorySha256);
for(const [file,asset] of Object.entries(inventory.assets))assert.equal(sha(fs.readFileSync('/app/dist/'+file)),asset.sha256,file);
assert.ok(fs.readFileSync('/app/dist/index.html','utf8').includes('/'+inventory.entry));
const eager=new Set(s.initialExperienceJavaScript.files);assert.ok(s.qrcodeChunks.every(file=>!eager.has(file)));
assert.equal(image.model,'gpt-image-2.5');assert.equal(image.totalImageCalls,14);
assert.equal(sha(read('continuity-assets/assets/continuity.webp')),image.final.sha256);
assert.equal(budget.modelCalls,84);assert.equal(budget.estimatedModelCny,.516094);assert.equal(budget.imageCalls,14);
const pdf=JSON.parse(read('submission-assets/evidence/report-manifest.json'));
assert.equal(sha(read('technical-report.pdf')),pdf.pdfSha256);
assert.ok(read('technical-report.html').toString().includes('/competition/continuity-report.html'));
assert.ok(read('budget.html').toString().includes('图片 14 次'));
console.log(JSON.stringify({ok:true,behaviorChecks:15,layouts:3,qrDecoded:true,staticQrFiles:8,downloadLayouts:3,downloadIsAnchor:true,finalResultFocused:true,assetFilesVerified:Object.keys(inventory.assets).length,entry:inventory.entry,initialJavaScriptGzipBytes:167601,deferredShareJavaScriptGzipBytes:17091,cumulativeModelCalls:84,cumulativeEstimatedCny:budget.estimatedModelCny,imageModel:image.model,imageCalls:14,pdfSha256:pdf.pdfSha256},null,2));
NODE
cat candidate-continuity-checks.json
cp -a dist host-dist
cd /opt/daylight
for role in api worker scheduler; do test "$(docker inspect "daylight-$role-1" --format '{{.Image}}')" = "$base_id"; done
changed=0
rollback() {
  code=$?
  trap - EXIT
  if [ "$code" -ne 0 ] && [ "$changed" -eq 1 ]; then
    cp "$backup/compose.env" deploy/compose.env
    ./manage.sh up -d --no-deps --no-build --pull never --wait --wait-timeout 180 api worker scheduler
    if [ -d "$backup/host-dist" ]; then
      if [ -d dist ]; then mv dist "$build/failed-host-dist"; fi
      mv "$backup/host-dist" dist
    fi
    for file in $verification_files; do if [ -f "$backup/runtime/$file" ]; then cp "$backup/runtime/$file" "$file"; else rm -f "$file"; fi; done
    echo ROLLED_BACK_IMAGE
  fi
  exit "$code"
}
trap rollback EXIT
changed=1
python3 - <<'PY'
from pathlib import Path
import json
m=json.loads(Path('/opt/daylight-continuity-release-v20/release-manifest.json').read_text())
p=Path('deploy/compose.env');lines=p.read_text().splitlines()
assert 'DAYLIGHT_METRICS=1' in lines
for key,value in {'DAYLIGHT_IMAGE':m['targetImage'],'DAYLIGHT_GIT_SHA':m['sourceCommit'],'DAYLIGHT_GIT_DIRTY':'0'}.items():
    positions=[i for i,line in enumerate(lines) if line.startswith(key+'=')]
    assert len(positions)==1
    lines[positions[0]]=key+'='+value
p.write_text('\n'.join(lines)+'\n')
PY
./manage.sh up -d --no-deps --no-build --pull never --wait --wait-timeout 180 api worker scheduler
curl -fsS --max-time 30 https://daylight.yunforis.com/health/ready
./manage.sh exec -T api node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
const origin='http://127.0.0.1:3000';
const j=await(await fetch(origin+'/api/experience?step=7')).json();
assert.deepEqual(j.steps.map(s=>s.status),['completed','conflict','completed','duplicate','failed','completed','completed']);
assert.equal(j.modelCalls,0);assert.equal(j.persisted,false);
for(const path of ['/api/state','/api/study/config','/api/assistant/drafts'])assert.equal((await fetch(origin+path)).status,401,path);
for(const path of ['/experience','/evidence','/demo','/competition/video-report.html','/competition/demo-transcript.html','/competition/reply-release-v13.html','/competition/report-refresh.html','/competition/video-release-v14.html','/competition/entry-report.html','/competition/continuity-report.html','/experience?step=3','/competition/recovery-release-v18.html','/logo-small.webp'])assert.equal((await fetch(origin+path)).status,200,path);
for(const file of ['demo-zh.vtt','demo-chapters.vtt']){const r=await fetch(origin+'/competition/'+file);assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/text\/vtt/);}
const r=await fetch(origin+'/competition/demo.mp4',{headers:{Range:'bytes=0-31'}});assert.equal(r.status,206);assert.match(r.headers.get('content-type'),/video\/mp4/);
console.log('PUBLIC_BUSINESS_AND_VIDEO_EVIDENCE_OK');
NODE
for role in api worker scheduler; do
  ./manage.sh exec -T "$role" node --input-type=module - "$role" <<'NODE'
import assert from 'node:assert/strict';
const role=process.argv[2];
const j=await(await fetch('http://127.0.0.1:'+(role==='api'?3000:3001)+'/health/ready')).json();
assert.equal(j.role,role);assert.equal(j.ok,true);
assert.equal(j.metrics.enabled,true);assert.equal(j.metrics.dropped,0);assert.equal(j.metrics.sinkError,null);assert.ok(j.metrics.written>0);
console.log('ROLE_READY',role,JSON.stringify(j.metrics));
NODE
done
mv dist "$backup/host-dist"
mv "$build/host-dist" dist
for file in $verification_files; do cp "$build/$file" "$file"; done
docker inspect daylight-api-1 daylight-worker-1 daylight-scheduler-1 --format '{{.Name}} {{.Config.Image}} {{.State.Health.Status}} restart={{.RestartCount}} oom={{.State.OOMKilled}}'
docker image inspect "$image" --format '{{.Id}}'
./manage.sh ps --format json | python3 -c 'import sys,json; rows=[json.loads(line) for line in sys.stdin if line.strip()]; print("SERVICE_HEALTH",[(r["Service"],r.get("Health"),r.get("State")) for r in rows])'
printf 'PUBLIC_CONTINUITY_DOWNLOAD_PUBLISHED_OK\nBACKUP=%s\n' "$backup"

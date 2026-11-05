#!/bin/sh
set -eu
umask 077
cd /opt/daylight
exec 9>/opt/daylight/.competition-deploy.lock
flock -n 9
build=/opt/daylight-entry-release-v17
base=daylight:public-competition-20261104-v16
base_id=sha256:0bca96d41fe1ef666cc1c3f26eb1200854f3ca473463653960357067876a46b3
image=daylight:public-competition-20261104-v17
verification_files='scripts/verify-competition.mjs'
for role in api worker scheduler; do
  test "$(docker inspect "daylight-$role-1" --format '{{.Config.Image}}')" = "$base"
  test "$(docker inspect "daylight-$role-1" --format '{{.Image}}')" = "$base_id"
done
if docker image inspect "$image" >/dev/null 2>&1; then echo TARGET_IMAGE_ALREADY_EXISTS; exit 1; fi
backup=/opt/daylight-backups/before-public-entry-$(date +%Y%m%d%H%M%S)
mkdir -p "$backup/runtime/scripts"
cp deploy/compose.env docker-compose.yml compose.lowmem.yml compose.https.yml manage.sh "$backup/"
for file in $verification_files; do cp "$file" "$backup/runtime/$file"; done
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
        assert entry.name=='release-manifest.json' or p.parts[0] in ['dist','scripts']
PY
tar -xzf release.tar.gz
python3 - <<'PY'
import hashlib,json
from pathlib import Path
m=json.loads(Path('release-manifest.json').read_text())
assert m['baseImage']=='daylight:public-competition-20261104-v16'
assert m['baseImageId']=='sha256:0bca96d41fe1ef666cc1c3f26eb1200854f3ca473463653960357067876a46b3'
assert len(m['sourceCommit'])==40 and m['runtimeFiles']==[]
assert m['verificationFiles']==['scripts/verify-competition.mjs']
for name,digest in m['hashes'].items():
    assert name.startswith('dist/') or name in m['verificationFiles']
    assert hashlib.sha256(Path(name).read_bytes()).hexdigest()==digest,name
assert {p.as_posix() for p in Path('dist').rglob('*') if p.is_file()}=={n for n in m['hashes'] if n.startswith('dist/')}
Path('Dockerfile').write_text('FROM '+m['baseImageId']+'\nUSER root\nRUN rm -rf /app/dist\nCOPY --chown=node:node scripts/ /app/scripts/\nCOPY --chown=node:node dist/ /app/dist/\nLABEL org.opencontainers.image.revision="'+m['sourceCommit']+'"\nUSER node\n')
print('RELEASE_HASHES_OK',len(m['hashes']))
PY
docker build --network=none -t "$image" .
docker run --rm --network=none --memory=512m --cpus=1 --tmpfs /tmp:uid=1000,gid=1000,mode=1777,size=134217728 -e DAYLIGHT_RUNTIME=production --entrypoint node "$image" --test --test-concurrency=1 /app/server/metrics.test.js /app/server/metrics-bounds.test.js /app/server/service-health.test.js /app/server/experience.test.js > candidate-production-tests.txt
tail -n 9 candidate-production-tests.txt
docker run --rm -i --network=none --entrypoint node "$image" --input-type=module <<'NODE' > candidate-entry-checks.json
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const base='/app/dist/competition/';
const read=name=>fs.readFileSync(base+name);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const s=JSON.parse(read('entry-assets/evidence/summary.json'));
const inventory=JSON.parse(read('entry-assets/evidence/bundle-after.json'));
const samples=JSON.parse(read('entry-assets/evidence/browser-samples.json'));
const budget=JSON.parse(read('entry-assets/evidence/budget-total.json'));
const image=JSON.parse(read('entry-assets/image-generation.json'));
assert.equal(samples.length,20);assert.ok(samples.every(r=>r.ok));
assert.equal(s.bundle.reductions.combinedGzipJsCssAndBootImagePercent,44.11);
assert.equal(s.bundle.after.experienceJavaScript.gzipBytes,165987);
assert.ok(Object.values(s.bundle.after.excludedPublicModules).every(Boolean));
assert.equal(sha(read('entry-assets/evidence/bundle-after.json')),s.hashes.afterInventory);
assert.equal(sha(read('entry-assets/evidence/browser-samples.json')),s.hashes.browserSamples);
for(const [file,asset] of Object.entries(inventory.assets))assert.equal(sha(fs.readFileSync('/app/dist/'+file)),asset.sha256,file);
assert.ok(fs.readFileSync('/app/dist/index.html','utf8').includes('/'+inventory.entry));
assert.equal(fs.readFileSync('/app/dist/logo-small.webp').length,8278);
assert.equal(sha(read('entry-assets/assets/entry-loading.webp')),image.final.sha256);
assert.equal(image.model,'gpt-image-2.5');assert.equal(image.totalImageCalls,12);
assert.equal(budget.modelCalls,84);assert.equal(budget.estimatedModelCny,.516094);
const pdf=JSON.parse(read('submission-assets/evidence/report-manifest.json'));
assert.equal(sha(read('technical-report.pdf')),pdf.pdfSha256);
assert.ok(read('technical-report.html').toString().includes('/competition/entry-report.html'));
assert.ok(read('budget.html').toString().includes('图片 12 次'));
console.log(JSON.stringify({ok:true,samples:20,assetFilesVerified:Object.keys(inventory.assets).length,entry:inventory.entry,jsGzipBytes:165987,combinedBytesReductionPercent:44.11,cumulativeModelCalls:84,cumulativeEstimatedCny:budget.estimatedModelCny,imageModel:image.model,imageCalls:12,pdfSha256:pdf.pdfSha256},null,2));
NODE
cat candidate-entry-checks.json
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
    for file in $verification_files; do cp "$backup/runtime/$file" "$file"; done
    echo ROLLED_BACK_IMAGE
  fi
  exit "$code"
}
trap rollback EXIT
changed=1
python3 - <<'PY'
from pathlib import Path
import json
m=json.loads(Path('/opt/daylight-entry-release-v17/release-manifest.json').read_text())
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
for(const path of ['/experience','/evidence','/demo','/competition/video-report.html','/competition/demo-transcript.html','/competition/reply-release-v13.html','/competition/report-refresh.html','/competition/video-release-v14.html','/competition/entry-report.html','/logo-small.webp'])assert.equal((await fetch(origin+path)).status,200,path);
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
printf 'PUBLIC_ENTRY_PUBLISHED_OK\nBACKUP=%s\n' "$backup"

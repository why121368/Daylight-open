#!/bin/sh
set -eu
umask 077
cd /opt/daylight
exec 9>/opt/daylight/.competition-deploy.lock
flock -n 9
build=/opt/daylight-delivery-release-v21
base=daylight:public-competition-20261104-v20
base_id=sha256:512a096ec1d021b77a27143b0deb67d7e8d354063cd26922ab23572a41dc6add
image=daylight:public-competition-20261104-v21
verification_files='package.json scripts/verify-competition.mjs scripts/verify-competition-resources.py scripts/bundle-release.mjs scripts/verify-release.mjs scripts/demo.mjs scripts/verify-delivery.mjs scripts/lib/delivery-integrity.mjs scripts/lib/release-inventory.mjs server/delivery-integrity.test.js'
for role in api worker scheduler; do
  test "$(docker inspect "daylight-$role-1" --format '{{.Config.Image}}')" = "$base"
  test "$(docker inspect "daylight-$role-1" --format '{{.Image}}')" = "$base_id"
done
if docker image inspect "$image" >/dev/null 2>&1; then echo TARGET_IMAGE_ALREADY_EXISTS; exit 1; fi
backup=/opt/daylight-backups/before-portable-delivery-$(date +%Y%m%d%H%M%S)
mkdir -p "$backup/runtime/scripts/lib" "$backup/runtime/shared" "$backup/runtime/server"
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
        assert entry.name=='release-manifest.json' or entry.name=='package.json' or p.parts[0] in ['dist','scripts','shared','server']
PY
tar -xzf release.tar.gz
python3 - <<'PY'
import hashlib,json
from pathlib import Path
import tarfile
m=json.loads(Path('release-manifest.json').read_text())
assert m['baseImage']=='daylight:public-competition-20261104-v20'
assert m['baseImageId']=='sha256:512a096ec1d021b77a27143b0deb67d7e8d354063cd26922ab23572a41dc6add'
assert len(m['sourceCommit'])==40 and m['runtimeFiles']==[]
assert m['verificationFiles']==['package.json', 'scripts/verify-competition.mjs', 'scripts/verify-competition-resources.py', 'scripts/bundle-release.mjs', 'scripts/verify-release.mjs', 'scripts/demo.mjs', 'scripts/verify-delivery.mjs', 'scripts/lib/delivery-integrity.mjs', 'scripts/lib/release-inventory.mjs', 'server/delivery-integrity.test.js']
with tarfile.open('release.tar.gz') as tar:
    assert {e.name for e in tar.getmembers() if e.isfile()}==set(m['hashes'])|{'release-manifest.json'}
for name,digest in m['hashes'].items():
    assert name.startswith('dist/') or name in m['verificationFiles']
    assert hashlib.sha256(Path(name).read_bytes()).hexdigest()==digest,name
assert {p.as_posix() for p in Path('dist').rglob('*') if p.is_file()}=={n for n in m['hashes'] if n.startswith('dist/')}
Path('Dockerfile').write_text('FROM '+m['baseImageId']+'\nUSER root\nRUN rm -rf /app/dist\nCOPY --chown=node:node scripts/ /app/scripts/\nCOPY --chown=node:node package.json /app/package.json\nCOPY --chown=node:node server/ /app/server/\nCOPY --chown=node:node dist/ /app/dist/\nLABEL org.opencontainers.image.revision="'+m['sourceCommit']+'"\nUSER node\n')
print('RELEASE_HASHES_OK',len(m['hashes']))
PY
docker build --network=none -t "$image" .
docker run --rm --network=none --memory=512m --cpus=1 --tmpfs /tmp:uid=1000,gid=1000,mode=1777,size=134217728 -e DAYLIGHT_RUNTIME=production --entrypoint node "$image" --test --test-concurrency=1 /app/server/metrics.test.js /app/server/metrics-bounds.test.js /app/server/service-health.test.js /app/server/experience.test.js /app/server/experience-progress.test.js > candidate-production-tests.txt
tail -n 9 candidate-production-tests.txt
docker run --rm --network=none --memory=512m --cpus=1 --workdir /tmp --tmpfs /tmp:uid=1000,gid=1000,mode=1777,size=134217728 --entrypoint node "$image" --test /app/server/delivery-integrity.test.js > candidate-delivery-tests.txt
tail -n 9 candidate-delivery-tests.txt
docker run --rm -i --network=none --entrypoint node "$image" --input-type=module <<'NODE' > candidate-delivery-checks.json
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const base='/app/dist/competition/';
const read=name=>fs.readFileSync(base+name);
const json=name=>JSON.parse(read(name));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const summary=json('delivery-assets/evidence/package-summary.json');
const repro=json('delivery-assets/evidence/reproduction.json');
const browser=json('delivery-assets/evidence/package-browser.json');
const gate=json('delivery-assets/evidence/verification-summary.json');
const image=json('delivery-assets/image-generation.json');
const budget=json('delivery-assets/evidence/budget-total.json');
assert.equal(summary.archive.sourceCommit,'fc3ae1de6002bc56d1b4ca2038097862e62e40fe');
assert.equal(summary.archive.sha256,'46a5570589a94a35fa3542173bedb66d401180b91fec60e267f8b7c3a27dad24');
assert.equal(summary.archive.files,2345);assert.equal(summary.archive.bytes,112500706);
assert.equal(summary.cleanInstallMs,61135);assert.equal(summary.reproduction.demoHttpRequests,24);
assert.equal(summary.cleanCheckout,true);assert.equal(summary.fiveStageVerification,true);
assert.deepEqual(summary.tests,{total:1042,pass:1013,skipped:29,fail:0});
assert.equal(repro.ok,true);assert.equal(repro.emptyNodeModulesBeforeInstall,true);
assert.ok(repro.stages.every(s=>s.exitCode===0));assert.equal(repro.faults.length,4);assert.ok(repro.faults.every(s=>s.detected));
assert.equal(browser.ok,true);assert.equal(browser.checks.length,12);assert.ok(browser.checks.every(s=>s.ok));assert.equal(browser.consoleErrors.length,0);
assert.equal(gate.ok,true);assert.equal(gate.dirty,false);assert.equal(gate.stages.length,5);assert.ok(gate.stages.every(s=>s.code===0));
assert.equal(gate.sourceCommit,summary.archive.sourceCommit);assert.equal(gate.sourceDigest,summary.archive.sourceDigest);assert.equal(gate.buildDigest,summary.archive.buildDigest);
assert.equal(image.model,'gpt-image-2.5');assert.equal(image.totalImageCalls,15);assert.equal(sha(read('delivery-assets/assets/delivery.webp')),image.final.sha256);
assert.equal(budget.modelCalls,84);assert.equal(budget.estimatedModelCny,.516094);assert.equal(budget.imageCalls,15);
assert.ok(read('reproduce.html').toString().includes('node scripts/verify-delivery.mjs .'));
assert.ok(read('technical-report.html').toString().includes('/competition/delivery-report.html'));
assert.ok(read('budget.html').toString().includes('图片 15 次'));
const pkg=JSON.parse(fs.readFileSync('/app/package.json','utf8'));assert.equal(pkg.scripts['release:check'],'node scripts/verify-delivery.mjs');
const pdf=json('submission-assets/evidence/report-manifest.json');assert.equal(sha(read('technical-report.pdf')),pdf.pdfSha256);
console.log(JSON.stringify({ok:true,portableSource:summary.archive.sourceCommit,files:2345,archiveBytes:112500706,cleanInstallMs:61135,tests:summary.tests,
    demoHttpRequests:24,filesFaultsDetected:4,browserChecks:12,imageModel:image.model,imageCalls:15,modelCalls:84,estimatedTextCny:budget.estimatedModelCny},null,2));
NODE
cat candidate-delivery-checks.json
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
m=json.loads(Path('/opt/daylight-delivery-release-v21/release-manifest.json').read_text())
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
for(const path of ['/experience','/evidence','/demo','/competition/video-report.html','/competition/demo-transcript.html','/competition/reply-release-v13.html','/competition/report-refresh.html','/competition/video-release-v14.html','/competition/entry-report.html','/competition/continuity-report.html','/competition/delivery-report.html','/competition/reproduce.html','/experience?step=3','/competition/recovery-release-v18.html','/logo-small.webp'])assert.equal((await fetch(origin+path)).status,200,path);
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
for file in $verification_files; do mkdir -p "$(dirname "$file")"; cp "$build/$file" "$file"; done
docker inspect daylight-api-1 daylight-worker-1 daylight-scheduler-1 --format '{{.Name}} {{.Config.Image}} {{.State.Health.Status}} restart={{.RestartCount}} oom={{.State.OOMKilled}}'
docker image inspect "$image" --format '{{.Id}}'
./manage.sh ps --format json | python3 -c 'import sys,json; rows=[json.loads(line) for line in sys.stdin if line.strip()]; print("SERVICE_HEALTH",[(r["Service"],r.get("Health"),r.get("State")) for r in rows])'
printf 'PUBLIC_PORTABLE_DELIVERY_PUBLISHED_OK\nBACKUP=%s\n' "$backup"

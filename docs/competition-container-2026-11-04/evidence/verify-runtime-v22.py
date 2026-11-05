import datetime,json,subprocess
from pathlib import Path

build=Path('/opt/daylight-container-release-v22')
manifest=json.loads((build/'release-manifest.json').read_text())
previous=json.loads(Path('/opt/daylight-observability-release-v7/release-manifest.json').read_text())
expected={name:digest for name,digest in previous['hashes'].items() if not name.startswith('dist/')}
v9=json.loads(Path('/opt/daylight-rag-release-v9/release-manifest.json').read_text())
expected.update({n:d for n,d in v9['hashes'].items() if not n.startswith('dist/')})
v13=json.loads(Path('/opt/daylight-reply-release-v13/release-manifest.json').read_text())
expected.update({n:d for n,d in v13['hashes'].items() if not n.startswith('dist/')})
v16=json.loads(Path('/opt/daylight-rag-latency-release-v16/release-manifest.json').read_text())
expected.update({n:d for n,d in v16['hashes'].items() if not n.startswith('dist/')})
v18=json.loads(Path('/opt/daylight-recovery-release-v18/release-manifest.json').read_text())
expected.update({n:d for n,d in v18['hashes'].items() if not n.startswith('dist/')})
v19=json.loads(Path('/opt/daylight-continuity-release-v19/release-manifest.json').read_text())
expected.update({n:d for n,d in v19['hashes'].items() if not n.startswith('dist/')})
v20=json.loads(Path('/opt/daylight-continuity-release-v20/release-manifest.json').read_text())
expected.update({n:d for n,d in v20['hashes'].items() if not n.startswith('dist/')})
v21=json.loads(Path('/opt/daylight-delivery-release-v21/release-manifest.json').read_text())
expected.update({n:d for n,d in v21['hashes'].items() if not n.startswith('dist/')})
expected.update(manifest['hashes'])
script="""
import fs from 'node:fs';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
const expected=JSON.parse(fs.readFileSync(0,'utf8'));
for(const [name,digest] of Object.entries(expected))assert.equal(createHash('sha256').update(fs.readFileSync('/app/'+name)).digest('hex'),digest,name);
function files(dir,prefix=''){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(dir+'/'+e.name,prefix+e.name+'/'):[prefix+e.name]);}
const actual=files('/app/dist').map(n=>'dist/'+n).sort();
assert.deepEqual(actual,Object.keys(expected).filter(n=>n.startsWith('dist/')).sort());
console.log(JSON.stringify({verifiedFiles:Object.keys(expected).length,completeDistFiles:actual.length}));
"""
containers=json.loads(subprocess.check_output(['docker','inspect','daylight-api-1','daylight-worker-1','daylight-scheduler-1'],text=True))
roles=[]
for c in containers:
    role=c['Name'].split('-')[1]
    assert c['Config']['Image']==manifest['targetImage']
    assert c['Config']['Labels']['org.opencontainers.image.revision']==manifest['sourceCommit']
    env=dict(s.split('=',1) for s in c['Config']['Env'])
    assert env['DAYLIGHT_GIT_SHA']==manifest['sourceCommit'] and env['DAYLIGHT_METRICS']=='1'
    assert c['State']['Health']['Status']=='healthy' and c['RestartCount']==0 and not c['State']['OOMKilled']
    verified=json.loads(subprocess.check_output(['docker','exec','-i',c['Name'].lstrip('/'),'node','--input-type=module','-e',script],input=json.dumps(expected),text=True))
    probe="console.log(JSON.stringify(await(await fetch('http://127.0.0.1:%d/health/ready')).json()))" % (3000 if role=='api' else 3001)
    ready=json.loads(subprocess.check_output(['docker','exec',c['Name'].lstrip('/'),'node','--input-type=module','-e',probe],text=True))
    assert ready['ok'] and ready['metrics']['written']>0 and ready['metrics']['dropped']==0 and ready['metrics']['sinkError'] is None
    roles.append({'role':role,'image':c['Config']['Image'],'imageId':c['Image'],'health':c['State']['Health']['Status'],
        'restarts':c['RestartCount'],'oom':c['State']['OOMKilled'],'byteVerification':verified,'readiness':ready})
assert len({r['imageId'] for r in roles})==1
lines=subprocess.check_output(['./manage.sh','ps','--format','json'],cwd='/opt/daylight',text=True)
services=[{key:row.get(key) for key in ['Service','State','Health']} for row in map(json.loads,lines.splitlines()) if row]
assert len(services)==8 and all(s['State']=='running' and s['Health']=='healthy' for s in services)
result={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceCommit':manifest['sourceCommit'],
    'backendSourceCommit':manifest['backendSourceCommit'],
    'scope':'v22 running images, complete frontend file inventory, cumulative changed backend/script bytes and live role readiness',
    'roles':roles,'services':services}
(build/'runtime-verification.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))

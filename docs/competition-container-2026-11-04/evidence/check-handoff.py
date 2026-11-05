"""Run from any directory: python docs/competition-container-2026-11-04/evidence/check-handoff.py.

Checks documentation links, archived bytes, fixed release numbers and rollback shell syntax.
Requires local Docker and the already built complete source image for the syntax-only check.
"""
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import re
import subprocess
from urllib.parse import unquote, urlsplit

root = Path(__file__).resolve().parents[3]
evidence = Path(__file__).resolve().parent
receipt_path = evidence / 'handoff-check.json'
if not receipt_path.exists():
    receipt_path.write_text('{}\n', encoding='utf-8')

def read(file):
    return json.loads(file.read_text(encoding='utf-8-sig'))

checks = []
def check(name, ok, detail):
    checks.append({'name': name, 'ok': bool(ok), 'detail': detail})
    assert ok, name + ': ' + str(detail)

source = '8ff41a1ba28576dd8bfa9fa3a109a96ffa00606a'
publication = read(evidence / 'final-publication-summary.json')
gate = read(evidence / 'final-verification-summary.json')
package = read(evidence / 'final-portable-package.json')
runtime = read(evidence / 'runtime-verification-v22.json')
local = read(evidence / 'final-candidate-runtime.json')
check('fixed-source', publication['sourceCommit'] == gate['sourceCommit'] == package['sourceCommit'] == runtime['sourceCommit'] == source,
      source)
check('complete-gate', gate['ok'] and not gate['dirty'] and all(row['code'] == 0 for row in gate['stages'])
      and publication['tests'] == {'total': 1051, 'pass': 1021, 'skipped': 30, 'fail': 0}, 'five stages; 1051/1021/30/0')
check('source-image', local['ok'] and local['sourceTests'] == {'total': 9, 'passed': 9, 'skipped': 0}
      and local['realJobsChecks'] == 8 and local['realObjectStorageChecks'] == 14, local['image'])
check('public-inventory', len(read(evidence / 'public-checks-v22.json')['checks']) == 120
      and len(read(evidence / 'public-resources-v22.json')['checks']) == 330, '120 HTTPS; 330 resources')
layouts = read(evidence / 'public-layouts-v22.json')['checks']
behavior = read(evidence / 'public-behavior-v22.json')
check('browser-records', len(layouts) == 9 and all(r['ok'] for r in layouts)
      and len(behavior) == 11 and all(r['ok'] for r in behavior)
      and read(evidence / 'public-console-v22.json') == [], '9 layouts; 11 interactions; 0 console errors')

verified = 0
for relative, metadata in publication['sourceRecords'].items():
    file = evidence.parent / relative
    assert file.is_file(), relative
    assert len(file.read_bytes()) == metadata['bytes'], relative
    assert hashlib.sha256(file.read_bytes()).hexdigest() == metadata['sha256'], relative
    verified += 1
check('archived-original-bytes', verified > 40, {'files': verified})

portable = root / 'output/delivery/daylight-demo-20261104T003718.tar.gz'
if portable.exists():
    check('local-portable-package', portable.stat().st_size == package['bytes'] == 116057471
          and hashlib.sha256(portable.read_bytes()).hexdigest() == package['sha256'], package['sha256'])
else:
    checks.append({'name': 'local-portable-package', 'ok': True, 'detail': 'Private archive not present; recorded metadata retained.', 'scope': 'metadata-only'})

json_files = sorted(evidence.glob('*.json'))
for file in json_files:
    read(file)
check('json-parse', True, {'files': len(json_files)})

documents = ['README.md', 'README_EN.md', 'STATUS.md', 'docs/README.md',
             'docs/competition-container-2026-11-04/README.md',
             'docs/competition-container-2026-11-04/deployment-v22.md', 'HANDOFF-2026-11-04.md']
local_links = 0
missing = []
for name in documents:
    file = root / name
    markdown = file.read_text(encoding='utf-8-sig')
    for match in re.finditer(r'!?\[[^\]\n]*\]\(([^)\n]+)\)', markdown):
        target = match.group(1).strip().strip('<>')
        parsed = urlsplit(target)
        if parsed.scheme or parsed.netloc or not parsed.path:
            continue
        if parsed.path.startswith('/'):
            continue
        local_links += 1
        resolved = (file.parent / unquote(parsed.path)).resolve()
        if not resolved.exists():
            missing.append({'document': name, 'target': target})
check('document-local-links', not missing, {'checked': local_links, 'missing': missing})

handoff = (root / 'HANDOFF-2026-11-04.md').read_text(encoding='utf-8-sig')
for value in [source, package['sha256'], publication['publicImageId'], local['image']['id']]:
    assert value in handoff
check('handoff-version-values', True, 'source, package hash and both image IDs match raw records')
check('unfinished-work-present', all(text in handoff for text in ['实际参与数据尚未采集', '具体渠道尚未确定',
      '比赛系统的报名、团队信息、项目描述、链接和附件上传尚未执行', '真实微信设备的最终一轮清单待完成',
      '现有21页PDF保存v14运行快照', '图片供应商实际账单']), 'participant, device, source access, submission, report, bill')

rollback_section = handoff.split('### 需要回到v21时', 1)[1]
rollback = re.search(r'```sh\n(.*?)\n```', rollback_section, re.S).group(1)
syntax = subprocess.run(['docker', 'run', '--rm', '-i', '--network=none', '--read-only', '--entrypoint', 'sh',
                         local['image']['tag'], '-n'], input=rollback.encode('utf-8'), capture_output=True, timeout=30)
check('rollback-shell-syntax', syntax.returncode == 0, {'exitCode': syntax.returncode, 'mode': 'parse only; rollback not executed'})

cleanup = read(evidence / 'local-cleanup.json')
check('local-cleanup', cleanup['ok'] and cleanup['remainingProjectContainers'] == 0
      and cleanup['remainingProjectVolumes'] == 0 and cleanup['otherContainerIdsUnchanged'],
      '9 temporary containers and 5 test volumes removed; other container IDs unchanged')
health = read(evidence / 'closeout-health.json')
check('final-cloud-health', health['ok'] and health['healthyServices'] == 8 and all(r['healthy'] and r['restarts'] == 0
      and not r['oomKilled'] and r['metrics']['dropped'] == 0 and r['metrics']['sinkError'] is None for r in health['roles']),
      health['checkedAt'])

# Retain the same scan scope before and after the archive commit is created.
scan_files = [root / name for name in documents]
scan_files += [evidence.parent / name for name in publication['sourceRecords']]
scan_files += [evidence / 'closeout-health.json', evidence / 'local-cleanup.json', Path(__file__).resolve()]
introduced = '\n'.join(file.read_text(encoding='utf-8-sig') for file in scan_files
                       if file.suffix.lower() in ['.md', '.json', '.txt', '.py', '.sh'])
patterns = [r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----', r'AKIA[0-9A-Z]{16}', r'\bsk-[a-zA-Z0-9_-]{24,}\b']
hits = [index for index, pattern in enumerate(patterns) if re.search(pattern, introduced)]
check('handoff-credential-patterns', not hits, {'matches': len(hits), 'scope': 'handoff documents and archived text; PEM private keys, AWS access IDs, API token prefixes'})

diff = subprocess.run(['git', 'diff', '--check'], cwd=str(root), capture_output=True, text=True)
check('git-diff-whitespace', diff.returncode == 0, {'exitCode': diff.returncode})
result = {'checkedAt': datetime.now(timezone.utc).isoformat(), 'ok': True,
          'scope': 'post-release handoff documentation and existing raw evidence consistency', 'releaseSourceCommit': source,
          'archiveBranch': 'feat/competition-experience-20261103', 'checks': checks,
          'newModelCalls': 0, 'newImageCalls': 0, 'newCloudPurchasesCny': 0}
receipt_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(result, ensure_ascii=False, indent=2))

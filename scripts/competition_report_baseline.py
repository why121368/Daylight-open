"""Read the report's release snapshot, integration results and measured usage."""
from __future__ import annotations

import hashlib
import json
import re
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SUBMISSION = ROOT / 'docs/competition-submission-2026-11-04'
BASELINE_PATH = SUBMISSION / 'evidence/report-baseline.json'


def collect_baseline():
    sources = {}

    def read(relative, structured=True):
        path = ROOT / relative
        data = path.read_bytes()
        sources[relative] = hashlib.sha256(data).hexdigest()
        text = data.decode('utf-8-sig')
        return json.loads(text) if structured else text

    video = 'docs/competition-video-2026-11-04/evidence/'
    runtime = read(video + 'runtime-verification-v14.json')
    release = read(video + 'release-v14-manifest.json')
    public = read(video + 'public-verification-v14.json')
    static = read(video + 'static-verification-v14.json')
    media = read(video + 'media-inventory.json')
    candidate = read(video + 'candidate-media-checks-v14.json')
    reply = read('docs/competition-reply-2026-11-04/evidence/postgres-verification.json')
    value = read('docs/competition-value-2026-11-04/evidence/summary.json')
    rag = read('docs/competition-rag-2026-11-04/evidence/summary.json')
    cost = read('docs/competition-2026-11-04/evidence/cost-estimate.json')
    rag_cost = read('docs/competition-rag-2026-11-04/evidence/cost-estimate.json')
    ledger = read('docs/competition-2026-11-03/generation-and-budget.md', False)
    assert '图片累计10次' in ledger.replace(' ', '')
    tests = read('docs/competition-report-refresh-2026-11-04/evidence/full-tests.txt', False)

    def count(name):
        matches = re.findall(r'(?:ℹ|#)\s+' + name + r'\s+(\d+)', tests)
        assert len(matches) == 1, f'Missing or ambiguous test summary: {name}'
        return int(matches[0])

    assert count('fail') == count('cancelled') == 0
    assert count('tests') == count('pass') + count('skipped')
    assert len(runtime['services']) == 8
    assert all(row['State'] == 'running' and row['Health'] == 'healthy' for row in runtime['services'])
    assert len(runtime['roles']) == 3
    assert all(row['imageId'] == runtime['roles'][0]['imageId'] for row in runtime['roles'])
    assert all(row['health'] == 'healthy' and row['restarts'] == 0 and not row['oom'] for row in runtime['roles'])
    assert all(row['byteVerification'] == runtime['roles'][0]['byteVerification'] for row in runtime['roles'])
    assert runtime['sourceCommit'] == release['sourceCommit']
    assert reply['ok'] and reply['schemaRemoved'] and all(row['passed'] for row in reply['checks'])
    assert reply['realModelCalls'] == reply['realSmtpCalls'] == 0
    assert value['kind'] == 'automated-fixture-preflight' and value['participants'] == 0
    assert all(row['passed'] == row['total'] == 12 and row['errors'] == 0 for row in value['sets'])
    assert media['sha256'] == candidate['videoSha256'] and media['chapters'] == candidate['chapters']
    assert (rag['before']['correct'], rag['after']['correct']) == (6, 8)

    groups = [{'id': row['group'], 'calls': row['calls'], **{
        name: row['totals'][name] for name in ['inputTokens', 'outputTokens', 'estimatedCny']
    }} for row in cost['groups']]
    groups.extend({'id': 'rag-' + name, **row} for name, row in rag_cost['groups'].items())
    groups.append({'id': 'value-preflight', 'calls': value['realModelCalls'], **{
        name: value[name] for name in ['inputTokens', 'outputTokens', 'estimatedCny']
    }})
    for row in groups:
        recomputed = (Decimal(row['inputTokens']) * 2 + Decimal(row['outputTokens']) * 8) / 1000000
        assert recomputed == Decimal(str(row['estimatedCny'])), row['id']
    total_cny = sum(Decimal(str(row['estimatedCny'])) for row in groups)
    baseline = {
        'schemaVersion': 1, 'snapshotRelease': release['targetImage'],
        'snapshotAt': runtime['checkedAt'], 'imageId': runtime['roles'][0]['imageId'],
        'frontendCommit': runtime['sourceCommit'], 'backendCommit': runtime['backendSourceCommit'],
        'baseBackendCommit': release['baseBackendSourceCommit'],
        'archiveCommit': '2b58328809e3208df97e5157113be0529ca12158',
        'runtime': {
            'healthyServices': len(runtime['services']),
            **runtime['roles'][0]['byteVerification'],
            'publicChecks': len(public['checks']), 'staticChecks': len(static['checks']),
            'metrics': {row['role']: row['readiness']['metrics'] for row in runtime['roles']},
        },
        'tests': {name: count(name) for name in ['tests', 'pass', 'fail', 'skipped']},
        'reply': {'postgresChecks': len(reply['checks']), 'realSmtpCalls': 0,
                  'injectedTransportCalls': reply['injectedTransportCalls']},
        'value': {'modelCalls': value['realModelCalls'], 'participants': value['participants'],
                  'setAssertions': [row['passed'] for row in value['sets']],
                  'modelCallLatency': value['modelCallLatency']},
        'rag': {'before': rag['before']['correct'], 'after': rag['after']['correct'], 'cases': rag['after']['cases']},
        'media': {**media, 'transcriptCaptions': candidate['transcriptCaptions']},
        'budget': {
            'currency': 'CNY', 'limit': 500, 'groups': groups,
            'modelCalls': sum(row['calls'] for row in groups),
            'inputTokens': sum(row['inputTokens'] for row in groups),
            'outputTokens': sum(row['outputTokens'] for row in groups),
            'estimatedModelCny': float(total_cny),
            'imageCalls': 10, 'newCloudPurchases': 0,
            'pricingKind': 'published-list-price-estimate',
            'priceSource': cost['source']['source'],
            'imageAndCloudCosts': 'supplier-invoice',
        },
        'sourceHashes': sources,
    }
    return baseline


def read_baseline():
    current = collect_baseline()
    saved = json.loads(BASELINE_PATH.read_text(encoding='utf-8'))
    assert current == saved, 'Report baseline differs from source records; regenerate and review it.'
    return saved


if __name__ == '__main__':
    result = collect_baseline()
    BASELINE_PATH.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: result[key] for key in ['snapshotRelease', 'tests', 'runtime', 'budget']}, ensure_ascii=False))

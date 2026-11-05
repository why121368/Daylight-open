"""Verify public report links, MIME, complete file bytes and PDF range support.

Usage: python scripts/verify-competition-resources.py ORIGIN OUTPUT_JSON
Requires beautifulsoup4 from the competition report requirements.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit, unquote
from urllib.request import Request, urlopen, build_opener, ProxyHandler
import argparse
import hashlib
import json

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'public'
PAGES = [
    'technical-report.html', 'rag-release-v10.html', 'value-report.html',
    'value-study.html', 'budget.html', 'reply-review-report.html',
    'value-release-v12.html', 'reply-release-v13.html', 'video-report.html',
    'demo-transcript.html', 'video-release-v14.html', 'report-refresh.html',
    'rag-latency-report.html', 'entry-report.html', 'entry-release-v17.html', 'recovery-report.html',
    'recovery-release-v18.html', 'continuity-report.html', 'delivery-report.html', 'container-report.html', 'reproduce.html',
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('origin')
    parser.add_argument('output')
    parser.add_argument('--direct', action='store_true', help='Use a direct connection instead of the system proxy')
    args = parser.parse_args()
    origin = args.origin.rstrip('/')
    open_url = build_opener(ProxyHandler({})).open if args.direct else urlopen
    paths = {'/competition/' + name for name in PAGES}
    hosts = {'', 'daylight.yunforis.com', urlsplit(origin).netloc}
    for name in PAGES:
        soup = BeautifulSoup((PUBLIC / 'competition' / name).read_text(encoding='utf-8'), 'html.parser')
        for node in soup.select('[href], [src]'):
            parsed = urlsplit(node.get('href') or node.get('src'))
            if parsed.netloc in hosts and parsed.path.startswith('/competition/'):
                paths.add(unquote(parsed.path))
    paths.update('/competition/' + name for name in [
        'technical-report.pdf', 'demo-chapters.json', 'demo-zh.vtt',
        'demo-chapters.vtt', 'demo-poster.jpg', 'demo-transcript.txt', 'demo.mp4',
        'submission-assets/evidence/report-manifest.json',
        'submission-assets/evidence/report-baseline.json',
        'experience-step-qr.json',
        *[f'experience-step-{step}-qr.png' for step in range(8)],
    ])

    def check(path):
        local = (PUBLIC / path.lstrip('/')).resolve()
        assert PUBLIC in local.parents and local.is_file(), path
        with open_url(origin + path, timeout=30) as response:
            data = response.read()
            status, mime = response.status, response.headers.get('Content-Type', '')
        assert status == 200, path
        sha = hashlib.sha256(data).hexdigest()
        assert sha == hashlib.sha256(local.read_bytes()).hexdigest(), path
        expected = {'.pdf': 'application/pdf', '.html': 'text/html', '.json': 'json',
                    '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg',
                    '.mp4': 'video/mp4', '.vtt': 'text/vtt'}
        if local.suffix in expected:
            assert expected[local.suffix] in mime, f'{path}: {mime}'
        if local.suffix == '.pdf':
            assert data.startswith(b'%PDF-'), path
        if local.suffix == '.html':
            assert b'<main>' in data, path
        if local.suffix == '.json':
            json.loads(data)
        return {'path': path, 'status': status, 'contentType': mime, 'bytes': len(data), 'sha256': sha}

    with ThreadPoolExecutor(max_workers=3) as executor:
        checks = list(executor.map(check, sorted(paths)))
    with open_url(Request(origin + '/competition/technical-report.pdf',
                         headers={'Range': 'bytes=0-31'}), timeout=30) as response:
        data = response.read()
        assert response.status == 206 and len(data) == 32
        assert data == (PUBLIC / 'competition/technical-report.pdf').read_bytes()[:32]
        range_check = {'status': response.status, 'contentType': response.headers.get('Content-Type'),
                       'contentRange': response.headers.get('Content-Range'), 'bytes': len(data)}
    result = {'checkedAt': datetime.now(timezone.utc).isoformat(), 'origin': origin,
              'transport': 'direct-https' if args.direct else 'system-proxy-settings',
              'scope': 'All competition resources referenced by the current technical report and linked release/value/reply/video/refresh records; complete bytes, MIME and PDF range',
              'pages': PAGES, 'checks': checks, 'pdfRange': range_check}
    output = (ROOT / args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'ok': True, 'resources': len(checks), 'pdfRange': range_check}))


if __name__ == '__main__':
    main()

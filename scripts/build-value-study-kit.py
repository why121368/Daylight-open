"""Build the local facilitator kit and relocatable in-project Windows launchers."""
from pathlib import Path
from html import escape
import hashlib
import json
import shutil

import markdown

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / 'docs/competition-value-2026-11-04'
OUT = ROOT / 'output/participant-kit-20261104'
OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'assets').mkdir(exist_ok=True)
source = (DOC / 'facilitator-kit.md').read_text(encoding='utf-8')
body = markdown.markdown(source, extensions=['tables', 'fenced_code', 'toc'])
body = body.replace('href="README.md"', 'href="https://daylight.yunforis.com/competition/value-report.html"')
body = body.replace('<img ', '<img loading="lazy" decoding="async" ')
css = 'body{margin:0;background:#faf9f5;color:#23382d;font:16px/1.85 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1000px;margin:auto;padding:24px 20px 60px;overflow-wrap:anywhere}h1,h2,h3{line-height:1.4;margin-top:1.7em}a{color:#176943}img{max-width:100%;height:auto;border-radius:12px}table{border-collapse:collapse;display:block;overflow:auto}td,th{border:1px solid #ccd8ca;padding:8px 12px;min-width:95px;text-align:left}th{background:#e7eee2}pre{padding:16px;background:#edf1e9;overflow:auto;border-radius:10px}blockquote{border-left:4px solid #5f8a69;margin-left:0;padding-left:18px}code{font-family:Consolas,monospace;font-size:.9em}li{margin:8px 0}@media print{main{max-width:none;padding:0;font-size:10pt}img{max-height:14cm;object-fit:contain}h2,h3{break-after:avoid}tr,blockquote{break-inside:avoid}}'
(OUT / 'index.html').write_text('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Daylight 3–5位用户对照主持包</title><style>' + css + '</style><main>' + body + '</main></html>', encoding='utf-8')
shutil.copy2(DOC / 'facilitator-kit.md', OUT / 'facilitator-kit.md')
shutil.copy2(DOC / 'assets/study-flow.webp', OUT / 'assets/study-flow.webp')
for label, args in [('Practice', '--practice'), ('Live', '--live --settings data/settings.json --max-calls 30')]:
    content = '@echo off\r\nsetlocal\r\ncd /d "%~dp0..\\.."\r\nif not exist "scripts\\value-study.mjs" (\r\n  echo Keep this kit under the project output directory.\r\n  pause\r\n  exit /b 1\r\n)\r\ncall npm run study -- ' + args + '\r\npause\r\n'
    (OUT / ('Start-' + label + '.cmd')).write_bytes(content.encode('ascii'))
brief = '''# Daylight 参与说明

每人两轮，使用两套不同通知。人工轮自行整理，Daylight轮分析后核验。每轮点击开始即计时，由你决定完成。

1. 阅读六封通知，登记最终有效安排与两项材料截止，选择对应来源。
2. 保留已有安排，处理改期、重复和取消，说明曾发生的时间冲突。
3. 安排与待办在右侧添加，全部时间为北京时间。
4. 核验后填写求助次数和反馈，确认完成并保存。

记录包括匿名编号、耗时、整理结果和反馈，可随时结束。
'''
(OUT / 'participant-brief.md').write_text(brief, encoding='utf-8')
orders = [('P01', 'manual-A', 'daylight-B'), ('P02', 'daylight-A', 'manual-B'), ('P03', 'manual-B', 'daylight-A'), ('P04', 'daylight-B', 'manual-A'), ('P05', 'manual-A', 'daylight-B')]
(OUT / 'field-notes.csv').write_text('participant,first_trial,second_trial,started_at,both_completed,both_reviewed,help_or_interruptions,export_file\n' + ''.join(','.join(row) + ',,,,,\n' for row in orders), encoding='utf-8-sig')
manifest = {'studyVersion': 'daylight-value-study-20261104-v1', 'participantsPlanned': [3, 5], 'liveCallCap': 30,
            'normalCallsForFiveParticipants': 25, 'newModelCalls': 0, 'newImageCalls': 0,
            'source': (DOC / 'facilitator-kit.md').relative_to(ROOT).as_posix(),
            'files': {p.relative_to(OUT).as_posix(): {'bytes': p.stat().st_size, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
                      for p in sorted(OUT.rglob('*')) if p.is_file() and p.name != 'kit-manifest.json'}}
(OUT / 'kit-manifest.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
print(json.dumps({'directory': str(OUT), 'files': len(manifest['files']) + 1, 'liveCallCap': 30, 'modelCallsIssued': 0}))

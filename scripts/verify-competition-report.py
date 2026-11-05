"""Check the authored PDF's content, links, geometry, fonts and publication bytes."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

import pdfplumber
from pypdf import PdfReader
from competition_report_baseline import BASELINE_PATH, read_baseline

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT/'docs/competition-submission-2026-11-04/evidence'
manifest = json.loads((EVIDENCE/'report-manifest.json').read_text(encoding='utf-8'))
baseline = read_baseline()
assert hashlib.sha256(BASELINE_PATH.read_bytes()).hexdigest() == manifest['baselineSha256']
assert manifest['snapshotRelease'] == baseline['snapshotRelease']
assert manifest['frontendCommit'] == baseline['frontendCommit']
assert manifest['applicationCommit'] == baseline['backendCommit']
assert hashlib.sha256((ROOT/manifest['source']).read_bytes()).hexdigest() == manifest['sourceSha256']
path = ROOT/manifest['pdf']
content = path.read_bytes()
assert hashlib.sha256(content).hexdigest() == manifest['pdfSha256']
assert content == (ROOT/'public/competition/technical-report.pdf').read_bytes()
reader = PdfReader(path)
assert len(reader.pages) == manifest['pages'] == manifest['sections'] == len(manifest['sectionHeadings'])
assert len(reader.outline) == manifest['bookmarks'] == manifest['sections']
assert [str(entry['/Title']) for entry in reader.outline] == manifest['sectionHeadings']
for index, entry in enumerate(reader.outline):
    assert reader.get_destination_page_number(entry) == index, f'Wrong bookmark page: {entry}'
page_ids = {page.indirect_reference.idnum for page in reader.pages}
external, internal = [], []
embedded = set()
for page in reader.pages:
    fonts = page['/Resources'].get('/Font',{}).get_object()
    for font in fonts.values():
        font = font.get_object()
        descriptor = font.get('/FontDescriptor')
        if descriptor:
            descriptor = descriptor.get_object()
            if any(name in descriptor for name in ['/FontFile','/FontFile2','/FontFile3']):
                embedded.add(str(font['/BaseFont']).lstrip('/'))
    for annotation in page.get('/Annots',[]):
        annotation = annotation.get_object()
        action = annotation.get('/A',{})
        if '/URI' in action:
            uri = str(action['/URI'])
            assert uri.startswith('https://'), uri
            external.append(uri)
        if '/Dest' in annotation:
            destination = annotation['/Dest']
            assert destination[0].idnum in page_ids
            internal.append(destination[0].idnum)
pages = []
with pdfplumber.open(path) as pdf:
    for index, page in enumerate(pdf.pages,1):
        text = page.extract_text() or ''
        assert len(text) > 200, f'Sparse page: {index}'
        overflow = [char for char in page.chars if char['x0'] < 45 or char['x1'] > page.width-45
                    or char['top'] < 15 or char['bottom'] > page.height-14]
        assert not overflow, f'Text exceeds safe page bounds: {index}'
        used = {char['fontname'] for char in page.chars}
        assert used.issubset(embedded), f'Unembedded text fonts on page {index}: {used-embedded}'
        pages.append({'page':index,'characters':len(text),'overflowCharacters':len(overflow)})
assert len(external) == manifest['externalLinks']
assert len(internal) == 6
text = '\n'.join(page.extract_text() or '' for page in reader.pages)
assert all(token in text for token in manifest['textChecks'])
assert all(f'前端 {baseline["frontendCommit"][:7]}' in page.extract_text() for page in reader.pages)
assert all(f'后端 {baseline["backendCommit"][:7]}' in page.extract_text() for page in reader.pages)
result = {
    'at':datetime.now(timezone.utc).isoformat(), 'scope':'Authored report, source-record baseline and byte-identical public copy',
    'pdfSha256':manifest['pdfSha256'],'bytes':len(content), 'pages':pages,
    'bookmarks':len(reader.outline),'validInternalLinks':len(internal),'externalLinks':len(external),
    'sourceRecords':len(baseline['sourceHashes']),'baselineSha256':manifest['baselineSha256'],
    'snapshotRelease':manifest['snapshotRelease'],
    'embeddedTextFonts':sorted(embedded),'textBounds':'45pt horizontal / 15pt top / 14pt bottom',
}
(EVIDENCE/'pdf-verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'pages':len(pages),'bookmarks':len(reader.outline),'internalLinks':len(internal),
                  'externalLinks':len(external),'overflowCharacters':0,'allUsedTextFontsEmbedded':True},ensure_ascii=False))

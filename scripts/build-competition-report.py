"""Build the November competition report from reviewed Markdown and existing figures.

Usage: python scripts/build-competition-report.py
Dependencies: reportlab, Markdown, beautifulsoup4, pypdf, Pillow.
Provide --font and --font-bold for portable Chinese TrueType fonts on other hosts.
The PDF is copied to public/competition/technical-report.pdf for the web release.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
from functools import partial
from html import escape
from pathlib import Path
from urllib.parse import urljoin

import markdown
from bs4 import BeautifulSoup, NavigableString, Tag
from PIL import Image as PillowImage
from pypdf import PdfReader
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import (
    BaseDocTemplate, Flowable, Frame, Image, KeepTogether, PageBreak,
    PageTemplate, Paragraph, Spacer, Table, TableStyle,
)
from competition_report_baseline import BASELINE_PATH, read_baseline

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'docs/competition-submission-2026-11-04/technical-report.md'
GREEN = colors.HexColor('#173e30')
INK = colors.HexColor('#243b32')
MUTED = colors.HexColor('#66756d')
GOLD = colors.HexColor('#eca63b')
LINE = colors.HexColor('#d6dfd8')
PALE = colors.HexColor('#f1f5ed')
WHITE = colors.white
REGULAR, BOLD = 'DaylightRegular', 'DaylightBold'
WIDTH, HEIGHT = A4
MARGIN = 47
BODY_WIDTH = WIDTH - MARGIN * 2
WEB = 'https://daylight.yunforis.com/'
PAGE_MAP = {
    SOURCE: 'competition/technical-report.html',
    ROOT/'docs/competition-rag-2026-11-04/deployment-v10.md': 'competition/rag-release-v10.html',
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def font_path(explicit, bold=False):
    candidates = [explicit, os.environ.get('DAYLIGHT_REPORT_FONT_BOLD' if bold else 'DAYLIGHT_REPORT_FONT'),
                  f'C:/Windows/Fonts/{"msyhbd.ttc" if bold else "msyh.ttc"}',
                  f'/usr/share/fonts/truetype/wqy/{"wqy-zenhei.ttc"}']
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return str(Path(candidate).resolve())
    raise SystemExit('Provide --font and --font-bold paths to Chinese TrueType fonts.')


class Bookmark(Flowable):
    def __init__(self, title, key, level=0):
        super().__init__()
        self.title, self.key, self.level = title, key, level
        self.width = self.height = 0

    def draw(self):
        self.canv.bookmarkPage(self.key)
        self.canv.addOutlineEntry(self.title, self.key, self.level, closed=False)


class ReportDocument(BaseDocTemplate):
    def __init__(self, path, baseline):
        self.baseline = baseline
        super().__init__(str(path), pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN,
                         topMargin=53, bottomMargin=48,
                         title='Daylight 云原生邮件 Agent 技术与实测报告',
                         author='Daylight', subject='2026-11-04 v14 release snapshot, reply review, value study and chapter video',
                         invariant=1, initialFontName=REGULAR)
        frame = Frame(MARGIN, 48, BODY_WIDTH, HEIGHT-101,
                      leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        self.addPageTemplates([PageTemplate(id='Daylight', frames=frame, onPage=self.decoration)])

    def decoration(self, canvas, doc):
        canvas.saveState()
        if doc.page == 1:
            canvas.setFillColor(GREEN)
            canvas.rect(0, HEIGHT-13, WIDTH, 13, fill=1, stroke=0)
            canvas.setFillColor(GOLD)
            canvas.rect(MARGIN, HEIGHT-31, 58, 4, fill=1, stroke=0)
        else:
            canvas.setFont(BOLD, 8)
            canvas.setFillColor(GREEN)
            canvas.drawString(MARGIN, HEIGHT-30, 'Daylight  /  云原生邮件 Agent')
            canvas.setFont(REGULAR, 7.5)
            canvas.setFillColor(MUTED)
            canvas.drawRightString(WIDTH-MARGIN, HEIGHT-30, '技术与实测  ·  2026-11-04')
            canvas.setStrokeColor(LINE)
            canvas.line(MARGIN, HEIGHT-37, WIDTH-MARGIN, HEIGHT-37)
        canvas.setStrokeColor(LINE)
        canvas.line(MARGIN, 35, WIDTH-MARGIN, 35)
        canvas.setFont(REGULAR, 7.2)
        canvas.setFillColor(MUTED)
        canvas.drawString(MARGIN, 22, f'快照 v14  /  前端 {self.baseline["frontendCommit"][:7]}  /  后端 {self.baseline["backendCommit"][:7]}  /  北京时间')
        canvas.drawRightString(WIDTH-MARGIN, 22, f'{doc.page:02d}')
        canvas.restoreState()


class Renderer:
    def __init__(self):
        self.story = []
        self.headings = []
        self.quick_links = ''
        common = dict(fontName=REGULAR, textColor=INK, wordWrap='CJK',
                      splitLongWords=True, allowWidows=0, allowOrphans=0)
        self.body = ParagraphStyle('Body', fontSize=10, leading=17.1, spaceAfter=10, rightIndent=10, **common)
        self.h1 = ParagraphStyle('Section', fontName=BOLD, fontSize=21, leading=29,
                                 textColor=GREEN, spaceAfter=19, wordWrap='CJK', keepWithNext=True)
        self.h2 = ParagraphStyle('Subsection', fontName=BOLD, fontSize=12, leading=19,
                                 textColor=GREEN, spaceBefore=7, spaceAfter=9,
                                 wordWrap='CJK', keepWithNext=True)
        self.caption = ParagraphStyle('Caption', fontSize=8.2, leading=13.2, textColor=MUTED,
                                      fontName=REGULAR, wordWrap='CJK', spaceBefore=6, spaceAfter=13)
        self.cell = ParagraphStyle('Cell', fontSize=8.8, leading=14.1, spaceAfter=0, **common)
        self.header = ParagraphStyle('TableHeading', fontName=BOLD, fontSize=8.7,
                                     leading=14.1, textColor=WHITE, wordWrap='CJK')
        self.code = ParagraphStyle('Code', fontSize=8.1, leading=13.3,
                                   textColor=GREEN, fontName=REGULAR,
                                   wordWrap='CJK', splitLongWords=True)

    def link(self, value):
        if value.startswith(('http://', 'https://', 'mailto:', '#')):
            return value
        if value.startswith('/'):
            return urljoin(WEB, value)
        target = (SOURCE.parent/value.split('#')[0]).resolve()
        if target in PAGE_MAP:
            return urljoin(WEB, PAGE_MAP[target])
        if target == SOURCE.parent/'evidence/report-manifest.json':
            return urljoin(WEB, 'competition/submission-assets/evidence/report-manifest.json')
        if target == BASELINE_PATH:
            return urljoin(WEB, 'competition/submission-assets/evidence/report-baseline.json')
        return urljoin(WEB, value)

    def inline(self, node):
        if isinstance(node, NavigableString):
            return escape(str(node))
        if not isinstance(node, Tag):
            return ''
        content = ''.join(self.inline(child) for child in node.children)
        if node.name in ('strong', 'b'):
            return f'<b>{content}</b>'
        if node.name in ('em', 'i'):
            return f'<i>{content}</i>'
        if node.name == 'code':
            return f'<font color="#176943">{content}</font>'
        if node.name == 'a':
            return f'<link href="{escape(self.link(node.get("href", "")), quote=True)}" color="#176943"><u>{content}</u></link>'
        if node.name == 'br':
            return '<br/>'
        return content

    def image(self, tag, max_width, max_height=335):
        path = (SOURCE.parent/tag['src']).resolve()
        if ROOT not in path.parents or not path.is_file():
            raise ValueError(f'Invalid report image: {tag["src"]}')
        with PillowImage.open(path) as original:
            width, height = original.size
            encoded = io.BytesIO()
            original.convert('RGB').save(encoded,format='JPEG',quality=91,optimize=True)
            encoded.seek(0)
        hint = float(tag.get('width', max_width))
        scale = min(max_width/width, max_height/height, hint/width)
        result = Image(encoded, width=width*scale, height=height*scale)
        result.hAlign = 'CENTER'
        return result

    def images(self, tags):
        if len(tags) == 1:
            image = self.image(tags[0], BODY_WIDTH)
            caption = Paragraph(escape(tags[0].get('alt', '')), self.caption)
            self.story.append(KeepTogether([image, caption]))
        else:
            width = (BODY_WIDTH-14)/len(tags)
            cells = []
            for tag in tags:
                cells.append([self.image(tag, width-8, 330),
                              Paragraph(escape(tag.get('alt', '')), self.caption)])
            table = Table([cells], colWidths=[width]*len(tags), hAlign='CENTER')
            table.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),
                                       ('LEFTPADDING',(0,0),(-1,-1),4),
                                       ('RIGHTPADDING',(0,0),(-1,-1),4)]))
            self.story.extend([table, Spacer(1,7)])

    def table(self, node):
        rows = node.find_all('tr')
        count = max(len(row.find_all(['td','th'], recursive=False)) for row in rows)
        ratios = {2:[0.32,0.68], 3:[0.23,0.385,0.385], 4:[0.31,0.16,0.16,0.37]}.get(count,[1/count]*count)
        if '编号' in rows[0].get_text():
            ratios = [0.10,0.64,0.26]
        if '同口径' in rows[0].get_text():
            ratios = [0.29,0.15,0.15,0.41]
        data = []
        for row in rows:
            cells = row.find_all(['td','th'], recursive=False)
            data.append([Paragraph(self.inline(cell), self.header if cell.name == 'th' else self.cell)
                         for cell in cells])
        table = Table(data, colWidths=[BODY_WIDTH*ratio for ratio in ratios],
                      repeatRows=1, hAlign='LEFT')
        table.setStyle(TableStyle([
            ('BACKGROUND',(0,0),(-1,0),GREEN), ('VALIGN',(0,0),(-1,-1),'TOP'),
            ('ROWBACKGROUNDS',(0,1),(-1,-1),[WHITE,PALE]),
            ('LINEBELOW',(0,0),(-1,0),0.7,GREEN),
            ('LINEBELOW',(0,1),(-1,-1),0.35,LINE),
            ('LEFTPADDING',(0,0),(-1,-1),9), ('RIGHTPADDING',(0,0),(-1,-1),9),
            ('TOPPADDING',(0,0),(-1,-1),7), ('BOTTOMPADDING',(0,0),(-1,-1),7),
        ]))
        self.story.extend([table, Spacer(1,12)])

    def nodes(self, soup, section):
        for node in soup.children:
            if not isinstance(node, Tag):
                continue
            if node.name in ('h1','h2','h3'):
                text = node.get_text(' ',strip=True)
                if node.name == 'h1':
                    self.story.append(Bookmark(text, f'section-{section}'))
                style = self.h1 if node.name == 'h1' else self.h2
                if section == 0 and node.name == 'h1':
                    style = ParagraphStyle('CoverTitle', parent=self.h1, fontSize=45, leading=58, spaceAfter=16)
                self.story.append(Paragraph(self.inline(node), style))
                if section == 1 and node.name == 'h1':
                    self.story.append(Paragraph('快速定位：' + self.quick_links, self.body))
            elif node.name == 'table':
                self.table(node)
            elif node.name == 'p':
                images = node.find_all('img')
                if images:
                    self.images(images)
                else:
                    self.story.append(Paragraph(self.inline(node), self.body))
            elif node.name == 'pre':
                lines = node.get_text().strip().splitlines()
                block = Paragraph('<br/>'.join(escape(line).replace('  ','&#160;&#160;') for line in lines), self.code)
                table = Table([[block]], colWidths=[BODY_WIDTH])
                table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),PALE),
                                           ('BOX',(0,0),(-1,-1),0.5,LINE),
                                           ('LEFTPADDING',(0,0),(-1,-1),12),
                                           ('RIGHTPADDING',(0,0),(-1,-1),12),
                                           ('TOPPADDING',(0,0),(-1,-1),10),
                                           ('BOTTOMPADDING',(0,0),(-1,-1),10)]))
                self.story.extend([table, Spacer(1,11)])
            elif node.name in ('ul','ol'):
                for index, child in enumerate(node.find_all('li',recursive=False),1):
                    marker = f'{index}.' if node.name == 'ol' else '-'
                    self.story.append(Paragraph(f'{marker} {self.inline(child)}',self.body))
            elif node.name == 'img':
                self.images([node])
            else:
                self.nodes(node, section)

    def build(self):
        sections = re.split(r'<!--\s*page\s*-->', SOURCE.read_text(encoding='utf-8'))
        self.headings = [re.search(r'^# (.+)$', section, re.MULTILINE).group(1).strip() for section in sections]
        quick = [('用户问题', '用户价值'), ('实际云原生', '架构'), ('Agent 从', 'Agent'),
                 ('手机交互', '手机体验'), ('模型质量与费用', '费用'), ('证据索引', '证据索引')]
        links = []
        for keyword, label in quick:
            matches = [index for index, heading in enumerate(self.headings) if keyword in heading]
            assert len(matches) == 1, keyword
            links.append(f'<link href="#section-{matches[0]}" color="#176943"><u>{label}</u></link>')
        self.quick_links = '  /  '.join(links)
        for index, section in enumerate(sections):
            if index:
                self.story.append(PageBreak())
            html = markdown.markdown(section, extensions=['tables','fenced_code'])
            self.nodes(BeautifulSoup(html,'html.parser'),index)
        return len(sections)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out',default='output/pdf/daylight-technical-report-20261104.pdf')
    parser.add_argument('--font')
    parser.add_argument('--font-bold')
    args = parser.parse_args()
    baseline = read_baseline()
    fonts = [font_path(args.font),font_path(args.font_bold,bold=True)]
    pdfmetrics.registerFont(TTFont(REGULAR, fonts[0], subfontIndex=0))
    pdfmetrics.registerFont(TTFont(BOLD, fonts[1], subfontIndex=0))
    pdfmetrics.registerFontFamily(REGULAR,normal=REGULAR,bold=BOLD,italic=REGULAR,boldItalic=BOLD)
    renderer = Renderer()
    sections = renderer.build()
    output = (ROOT/args.out).resolve()
    output.parent.mkdir(parents=True,exist_ok=True)
    ReportDocument(output, baseline).build(renderer.story, canvasmaker=partial(Canvas, initialFontName=REGULAR))
    reader = PdfReader(output)
    extracted = '\n'.join(page.extract_text() or '' for page in reader.pages)
    expected = ['Daylight', '6/8', '8/8', str(baseline['tests']['pass']),
                f"{baseline['budget']['estimatedModelCny']:.6f}", baseline['frontendCommit'][:7],
                baseline['backendCommit'][:7], '8.77', '2.38', 'revision', '12/12', '135']
    assert all(value in extracted for value in expected), 'Report text verification failed'
    assert len(reader.pages) == sections, 'A report section overflowed its intended page'
    public = ROOT/'public/competition/technical-report.pdf'
    public.write_bytes(output.read_bytes())
    manifest = {
        'date':'2026-11-04','applicationCommit':baseline['backendCommit'],
        'frontendCommit':baseline['frontendCommit'], 'evidenceCommit':baseline['archiveCommit'],
        'snapshotRelease':baseline['snapshotRelease'],'snapshotAt':baseline['snapshotAt'],
        'baseline':BASELINE_PATH.relative_to(ROOT).as_posix(),'baselineSha256':digest(BASELINE_PATH),
        'source':SOURCE.relative_to(ROOT).as_posix(),'sourceSha256':digest(SOURCE),
        'pdf':output.relative_to(ROOT).as_posix(),'pdfSha256':digest(output),
        'bytes':output.stat().st_size,'pages':len(reader.pages),'sections':sections,
        'externalLinks':sum(1 for page in reader.pages for annotation in page.get('/Annots',[])
                            if annotation.get_object().get('/A',{}).get('/URI')),
        'bookmarks':len(reader.outline),'sectionHeadings':renderer.headings,'textChecks':expected,
        'fontNames':[REGULAR,BOLD],
    }
    path = SOURCE.parent/'evidence/report-manifest.json'
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(manifest,ensure_ascii=False,indent=2))


if __name__ == '__main__':
    main()

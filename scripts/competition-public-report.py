"""Publish the reviewed competition documentation as static, mobile-readable HTML.

Requires Python-Markdown. Only the listed documents and synthetic evidence are copied.
GitHub source links retain the repository's existing access rules.
"""
from pathlib import Path
from html import escape
from html.parser import HTMLParser
import argparse, json, re, shutil
from urllib.parse import urlsplit, unquote
import markdown

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT/'docs/competition-2026-11-03'
OPERATIONS = ROOT/'docs/competition-2026-11-04'
RAG = ROOT/'docs/competition-rag-2026-11-04'
SUBMISSION = ROOT/'docs/competition-submission-2026-11-04'
VALUE = ROOT/'docs/competition-value-2026-11-04'
REPLY = ROOT/'docs/competition-reply-2026-11-04'
VIDEO = ROOT/'docs/competition-video-2026-11-04'
REFRESH = ROOT/'docs/competition-report-refresh-2026-11-04'
LATENCY = ROOT/'docs/competition-rag-latency-2026-11-04'
ENTRY = ROOT/'docs/competition-entry-2026-11-04'
RECOVERY = ROOT/'docs/competition-recovery-2026-11-04'
CONTINUITY = ROOT/'docs/competition-continuity-2026-11-04'
DELIVERY = ROOT/'docs/competition-delivery-2026-11-04'
CONTAINER = ROOT/'docs/competition-container-2026-11-04'
OUT = ROOT/'public/competition'
OUT.mkdir(exist_ok=True)
REPO = 'https://github.com/why121368/Daylight/blob/feat/competition-experience-20261103/'
PAGES = {
    DOCS/'README.md': 'report.html', DOCS/'deployment.md': 'deployment-snapshot.html',
    DOCS/'demo-script.md': 'demo-script.html', DOCS/'value-study.md': 'value-study.html',
    DOCS/'generation-and-budget.md': 'budget.html', DOCS/'plan.md': 'plan.html',
    ROOT/'docs/performance-2026-11-03/README.md': 'performance-report.html',
    ROOT/'docs/distributed-ha-and-capacity.md': 'capacity-design.html',
    DOCS/'evidence/k8s-measurements.md': 'k8s-measurements.html',
    OPERATIONS/'README.md': 'operations-report.html',
    RAG/'README.md': 'rag-report.html',
    RAG/'deployment-v9.md': 'rag-deployment.html',
    RAG/'deployment-v10.md': 'rag-release-v10.html',
    SUBMISSION/'technical-report.md': 'technical-report.html',
    VALUE/'README.md': 'value-report.html',
    VALUE/'deployment-v12.md': 'value-release-v12.html',
    REPLY/'README.md': 'reply-review-report.html',
    REPLY/'deployment-v13.md': 'reply-release-v13.html',
    VIDEO/'README.md': 'video-report.html',
    VIDEO/'transcript.md': 'demo-transcript.html',
    VIDEO/'deployment-v14.md': 'video-release-v14.html',
    REFRESH/'README.md': 'report-refresh.html',
    LATENCY/'README.md': 'rag-latency-report.html',
    ENTRY/'README.md': 'entry-report.html',
    ENTRY/'deployment-v17.md': 'entry-release-v17.html',
    RECOVERY/'README.md': 'recovery-report.html',
    RECOVERY/'deployment-v18.md': 'recovery-release-v18.html',
    CONTINUITY/'README.md': 'continuity-report.html',
    DELIVERY/'README.md': 'delivery-report.html',
    CONTAINER/'README.md': 'container-report.html',
}
CSS = '''body{margin:0;background:#faf9f5;color:#23382d;font:16px/1.85 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1100px;margin:auto;padding:30px 20px 70px;overflow-wrap:anywhere}nav{padding:16px 20px;background:#173e30;color:#fff;display:flex;gap:24px;flex-wrap:wrap}nav a{color:#fff;min-height:44px;display:inline-flex;align-items:center}a{color:#176943;text-underline-offset:4px}h1,h2,h3{line-height:1.4;margin-top:1.8em;scroll-margin-top:20px}h1{font-size:2em}h2{border-top:1px solid #d3ddd2;padding-top:24px}p{margin:1em 0}img{max-width:100%;height:auto;border-radius:10px}p img{vertical-align:top;margin:6px 10px 6px 0}table{border-collapse:collapse;display:block;overflow-x:auto;max-width:100%;margin:24px 0}td,th{border:1px solid #ccd8ca;padding:10px 14px;text-align:left;vertical-align:top;min-width:120px}th{background:#e7eee2}pre{background:#edf1e9;border:1px solid #d4dece;padding:16px;border-radius:10px;overflow-x:auto}code{font-family:ui-monospace,Consolas,monospace;font-size:.88em}blockquote{border-left:4px solid #5f8a69;margin-left:0;padding-left:18px}.stamp{font-size:13px;color:#5e7063;padding:12px 16px;background:#edf1e9;border-radius:8px}.toc{background:#fff;padding:10px 18px;border-radius:8px}li{margin:7px 0}@media(max-width:600px){main{padding:18px 16px 50px}h1{font-size:1.65em}td,th{font-size:14px;padding:8px 10px}nav{gap:16px}}'''
private_patterns = [r'sk-[A-Za-z0-9_-]{24,}', r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----']
def within(path,base): return path == base or base in path.parents
def review(text, path):
    if any(re.search(pattern,text) for pattern in private_patterns): raise ValueError(f'Credential pattern: {path}')

def copy_asset(path):
    resolved = path.resolve()
    if not resolved.is_file(): return None
    if resolved.parent == OUT and resolved.name in {'architecture.webp','dataflow.webp','performance.webp','observability.webp','rag-evidence.webp','experience-qr.png','demo-chapters.json','demo-zh.vtt','demo-chapters.vtt','demo-transcript.txt','demo-poster.jpg'}:
        return '/competition/'+resolved.name
    if within(resolved,SUBMISSION) and resolved.relative_to(SUBMISSION).parts[0] == 'evidence':
        target=OUT/'submission-assets'/resolved.relative_to(SUBMISSION)
    elif within(resolved,DOCS):
        relative=resolved.relative_to(DOCS)
        allowed=relative.parts[0] in ['images','evidence'] or resolved.suffix in ['.mmd','.txt','.csv']
        if not allowed: return None
        target=OUT/'report-assets'/relative
    elif within(resolved,OPERATIONS) and resolved.relative_to(OPERATIONS).parts[0] in ['images','evidence']:
        target=OUT/'operations-assets'/resolved.relative_to(OPERATIONS)
    elif within(resolved,OPERATIONS) and resolved.suffix in ['.txt','.mmd','.csv']:
        target=OUT/'operations-assets'/resolved.relative_to(OPERATIONS)
    elif within(resolved,RAG) and resolved.relative_to(RAG).parts[0] in ['images','evidence']:
        target=OUT/'rag-assets'/resolved.relative_to(RAG)
    elif within(resolved,RAG) and resolved.suffix in ['.txt','.mmd','.csv']:
        target=OUT/'rag-assets'/resolved.relative_to(RAG)
    elif within(resolved,VALUE) and (resolved.relative_to(VALUE).parts[0] in ['assets','evidence'] or resolved.name in ['study-prompt.txt','image-generation.json']):
        target=OUT/'value-assets'/resolved.relative_to(VALUE)
    elif within(resolved,REPLY) and (resolved.relative_to(REPLY).parts[0] in ['assets','evidence'] or resolved.name in ['reply-prompt.txt','image-generation.json']):
        target=OUT/'reply-assets'/resolved.relative_to(REPLY)
    elif within(resolved,VIDEO) and resolved.relative_to(VIDEO).parts[0] in ['assets','evidence']:
        target=OUT/'video-assets'/resolved.relative_to(VIDEO)
    elif within(resolved,REFRESH) and resolved.relative_to(REFRESH).parts[0] in ['assets','evidence']:
        target=OUT/'report-refresh-assets'/resolved.relative_to(REFRESH)
    elif within(resolved,LATENCY) and (resolved.relative_to(LATENCY).parts[0] in ['assets','evidence'] or resolved.name in ['latency-prompt.txt','image-generation.json']):
        target=OUT/'rag-latency-assets'/resolved.relative_to(LATENCY)
    elif within(resolved,ENTRY) and (resolved.relative_to(ENTRY).parts[0] in ['assets','evidence'] or resolved.name in ['entry-prompt.txt','image-generation.json']):
        target=OUT/'entry-assets'/resolved.relative_to(ENTRY)
    elif within(resolved,RECOVERY) and (resolved.relative_to(RECOVERY).parts[0] in ['assets','evidence'] or resolved.name in ['recovery-prompt.txt','image-generation.json']):
        target=OUT/'recovery-assets'/resolved.relative_to(RECOVERY)
    elif within(resolved,CONTINUITY) and (resolved.relative_to(CONTINUITY).parts[0] in ['assets','evidence'] or resolved.name in ['continuity-prompt.txt','image-generation.json']):
        target=OUT/'continuity-assets'/resolved.relative_to(CONTINUITY)
    elif within(resolved,DELIVERY) and (resolved.relative_to(DELIVERY).parts[0] in ['assets','evidence'] or resolved.name in ['delivery-prompt.txt','image-generation.json']):
        target=OUT/'delivery-assets'/resolved.relative_to(DELIVERY)
    elif within(resolved,CONTAINER) and (resolved.relative_to(CONTAINER).parts[0] in ['assets','evidence'] or resolved.name in ['container-prompt.txt','image-generation.json']):
        target=OUT/'container-assets'/resolved.relative_to(CONTAINER)
    elif resolved.parent == ROOT/'docs/performance-2026-11-03' and resolved.suffix in ['.png','.svg','.csv','.mmd']:
        target=OUT/'performance-assets'/resolved.name
    elif resolved == ROOT/'docs/submission/evaluation-cases.json':
        target=OUT/'report-assets/evidence/evaluation-cases.json'
    else: return None
    if resolved.suffix in ['.json','.jsonl','.txt','.csv','.mmd','.svg']:
        review(resolved.read_text(encoding='utf-8-sig'),resolved)
    target.parent.mkdir(parents=True,exist_ok=True)
    shutil.copy2(resolved,target)
    return '/competition/'+target.relative_to(OUT).as_posix()

class Links(HTMLParser):
    def __init__(self, source):
        super().__init__(convert_charrefs=False)
        self.source=source
        self.parts=[]
    def handle_starttag(self,tag,attrs):
        output=[]
        if tag == 'img':
            names={key for key,_ in attrs}
            attrs=list(attrs)+[(key,value) for key,value in [('loading','lazy'),('decoding','async')] if key not in names]
        for key,value in attrs:
            if key in ['src','href'] and value:
                parsed=urlsplit(value)
                if not parsed.scheme and not parsed.netloc and parsed.path and not parsed.path.startswith('/'):
                    resolved=(self.source.parent/unquote(parsed.path)).resolve()
                    if resolved in PAGES: value='/competition/'+PAGES[resolved]
                    elif resolved == ROOT/'work/cloud-perf/results-k8s/REPORT.md': value='/competition/k8s-measurements.html'
                    elif resolved == ROOT/'docs/delivery/README.md': value='/competition/reproduce.html'
                    elif resolved == ROOT/'public/competition/demo.mp4': value='/competition/demo.mp4'
                    else: value=copy_asset(resolved) or REPO+resolved.relative_to(ROOT).as_posix() if within(resolved,ROOT) else '#'
                    if parsed.fragment: value+='#'+parsed.fragment
            output.append(key if value is None else f'{key}="{escape(value,quote=True)}"')
        self.parts.append('<'+tag+(' '+' '.join(output) if output else '')+'>')
    def handle_startendtag(self,tag,attrs): self.handle_starttag(tag,attrs)
    def handle_endtag(self,tag): self.parts.append('</'+tag+'>')
    def handle_data(self,data): self.parts.append(data)
    def handle_entityref(self,name): self.parts.append('&'+name+';')
    def handle_charref(self,name): self.parts.append('&#'+name+';')

def render(source,text,filename):
    review(text,source)
    text=re.sub(r'(^# [^\n]+\n)',r'\1\n[TOC]\n',text,count=1,flags=re.MULTILINE)
    body=markdown.markdown(text,extensions=['tables','fenced_code','toc'],extension_configs={'toc':{'slugify':lambda text,sep:re.sub(r'\s+',sep,re.sub(r'[^\w\-\s]','',text.lower()))}})
    body=re.sub(r'(<div class="toc">[\s\S]*?</div>)',r'<details><summary>目录 · 点击展开</summary>\1</details>',body,count=1)
    parser=Links(source);parser.feed(body)
    title=re.search(r'<h1[^>]*>(.*?)</h1>',body)
    title=re.sub('<[^>]+>','',title.group(1)) if title else 'Daylight 工程记录'
    stamp='图文与测量记录快照：2026-11-04。测试环境、日期与版本在各节列出，当前体验从上方导航进入。'
    if filename == 'deployment-snapshot.html':
        release=re.search(r'daylight:public-competition-20261103-(v\d+)',text)
        if release: stamp+=f' 此页保存 {release.group(1)} 发布归档。'
    download=''
    if filename == 'technical-report.html':
        title='云原生邮件 Agent 技术与实测报告'
        manifest=json.loads((SUBMISSION/'evidence/report-manifest.json').read_text(encoding='utf-8'))
        download=f'<p><a href="/competition/technical-report.pdf" download="Daylight-Technical-Report-20261104.pdf" style="display:inline-flex;align-items:center;min-height:44px;padding:6px 18px;border-radius:8px;background:#173e30;color:white;text-decoration:none">下载 PDF · {manifest["pages"]} 页 · {manifest["bytes"]/1000000:.1f} MB</a></p>'
        download+='<p class="stamp">报告与 PDF 保存 v14 运行快照。最新补充：<a href="/competition/container-report.html">源码容器构建、真实依赖与只读运行</a> · <a href="/competition/delivery-report.html">最新交付包、逐文件校验与干净安装</a> · <a href="/competition/continuity-report.html">体验进度恢复、步骤二维码与手机继续</a> · <a href="/competition/recovery-report.html">公网数据恢复、故障验证与异机加密副本</a> · <a href="/competition/entry-report.html">公开首屏加载、资源体积与电脑/手机尺寸对照</a> · <a href="/competition/rag-latency-report.html">问答延迟、输出 Token 与费用三轮对照</a>。</p>'
    if filename == 'budget.html':
        download='<p class="stamp">最新累计：文本 84 次、公开价估算 ¥0.516094；图片 16 次。<a href="/competition/container-report.html#7-费用登记">查看新增调用、逐批清单与费用登记</a>。以下保存前批登记快照。</p>'
    html=f'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{escape(title)} · Daylight</title><style>{CSS}</style><nav><a href="/experience">三分钟体验</a><a href="/evidence">技术与实测</a><a href="/competition/report.html">图文总览</a><a href="/competition/reproduce.html">运行与源码</a></nav><main><p class="stamp">{stamp}</p>'+download+''.join(parser.parts)+'</main></html>'
    (OUT/filename).write_text(html,encoding='utf-8')

REPRODUCTION_TEXT='''# 运行与源码

## 在线与隔离体验

[在线七步体验](/experience) · [技术与实测](/evidence) · [图文与实测证据](/competition/report.html) · [分章讲解与同步讲稿](/demo) · [下载 MP4](/competition/demo.mp4)。

## 从交付包启动

源码与交付包通过竞赛提交渠道提供。解压后的 `START-HERE.md` 包含版本和启动步骤，`DELIVERY-MANIFEST.json` 保存源码、构建、说明与验证日志的逐文件摘要。

准备 Node.js ≥22.19 和 npm，先核对随包提供的整个压缩包 SHA-256，再在解压目录执行：

```sh
node scripts/verify-delivery.mjs . --out work/package-integrity.json
npm ci
npm run demo -- --no-build
```

打开 `http://127.0.0.1:3180/experience`，走完创建、冲突、改期、重复、异常、重试与取消；技术页为 `/evidence`，分章视频为 `/demo`，完整工作区在 `/login`，选择「进入演示工作区」。

[交付流程、前后对照与实际安装记录](/competition/delivery-report.html)。

## 容器构建

```sh
npm ci
npm run deploy:check
docker build --build-arg NODE_IMAGE=public.ecr.aws/docker/library/node:22.23.3-bookworm-slim -t daylight:release .
```

[完整源码容器构建、真实依赖、只读运行与原始记录](/competition/container-report.html)。构建使用受版本管理的公开证据快照，修改源证据后执行 `npm run evidence:sync` 再验证。

## 从源码启动

源码仓库：[why121368/Daylight](https://github.com/why121368/Daylight)，分支 `feat/competition-experience-20261103`。仓库访问沿用当前 GitHub 权限，评审源码按参赛提交方式提供。

准备 Node.js ≥22.19 和 npm，在取得源码后执行：

```sh
npm ci
npm run verify
npm run demo -- --no-build --port 3180
```

打开 `http://127.0.0.1:3180/experience` 或 `/evidence`。演示服务使用独立样例数据。

## 容器化部署

准备 Docker 与 Compose v2、openssl、curl，在项目根目录执行：

```sh
sh deploy/up.sh
```

启动后按页面设置邮箱和模型。PostgreSQL、Redis、RabbitMQ、MinIO 与 API/Worker/Scheduler 按项目配置启动。

## 公开业务复查

```sh
node scripts/verify-competition.mjs https://daylight.yunforis.com work/competition-check.json
node scripts/benchmark-experience.mjs https://daylight.yunforis.com work/competition-benchmark.json
```
'''

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--only',action='append',help='Render selected HTML filenames; leave other archived pages as saved.')
    args=parser.parse_args()
    selected=set(args.only or [*PAGES.values(),'reproduce.html'])
    unknown=selected-set(PAGES.values())-{'reproduce.html'}
    if unknown: parser.error('Unknown page: '+', '.join(sorted(unknown)))
    for source,filename in PAGES.items():
        if filename in selected: render(source,source.read_text(encoding='utf-8'),filename)
    if 'reproduce.html' in selected: render(DOCS/'public-reproduction.md',REPRODUCTION_TEXT,'reproduce.html')
    print('PUBLIC_REPORT_PAGES_SAVED',len(selected))

if __name__ == '__main__': main()

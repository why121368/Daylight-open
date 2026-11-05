"""Generate editable SVG figures and publication-ready PNGs from summary.json."""
import json,pathlib,html
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
root=pathlib.Path('docs/performance-2026-11-03')
s=json.loads((root/'summary.json').read_text())
plt.rcParams.update({'font.sans-serif':['Microsoft YaHei','SimHei','DejaVu Sans'],'axes.unicode_minus':False,'font.size':11,'savefig.facecolor':'#f7f9fc'})
colors=['#8392a5','#167d8d']
names=['captcha','workspace','switch_mailbox','attachment','workspace_c4']
labels=['验证码 API\nn=12','工作区两接口\nn=12','切换邮箱及加载\nn=6','附件完整读取\nn=12','四组并发批次\nn=3']
fig,ax=plt.subplots(figsize=(13.5,6.4));fig.patch.set_facecolor('#f7f9fc');ax.set_facecolor('#f7f9fc')
x=np.arange(len(names));width=.32
for i,phase in enumerate(['before','after']):
    values=[s['http'][phase][n]['mean']/1000 for n in names]
    bars=ax.bar(x+(i-.5)*width,values,width,color=colors[i],label=['优化前','优化后'][i],zorder=3)
    for b,v in zip(bars,values):ax.annotate(f'{v:.2f}s',(b.get_x()+b.get_width()/2,v),ha='center',va='bottom',fontsize=10,xytext=(0,4),textcoords='offset points')
ax.set_xticks(x);ax.set_xticklabels(labels);ax.set_ylabel('平均完成耗时（秒，越低越好）');ax.set_ylim(0,21);ax.set_title('同一公网服务器 / 同一账号数据：交互链路前后对比',loc='left',pad=22,fontweight='bold',fontsize=17)
ax.grid(axis='y',alpha=.18,zorder=0);ax.legend(frameon=False)
for edge in ['top','right']: ax.spines[edge].set_visible(False)
fig.text(.08,.015,'2026-11-03 · 2 vCPU / 3499 MiB · HTTPS 服务端探测 · 四组并发统计为整批等待时间，非单请求延迟',fontsize=10,color='#465366')
fig.tight_layout(rect=(0,.05,1,1));fig.savefig(root/'latency-comparison.png',dpi=180);fig.savefig(root/'latency-comparison.svg');plt.close(fig)

fig,axes=plt.subplots(1,3,figsize=(14,5));fig.patch.set_facecolor('#f7f9fc')
panels=[('API 峰值 cgroup 内存','MiB',[s['resources'][p]['api']['peakMemoryMiB'] for p in ['before','after']]),
 ('完整交互脚本 API CPU 时间','CPU 秒',[s['resources'][p]['api']['cpuSec'] for p in ['before','after']]),
 ('三次真实同步 Worker CPU 时间','CPU 秒',[s['resources']['sync-'+p]['worker']['cpuSec'] for p in ['before','after']])]
for ax,(title,unit,vals) in zip(axes,panels):
 ax.set_facecolor('#f7f9fc');bars=ax.bar(['优化前','优化后'],vals,color=colors,width=.55,zorder=3)
 for b,v in zip(bars,vals):ax.text(b.get_x()+b.get_width()/2,v*1.015,f'{v:.1f}',ha='center',va='bottom',fontsize=12)
 ax.set_title(title,pad=16,fontsize=12);ax.set_ylabel(unit);ax.set_ylim(0,max(vals)*1.2);ax.grid(axis='y',alpha=.18)
 for edge in ['top','right']: ax.spines[edge].set_visible(False)
fig.suptitle('减少工作量与内存放大，比单看 CPU 百分比更能解释收益',fontsize=17,fontweight='bold',x=.04,ha='left')
fig.text(.04,.025,'交互窗口约 165s → 30s；同步窗口约 57s → 11s。cgroup 内存含缓存；发布重启、GC、自动同步会影响峰值，非纯算法配对实验。',fontsize=9,color='#465366')
fig.tight_layout(rect=(0,.06,1,.94));fig.savefig(root/'resource-comparison.png',dpi=180);fig.savefig(root/'resource-comparison.svg');plt.close(fig)

def text(x,y,lines,size=18,color='#203044',anchor='middle'):
 return '<text x="%s" y="%s" text-anchor="%s" font-size="%s" fill="%s">%s</text>'%(x,y,anchor,size,color,''.join('<tspan x="%s" dy="%s">%s</tspan>'%(x,0 if i==0 else 25,html.escape(t)) for i,t in enumerate(lines)))
def box(x,y,w,h,lines,fill='#fff',stroke='#c8d3df'):
 return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" fill="{fill}" stroke="{stroke}" stroke-width="2"/>'+text(x+w/2,y+31,lines)
def arrow(points,label=None,lx=0,ly=0,dashed=False):
 return '<polyline points="%s" fill="none" stroke="#63778e" stroke-width="2.3" marker-end="url(#arrow)" %s/>'%(points,'stroke-dasharray="6 5"' if dashed else '')+(text(lx,ly,[label],14) if label else '')
svg='<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="1060" viewBox="0 0 1440 1060"><defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="none" stroke="#63778e"/></marker></defs><rect width="1440" height="1060" fill="#f7f9fc"/><g font-family="Microsoft YaHei, Noto Sans SC, sans-serif">'
svg+=text(60,50,['Daylight｜本轮实际部署与请求边界'],30,anchor='start')
svg+=text(60,83,['单台公网主机 · 2 vCPU / 3499 MiB · Docker Compose · 现有基础设施复用'],17,'#526477',anchor='start')
svg+='<rect x="35" y="275" width="1370" height="690" rx="20" fill="#edf3f8" stroke="#bacbdb" stroke-dasharray="8 5"/>'
svg+=text(60,306,['Docker 网络 / 私有依赖，仅网站入口公开'],16,'#526477',anchor='start')
svg+=box(70,125,410,110,['浏览器 / 微信工作区','路由拆包 · 原文按需读取','空闲轮询 30 秒'],fill='#e2f3ed',stroke='#61a18e')
svg+=box(610,135,360,90,['Caddy HTTPS 入口','GET 压缩 / 哈希资源缓存'],fill='#e4edf9',stroke='#7e9cc3')
svg+=arrow('480,180 610,180')
svg+=box(610,335,360,85,['API 容器','鉴权 / 短请求 / HTTP 202'],fill='#d9eff3',stroke='#318b9c')
svg+=arrow('790,225 790,335')
svg+=box(75,465,330,110,['身份路径','验证码 / 会话 / 用户校验','不加载邮箱与执行历史'])
svg+=box(530,465,350,110,['按用途只读快照','列表 / 原文 / 附件元数据','执行历史独立加载'])
svg+=box(1010,465,330,110,['业务写入 / 可靠任务','完整快照 + CAS + 围栏','提交成功后响应'])
svg+=arrow('700,420 700,443 240,443 240,465')+arrow('790,420 790,445 705,445 705,465')+arrow('880,420 880,443 1175,443 1175,465')
svg+=box(75,635,330,80,['Redis','一次性验证码 / 会话'],fill='#fdeee7',stroke='#c99072')
svg+=box(530,635,350,80,['PostgreSQL 权威状态','业务 / 任务 / 版本 / Outbox'],fill='#e4edf9',stroke='#7e9cc3')
svg+=box(1010,635,330,80,['私有 MinIO / S3','附件字节 · 归属核验后读取'],fill='#ede8f8',stroke='#a391c0')
svg+=arrow('240,575 240,635')+arrow('705,575 705,635','SQL 投影',765,610)
svg+=arrow('405,550 455,550 455,615 580,615 580,635','用户校验',515,600)
svg+=arrow('880,550 975,550 975,610 1175,610 1175,635','附件鉴权后读取',1100,600)
svg+=arrow('1010,535 930,535 930,675 880,675','CAS 写入',948,705)
svg+=box(75,800,330,100,['Scheduler 容器','每分钟检查到期邮箱','600 秒间隔 / 在途屏障'],fill='#fff')
svg+=box(530,800,350,100,['RabbitMQ / Outbox','任务通知与重投','PostgreSQL 保存任务真相'],fill='#fff')
svg+=box(1010,800,330,100,['Worker 容器','IMAP / 模型 / OCR','已完成邮件免逐封快照'],fill='#d9eff3',stroke='#318b9c')
svg+=arrow('405,850 465,850 465,675 530,675')+arrow('705,715 705,800')+arrow('880,850 1010,850')
svg+=arrow('1175,800 1175,745 880,745 880,708','检查点 / 版本 / 租约',1000,765)
svg+=text(60,1006,['实线 = 已运行路径；本轮未新增 K8s、副本或托管云服务。服务拆分已有，本轮缩小读取与同步的工作量。'],17,'#46576b',anchor='start')
svg+='</g></svg>'
(root/'architecture.svg').write_text(svg,encoding='utf-8')
print('FIGURES_OK')

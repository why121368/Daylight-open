"""Rebuild the documented descriptive statistics from committed, redacted samples."""
import json, pathlib, math, statistics, csv, argparse

parser=argparse.ArgumentParser()
parser.add_argument('directory',nargs='?',default='docs/performance-2026-11-03')
args=parser.parse_args()
root=pathlib.Path(args.directory)
def read(name): return json.loads((root/'evidence'/name).read_text(encoding='utf-8'))
def stats(values):
    a=sorted(values)
    return {'n':len(a),'mean':statistics.mean(a),'p50':a[math.ceil(len(a)*.5)-1],'p95':a[math.ceil(len(a)*.95)-1],'min':a[0],'max':a[-1]}
result={'http':{},'sync':{},'browser':{},'resources':{}}
for phase in ['before','after']:
    r=read('perf-'+phase+'.json')
    result['http'][phase]={}
    for name in dict.fromkeys(s['name'] for s in r['samples']):
        samples=[s for s in r['samples'] if s['name']==name]
        requests=[q for s in samples for q in s['requests']]
        result['http'][phase][name]={**stats([s['ms'] for s in samples]),'successfulSamples':sum(s['success'] for s in samples),
          'requestCount':len(requests),'successfulRequests':sum(200<=q['status']<300 for q in requests),
          'meanDecodedBytes':statistics.mean(sum(q['bytes'] for q in s['requests']) for s in samples),
          'successQps':sum(200<=q['status']<300 for q in requests)/(sum(s['ms'] for s in samples)/1000)}
    result['sync'][phase]=stats([s['totalMs'] for s in read('perf-sync-'+phase+'.json')['samples']])
    b=read('perf-browser-'+phase+'.json')
    result['browser'][phase]={action:{**stats([s['ms'] for s in b['samples'] if s['action']==action]),
      'meanTransferBytes':statistics.mean(s['transferBytes'] for s in b['samples'] if s['action']==action),
      'success':sum(s['success'] for s in b['samples'] if s['action']==action)} for action in ['login_captcha','workspace']}
    for kind in ['', 'sync-']:
        rows=[json.loads(line) for line in (root/'evidence'/('perf-'+kind+phase+'-resources.jsonl')).read_text().splitlines()]
        seconds=rows[-1]['time']-rows[0]['time']
        data={'durationSec':seconds,'meanLoad1m':statistics.mean(r['load'][0] for r in rows),
          'minAvailableMiB':min(r['availableKiB'] for r in rows)/1024,'maxSwapMiB':max(r['swapUsedKiB'] for r in rows)/1024}
        for n in rows[0]['containers']:
            cpu=(rows[-1]['containers'][n]['cpuUsec']-rows[0]['containers'][n]['cpuUsec'])/1e6
            data[n]={'cpuSec':cpu,'meanCpuPercentOneCore':cpu/seconds*100,
              'meanMemoryMiB':statistics.mean(r['containers'][n]['memoryBytes'] for r in rows)/1048576,
              'peakMemoryMiB':max(r['containers'][n]['memoryBytes'] for r in rows)/1048576}
        result['resources'][kind+phase]=data
(root/'summary.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
with (root/'comparison.csv').open('w',newline='',encoding='utf-8-sig') as out:
    writer=csv.writer(out);writer.writerow(['group','metric','phase','n','mean_ms','p50_ms','p95_ms','min_ms','max_ms'])
    for group in ['http','browser','sync']:
        for phase in ['before','after']:
            items=result[group][phase] if group!='sync' else {'sync_total':result[group][phase]}
            for name,s in items.items(): writer.writerow([group,name,phase,s['n'],s['mean'],s['p50'],s['p95'],s['min'],s['max']])
print(json.dumps({k:result[k] for k in ['http','sync','browser']},ensure_ascii=False,indent=2))

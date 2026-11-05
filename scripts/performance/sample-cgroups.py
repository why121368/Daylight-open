import pathlib, json, subprocess, time, sys, os
names=['api','worker','postgres','redis','minio','scheduler']
paths={}
for name in names:
    pid=subprocess.check_output(['docker','inspect','--format','{{.State.Pid}}','daylight-'+name+'-1'],text=True).strip()
    rel=pathlib.Path('/proc/'+pid+'/cgroup').read_text().strip().split(':')[-1]
    paths[name]=pathlib.Path('/sys/fs/cgroup'+rel)
with open(sys.argv[1],'w') as out:
    while not pathlib.Path(sys.argv[2]).exists():
        row={'time':time.time(),'load':os.getloadavg(),'containers':{}}
        mem={line.split(':')[0]:int(line.split()[1]) for line in pathlib.Path('/proc/meminfo').read_text().splitlines()}
        row.update(availableKiB=mem['MemAvailable'],swapUsedKiB=mem['SwapTotal']-mem['SwapFree'])
        for name,p in paths.items():
            try:
                cpu={line.split()[0]:int(line.split()[1]) for line in (p/'cpu.stat').read_text().splitlines()}
                row['containers'][name]={'cpuUsec':cpu['usage_usec'],'memoryBytes':int((p/'memory.current').read_text())}
            except: pass
        out.write(json.dumps(row)+'\n');out.flush();time.sleep(1)

import React, { useEffect } from 'react';
import { useWorkbenches } from '@/context/workbenches';

export { matchesWorkbench, workbenchIdsOf } from '@/lib/workbench-match';

export function useWorkbenchOptions() {
  const { data, loading } = useWorkbenches();
  return { workbenches: data?.workbenches || [], loaded: Boolean(data) || !loading };
}

export function WorkbenchFilter({ value, onChange, workbenches, loaded = false }) {
  useEffect(() => {
    if (!loaded) return;
    if (value !== 'all' && value !== 'none' && !workbenches.some((workbench) => workbench.id === value)) onChange('all');
  }, [loaded, value, workbenches, onChange]);
  return (
    <label className="flex min-w-0 max-w-full items-center gap-2 text-sm">
      <span className="shrink-0 text-muted-foreground">工作台</span>
      <select
        className="h-9 min-w-0 max-w-full flex-1 rounded-md border bg-background px-2"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="all">全部</option>
        <option value="none">未归属或工作台已删除</option>
        {workbenches.map((workbench) => (
          <option key={workbench.id} value={workbench.id}>{workbench.name}</option>
        ))}
      </select>
    </label>
  );
}


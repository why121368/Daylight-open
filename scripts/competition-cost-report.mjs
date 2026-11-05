import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'docs/competition-2026-11-04/evidence');
const pricePath = path.join(output, 'official-model-price.json');
const pricing = JSON.parse(fs.readFileSync(pricePath, 'utf8'));
if (pricing.model !== 'deepseek-v4.1-flash' || pricing.inputCnyPerMillion !== 2 || pricing.outputCnyPerMillion !== 8) throw new Error('Review the current public price source before repricing');
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const round = value => Number(value.toFixed(9));
const groups = ['model-preflight', 'model-full'].map(group => {
  const relative = `docs/competition-2026-11-03/evidence/${group}/results.jsonl`;
  const file = path.join(root, relative);
  const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(row => row.type === 'case_result');
  const cases = rows.map(row => {
    const { llm_tokens_in: input, llm_tokens_out: out, llm_tokens_cached_in: cached } = row.metrics;
    if (![input, out, cached].every(value => Number.isFinite(value) && value >= 0) || cached > input) throw new Error(`Incomplete usage: ${row.id}`);
    return { id: row.id, inputTokens: input, cachedInputTokens: cached, outputTokens: out,
      inputCny: round(input * pricing.inputCnyPerMillion / 1e6),
      outputCny: round(out * pricing.outputCnyPerMillion / 1e6),
      estimatedCny: round((input * pricing.inputCnyPerMillion + out * pricing.outputCnyPerMillion) / 1e6) };
  });
  const sum = name => cases.reduce((total, row) => total + row[name], 0);
  const totals = Object.fromEntries(['inputTokens','cachedInputTokens','outputTokens','inputCny','outputCny','estimatedCny'].map(name => [name,round(sum(name))]));
  return { group, source: relative, sha256: digest(file), calls: cases.length, totals,
    meanPerCallCny: round(totals.estimatedCny/cases.length), cases };
});
const full = groups.find(group => group.group === 'model-full');
const report = {
  method: 'public-catalog-estimate', calculatedAt: new Date().toISOString(), currency:'CNY', billingVerified:false,
  source: { ...pricing, evidenceSha256: digest(pricePath) },
  cachedInputTreatment: 'Cached input is included in total input and priced at the listed normal input rate (2 CNY / million). The public card has no separate cache rate.',
  groups, totalCalls: groups.reduce((total, group)=>total+group.calls,0),
  estimatedTotalCny: round(groups.reduce((total, group)=>total+group.totals.estimatedCny,0)),
  workload: { calls:1000, inputTokensPerCall:full.totals.inputTokens/full.calls, outputTokensPerCall:full.totals.outputTokens/full.calls,
    modelCny: round(full.totals.estimatedCny/full.calls*1000), illustrativeMonthlyInfraCny:100,
    illustrativeMonthlyTotalCny:round(100+full.totals.estimatedCny/full.calls*1000) },
};
fs.writeFileSync(path.join(output,'cost-estimate.json'),JSON.stringify(report,null,2)+'\n');
const csv = ['group,id,input_tokens,cached_input_tokens,output_tokens,input_cny,output_cny,estimated_cny',
  ...groups.flatMap(group=>group.cases.map(row=>[group.group,row.id,row.inputTokens,row.cachedInputTokens,row.outputTokens,row.inputCny,row.outputCny,row.estimatedCny].join(',')))].join('\n')+'\n';
fs.writeFileSync(path.join(output,'cost-estimate.csv'),csv);
console.log(JSON.stringify({calls:report.totalCalls,estimatedTotalCny:report.estimatedTotalCny,groups:groups.map(({group,calls,totals})=>({group,calls,totals})),workload:report.workload},null,2));

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { DEMO_ACCOUNT, DEMO_ADMIN } from '../shared/demo-profile.js';

// This script runs only in a fresh directory owned by scripts/demo.mjs.
if (process.env.DAYLIGHT_DEMO !== '1' || process.env.DAYLIGHT_DEMO_GUARDED !== '1'
    || process.env.DAYLIGHT_RUNTIME !== 'local') throw new Error('Use npm run demo to create a fresh isolated demo.');
const directory = path.resolve(process.env.DAYLIGHT_DATA_DIR);
await fs.mkdir(directory, { recursive: true });
if ((await fs.readdir(directory)).length) throw new Error('Demo seeding requires an empty directory; existing data is preserved.');
await fs.writeFile(path.join(directory, 'infra.json'), JSON.stringify({
  postgres: { enabled: false }, redis: { enabled: false }, mq: { enabled: false, provider: 'local' },
  oss: { enabled: false, provider: 'local' }, systemMail: { enabled: false },
  auth: { requireAuth: true, allowLocalDemoLogin: true, jwtSecret: randomBytes(48).toString('hex'), adminEmails: [DEMO_ADMIN.email] },
}));
const { createUser } = await import('../server/infra/postgres.js');
const { runWithRequestContext } = await import('../server/request-context.js');
const { saveSettings, readSettings, readStore, saveStore, dateOffset } = await import('../server/store.js');
const { processEmails } = await import('../server/agent.js');
const { exampleEmails, exampleChanges, exampleTasks, exampleConflicts } = await import('../server/fixtures.js');
const { createTraceRecorder, readTraces, saveTraces } = await import('../server/traces.js');
const { importRecruitmentDemo } = await import('../server/recruitment.js');
const { storeAttachment } = await import('../server/recruitment-store.js');
const { reindexMailboxEmails } = await import('../server/rag/mail-index.js');
const { createWorkbench } = await import('../server/scenarios/service.js');

for (const profile of [DEMO_ACCOUNT, DEMO_ADMIN]) {
  await createUser({ ...profile, passwordHash: await bcrypt.hash(profile.password, 10), role: profile === DEMO_ADMIN ? 'admin' : 'user' });
}
// A second owner exists to make cross-account isolation reproducible without real users.
await createUser({ id: 'demo-other', username: 'demo_other', email: 'other@example.invalid',
  passwordHash: await bcrypt.hash(DEMO_ACCOUNT.password, 10) });
const mainMailbox = { id: 'demo-main', ownerUserId: DEMO_ACCOUNT.id, label: '演示工作邮箱', email: DEMO_ACCOUNT.email,
  provider: 'custom', tag: 'work', authorizationCode: '', imapHost: '', smtpHost: '' };
saveSettings({ apiKey: '', baseUrl: '', model: '', ragEmbeddings: false,
  mailboxes: [mainMailbox, { ...mainMailbox, id: 'demo-personal', label: '演示个人邮箱', email: 'personal@example.invalid', tag: 'personal' },
    { ...mainMailbox, id: 'demo-other-mailbox', ownerUserId: 'demo-other', email: 'other@example.invalid' }],
  activeMailboxId: mainMailbox.id, userPrefs: { [DEMO_ACCOUNT.id]: { activeMailboxId: mainMailbox.id, apiKey: '', baseUrl: '', model: '' } } });

// A small original text PDF is generated from the same fields used in the preset.
// It is a specimen, not a tax document or an OCR/model verification.
function invoicePdf(lines) {
  const escape = value => value.replace(/[\\()]/g, '\\$&');
  const stream = `BT /F1 16 Tf 48 780 Td ${lines.map((line, index) => `${index ? '0 -32 Td ' : ''}(${escape(line)}) Tj`).join('\n')} ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(pdf);
}

const summary = await runWithRequestContext({ userId: DEMO_ACCOUNT.id, user: DEMO_ACCOUNT }, async () => {
  const mailboxId = mainMailbox.id;
  const settings = readSettings();
  const store = readStore(mailboxId);
  const recorder = createTraceRecorder({ settings, traces: readTraces(mailboxId), persist: traces => saveTraces(traces, mailboxId) });
  const extractPreset = async email => ({ summary: email.summary, category: email.category, priority: email.priority,
    events: email.events || [], tasks: email.tasks || [], invoices: email.invoices || [] });
  for (const batch of [exampleEmails(), exampleTasks(), exampleConflicts()]) {
    const result = await processEmails(store, batch, extractPreset, 'demo', { recorder });
    if (result.errors.length) throw new Error(`Demo fixture import failed: ${result.errors[0].message}`);
  }
  const changes = await processEmails(store, exampleChanges(store.events), extractPreset, 'demo', { recorder });
  if (changes.errors.length) throw new Error('Demo reschedule fixture failed.');
  const fields = { invoiceType: '演示票据 · 非税务凭证', invoiceNumber: 'DEMO-000001', invoiceDate: dateOffset(0),
    buyerName: 'Daylight Demo', sellerName: 'Example Cloud', amount: '100.00', taxAmount: '6.00', totalAmount: '106.00', currency: 'CNY',
    notes: '预置字段，未调用 OCR 或模型；请核对原件。', items: [{ name: 'Demo cloud service', quantity: '1', unitPrice: '100.00', amount: '100.00', taxRate: '6%', taxAmount: '6.00' }] };
  const lines = ['DAYLIGHT DEMO SPECIMEN - NOT A TAX INVOICE', `Number: ${fields.invoiceNumber}`, `Date: ${fields.invoiceDate}`,
    'Buyer: Daylight Demo', 'Seller: Example Cloud', 'Item: Demo cloud service', 'Amount: CNY 100.00', 'Tax (6%): CNY 6.00', 'Total: CNY 106.00', 'Preset fields. No OCR or model call.'];
  const attachment = storeAttachment(mailboxId, 'demo:invoice', { filename: 'demo-invoice-specimen.pdf', content: invoicePdf(lines) });
  await processEmails(store, [{ id: 'demo:invoice', subject: '【预置示例】云服务票据待核对', sender: 'Example Cloud <billing@example.invalid>',
    body: '附件是原创演示票据，请对照原件核对。没有真实购买或报销。', receivedAt: new Date().toISOString(),
    summary: '演示云服务票据，价税合计 CNY 106.00，待人工核对。', category: 'invoice', priority: 'normal',
    attachments: [attachment], attachmentTexts: [{ attachmentId: attachment.id, filename: attachment.filename, kind: 'pdf', text: lines.join('\n') }],
    invoices: [{ ...fields, attachmentId: attachment.id }] }], extractPreset, 'demo', { recorder });
  saveStore(store, mailboxId);
  await importRecruitmentDemo(mailboxId);
  const seeded = readStore(mailboxId);
  await reindexMailboxEmails({ mailboxId, emails: seeded.emails, settings: { ...settings, ragEmbeddings: false } });
  for (const templateId of ['recruitment', 'invoices', 'campus-study', 'mail-client']) {
    await createWorkbench({ templateId, mailboxIds: [mailboxId] });
  }
  return { emails: seeded.emails.length, events: seeded.events.length, tasks: seeded.tasks.length,
    invoices: seeded.emails.reduce((sum, email) => sum + (email.invoices?.length || 0), 0), candidates: 3,
    cancelled: seeded.events.filter(event => event.status === 'cancelled').length, preset: true, externalCalls: false };
});
await fs.writeFile(path.join(directory, 'demo-manifest.json'), JSON.stringify({ schema: 1, createdAt: new Date().toISOString(), ...summary }, null, 2));
console.log(JSON.stringify(summary));

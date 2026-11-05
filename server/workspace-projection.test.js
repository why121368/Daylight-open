import test from 'node:test';
import assert from 'node:assert/strict';
import { summaryEmail, workspaceProjection } from './workspace-projection.js';

test('workspace lists retain complete searchable plain text and structured results without sending raw HTML', () => {
  const email = { id: 'mail', body: 'text '.repeat(1500), html: '<img src="data:image/png;base64,large">',
    extraction: { invoices: [{ total: 120 }], events: [{ id: 'event' }] }, attachments: [{ key: 'private/file' }],
    attachmentTexts: ['long extracted file'], attachmentTextErrors: ['failed OCR'] };
  const store = { emails: [email], tasks: [{ id: 'task' }], events: [{ id: 'event' }] };
  const summary = workspaceProjection(store, true);
  assert.equal(summary.emails[0].html, undefined);
  assert.equal(summary.emails[0].attachmentTexts, undefined);
  assert.equal(summary.emails[0].body, email.body);
  assert.deepEqual(summary.emails[0].extraction, email.extraction);
  assert.deepEqual(summary.emails[0].attachments, email.attachments);
  assert.equal(summary.emails[0].detailLoaded, false);
  assert.equal(email.html.includes('base64'), true, 'source data is not mutated');
  assert.equal(workspaceProjection(store, false), store, 'legacy API keeps its complete payload');
  assert.deepEqual(summaryEmail({ id: 'empty' }), { id: 'empty', detailLoaded: false });
});

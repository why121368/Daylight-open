/** Keep list/search fields and structured results; raw content is fetched on open. */
export function summaryEmail(email) {
  const { html, bodyHtml, htmlBody, attachmentTexts, attachmentTextErrors, ...visible } = email;
  return { ...visible, detailLoaded: false };
}

export function workspaceProjection(store, summary) {
  return summary ? { ...store, emails: (store.emails || []).map(summaryEmail) } : store;
}

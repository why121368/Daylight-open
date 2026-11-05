import { fetchAuthorizedBlobUrl } from '@/lib/auth-fetch';

/** Download the authenticated response, never navigate to a private API URL. */
export async function downloadAttachment(url, filename = 'attachment') {
  const result = await fetchAuthorizedBlobUrl(url);
  const anchor = document.createElement('a');
  anchor.href = result.blobUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  if (result.revoke) setTimeout(() => URL.revokeObjectURL(result.blobUrl), 60_000);
}

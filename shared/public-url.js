/** Browser-safe URL rules shared by QR UI and the public QR command. */
export function isPrivateHost(value) {
  const host = String(value || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host || host === 'localhost' || !host.includes('.') && !host.includes(':')) return true;
  if (/(^|\.)(localhost|local|internal|lan|home|test|invalid|example)$/.test(host)
    || host.endsWith('.home.arpa') || /(^|\.)example\.(com|net|org)$/.test(host)) return true;
  // URL normalizes decimal, hex and shortened IPv4 forms before this check.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b, c] = host.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224
      || a === 100 && b >= 64 && b <= 127
      || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31
      || a === 192 && (b === 168 || b === 0 || b === 2)
      || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)
      || a === 203 && b === 0 && c === 113;
  }
  if (host.includes(':')) {
    if (host === '::' || host === '::1' || /^(fc|fd|fe8|fe9|fea|feb)/.test(host)
      || /^(ff|2001:db8:)/.test(host)) return true;
    // IPv4-mapped/compatible addresses and translation prefixes require a probe;
    // don't treat them as shareable public addresses by their printed form.
    if (/^(::|64:ff9b:|64:ff9b:1:)/.test(host)) return true;
  }
  return false;
}

export function inspectShareUrl(value, base) {
  let url;
  try {
    url = base ? new URL(String(value || ''), base) : new URL(String(value || ''));
  } catch {
    return { valid: false, error: '请输入完整的 http:// 或 https:// 地址。' };
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    return { valid: false, error: '分享地址只能使用 HTTP/HTTPS，且不能包含账号或密码。' };
  }
  const parameterKeys = [...url.searchParams.keys()];
  if (url.hash.includes('=')) parameterKeys.push(...new URLSearchParams(url.hash.slice(1)).keys());
  for (const key of parameterKeys) {
    const normalized = key.replace(/[-_]/g, '').toLowerCase();
    if (/(token|secret|password|passwd|authorization|apikey|sessionid|credential|signature)/.test(normalized)
      || ['key', 'auth', 'subscription', 'sig', 'accesskeyid', 'googleaccessid'].includes(normalized)
      || normalized.startsWith('xamz') || normalized.startsWith('xgoog')) {
      return { valid: false, error: '地址包含登录令牌或密钥参数，请改用公开页面地址。' };
    }
  }
  const local = isPrivateHost(url.hostname);
  return {
    valid: true,
    url: url.href,
    local,
    https: url.protocol === 'https:',
    publicCandidate: !local && url.protocol === 'https:',
  };
}

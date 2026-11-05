import { isIP } from 'node:net';

/** Trust only explicitly named proxy addresses. Never infer trust from a hop count. */
export function configureProxyTrust(app, value = process.env.DAYLIGHT_TRUST_PROXY) {
  if (!value?.trim()) return [];
  const proxies = value.split(',').map(item => item.trim());
  for (const proxy of proxies) {
    const [address, prefix, extra] = proxy.split('/'), family = isIP(address);
    if (!family || extra !== undefined || (prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > (family === 4 ? 32 : 128)))) {
      throw new Error('DAYLIGHT_TRUST_PROXY must list explicit proxy IP addresses or non-universal CIDRs, separated by commas.');
    }
  }
  app.set('trust proxy', proxies);
  return proxies;
}

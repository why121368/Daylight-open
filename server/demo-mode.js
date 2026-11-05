import { DEMO_ACCOUNT } from '../shared/demo-profile.js';

export function demoInformation(env = process.env) {
  if (env.DAYLIGHT_DEMO !== '1' || env.DAYLIGHT_RUNTIME === 'production') return { enabled: false };
  return { enabled: true, account: DEMO_ACCOUNT.username, password: DEMO_ACCOUNT.password,
    label: '隔离演示 · 预置结果', externalServices: false };
}

export function assertDemoIsolation(env = process.env) {
  if (env.DAYLIGHT_DEMO !== '1') return;
  if (env.DAYLIGHT_RUNTIME !== 'local' || !['127.0.0.1', '::1', 'localhost'].includes(env.HOST)
      || !env.DAYLIGHT_DATA_DIR || env.DAYLIGHT_DEMO_GUARDED !== '1') {
    throw new Error('The demo requires the isolated launcher: npm run demo. Production and public demo bindings are refused.');
  }
}

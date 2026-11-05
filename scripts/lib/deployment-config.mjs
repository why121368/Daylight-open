/** Literal dotenv parsing: never evaluate or source deployment files as shell code. */
export function parseEnvironment(text) {
  const values = {};
  for (const [index, source] of text.split(/\r?\n/).entries()) {
    const line = source.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) throw new Error(`Invalid environment assignment on line ${index + 1}.`);
    if (Object.hasOwn(values, match[1])) throw new Error(`Duplicate environment key: ${match[1]}.`);
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

const placeholder = value => !value || /replace[-_ ]|REPLACE_ME|change[-_ ]?me|your[-_]domain|example\.(?:com|org|net)|\.invalid(?:[/:]|$)/i.test(value);
const checksFor = () => {
  const checks = [];
  return { checks, add: (key, ok, message) => checks.push({ key, ok: Boolean(ok), message }) };
};
const urlIs = (value, protocols) => {
  try { const url = new URL(value); return protocols.includes(url.protocol) && Boolean(url.hostname); } catch { return false; }
};
export function validateComposeEnvironment(env, { publicAccess = false } = {}) {
  const { checks, add } = checksFor();
  for (const key of ['POSTGRES_PASSWORD', 'REDIS_PASSWORD', 'RABBITMQ_PASSWORD', 'MINIO_ROOT_PASSWORD']) {
    add(key, !placeholder(env[key]) && /^[a-f0-9]{32,}$/i.test(env[key] || ''), 'Use independent random hex secrets (at least 32 characters).');
  }
  const secrets = ['POSTGRES_PASSWORD', 'REDIS_PASSWORD', 'RABBITMQ_PASSWORD', 'MINIO_ROOT_PASSWORD'].map(key => env[key]);
  add('independent-secrets', new Set(secrets).size === secrets.length, 'Each dependency needs an independent secret.');
  add('DAYLIGHT_JWT_SECRET', !placeholder(env.DAYLIGHT_JWT_SECRET) && env.DAYLIGHT_JWT_SECRET?.length >= 48, 'Use at least 48 random characters for JWT.');
  add('MINIO_ROOT_USER', Boolean(env.MINIO_ROOT_USER) && !placeholder(env.MINIO_ROOT_USER), 'Set the object storage user.');
  add('DAYLIGHT_ADMIN_EMAILS', !placeholder(env.DAYLIGHT_ADMIN_EMAILS) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.DAYLIGHT_ADMIN_EMAILS?.split(',')[0] || ''), 'Set your administrator email before bootstrap.');
  if (publicAccess) {
    add('DAYLIGHT_BIND_ADDRESS', !env.DAYLIGHT_BIND_ADDRESS || env.DAYLIGHT_BIND_ADDRESS === '127.0.0.1', 'The API host binding must stay on loopback.');
    add('DAYLIGHT_PUBLIC_HOST', !placeholder(env.DAYLIGHT_PUBLIC_HOST) && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(env.DAYLIGHT_PUBLIC_HOST || ''), 'Use your actual DNS hostname.');
  }
  add('demo-disabled', env.DAYLIGHT_DEMO !== '1' && env.DAYLIGHT_ALLOW_LOCAL_DEMO_LOGIN !== '1' && env.DAYLIGHT_REQUIRE_AUTH !== '0', 'Production authentication must remain enabled.');
  if (env.DAYLIGHT_SYSTEM_MAIL_ENABLED === '1') {
    for (const key of ['DAYLIGHT_SYSTEM_MAIL_HOST', 'DAYLIGHT_SYSTEM_MAIL_USER', 'DAYLIGHT_SYSTEM_MAIL_PASS', 'DAYLIGHT_SYSTEM_MAIL_FROM']) {
      add(key, !placeholder(env[key]), 'System SMTP is enabled; complete this field and verify actual delivery.');
    }
  }
  return checks;
}

export function validateRuntimeEnvironment(env) {
  const { checks, add } = checksFor();
  add('DAYLIGHT_RUNTIME', env.DAYLIGHT_RUNTIME === 'production', 'Set strict production mode explicitly.');
  for (const [key, protocols] of [['DAYLIGHT_DATABASE_URL', ['postgres:', 'postgresql:']], ['DAYLIGHT_REDIS_URL', ['redis:', 'rediss:']], ['DAYLIGHT_AMQP_URL', ['amqp:', 'amqps:']]]) {
    add(key, !placeholder(env[key]) && urlIs(env[key], protocols), 'Provide a real service endpoint using the required protocol.');
  }
  add('DAYLIGHT_JWT_SECRET', !placeholder(env.DAYLIGHT_JWT_SECRET) && env.DAYLIGHT_JWT_SECRET?.length >= 48, 'Use at least 48 random characters for JWT.');
  for (const key of ['DAYLIGHT_OSS_ACCESS_KEY', 'DAYLIGHT_OSS_SECRET_KEY', 'DAYLIGHT_OSS_BUCKET']) add(key, !placeholder(env[key]), 'Set private object storage credentials and bucket.');
  add('DAYLIGHT_OSS_PROVIDER', ['s3', 'us3', 'aliyun', 'qiniu', 'upyun'].includes(env.DAYLIGHT_OSS_PROVIDER), 'Select an implemented provider.');
  add('DAYLIGHT_OSS_ENDPOINT', urlIs(env.DAYLIGHT_OSS_ENDPOINT, ['https:']), 'Use HTTPS for external object storage.');
  add('DAYLIGHT_PUBLIC_BASE_URL', !placeholder(env.DAYLIGHT_PUBLIC_BASE_URL) && urlIs(env.DAYLIGHT_PUBLIC_BASE_URL, ['https:']), 'Use the actual public HTTPS origin.');
  add('demo-disabled', env.DAYLIGHT_DEMO !== '1' && env.DAYLIGHT_ALLOW_LOCAL_DEMO_LOGIN !== '1' && env.DAYLIGHT_REQUIRE_AUTH !== '0', 'Production authentication must remain enabled.');
  if (env.DAYLIGHT_DATABASE_SSL === '1') add('postgres-tls', !/[?&](sslmode=(disable|no-verify)|ssl=false)(?:&|$)/i.test(env.DAYLIGHT_DATABASE_URL || ''), 'PostgreSQL TLS must verify server certificates.');
  return checks;
}

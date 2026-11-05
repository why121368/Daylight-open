/** Child processes used for demonstrations and offline verification never inherit service credentials. */
export function isolatedEnvironment(overrides = {}, source = process.env) {
  const privateKey = /^(DAYLIGHT_|OPENAI_|AZURE_OPENAI_|ANTHROPIC_|SMTP_|IMAP_|MAIL_|DATABASE_URL$|PG[A-Z_]*$|REDIS_|AMQP_|AWS_|OSS_|UCLOUD_|FEISHU_|SLACK_|NODE_OPTIONS$|NODE_TLS_REJECT_UNAUTHORIZED$|PORT$|HOST$|https?_proxy$|all_proxy$|no_proxy$)/i;
  return {
    ...Object.fromEntries(Object.entries(source).filter(([key]) => !privateKey.test(key))),
    DAYLIGHT_RUNTIME: 'local', DAYLIGHT_AUTO_PROXY: '0', DAYLIGHT_METRICS: '0',
    ...overrides,
  };
}

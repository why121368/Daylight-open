/** CNY per million tokens. This is an estimate, never a provider bill. */
export function estimateCost({ messages, inputTokens, outputTokens, cachePercent, inputPrice, outputPrice, cachedInputPrice, monthlyInfra }) {
  const values = [messages, inputTokens, outputTokens, cachePercent, inputPrice, outputPrice, cachedInputPrice, monthlyInfra];
  if (values.some(value => !Number.isFinite(value) || value < 0) || cachePercent > 100) return null;
  const cached = inputTokens * cachePercent / 100;
  const perMessage = ((inputTokens - cached) * inputPrice + cached * cachedInputPrice + outputTokens * outputPrice) / 1_000_000;
  const monthlyModel = perMessage * messages;
  const total = monthlyModel + monthlyInfra;
  if (![perMessage, monthlyModel, total].every(Number.isFinite)) return null;
  return { perMessage, monthlyModel, total };
}

/** "auto" uses the channel's compatible format instead of becoming a wire protocol. */
export function effectiveChannelProtocol(protocol: unknown, apiFormat: unknown): string {
  const explicit = typeof protocol === 'string' ? protocol.trim() : '';
  if (explicit && explicit !== 'auto') return explicit;
  const fallback = typeof apiFormat === 'string' ? apiFormat.trim() : '';
  return fallback && fallback !== 'auto' ? fallback : 'openai';
}

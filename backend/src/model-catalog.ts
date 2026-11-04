/** Derive model availability from saved bindings without changing channel configuration. */
type Json = Record<string, any>;

export function channelReady(channel?: Json): boolean {
  return Boolean(channel?.enabled && (channel.apiKey || channel.advancedConfig?.authMode === 'none'));
}

export function modelReady(model: Json, channels: Json[]): boolean {
  return (model.bindings || []).some((binding: Json) =>
    binding.enabled && channelReady(channels.find(channel => channel.id === binding.channelId)),
  );
}

export function normalizeModelCatalog(input: Json): Json {
  const channels: Json[] = input.systemChannels || [];
  const settings = {
    ...input,
    defaultModels: { ...input.defaultModels },
    logicalModels: (input.logicalModels || []).map((model: Json) => {
      const next: Json = { ...model, bindings: (model.bindings || []).map((binding: Json) => ({ ...binding })) };
      if (!modelReady(next, channels)) {
        next.enabled = false;
        next.availabilityDisabled = true;
      } else if (next.availabilityDisabled) {
        next.enabled = true;
        delete next.availabilityDisabled;
      }
      return next;
    }),
  };
  for (const capability of ['text', 'image', 'video', 'audio']) {
    const key = capability + 'Model';
    const model = settings.logicalModels.find((item: Json) => item.id === settings.defaultModels[key]);
    if (model && !modelReady(model, channels)) settings.defaultModels[key] = '';
  }
  return settings;
}

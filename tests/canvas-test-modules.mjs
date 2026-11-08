/** Real pure modules shared by the canvas hook/component harnesses. */
export function canvasPolicyModules(load) {
  const prompt = load('../lib/studio/prompt-references.ts')
  const references = load('../lib/studio/reference-assets.ts')
  const video = load('../lib/studio/video-policy.ts')
  const policy = load('../components/free-canvas/canvas-generation-policy.ts', {
    '@/lib/studio/prompt-references': prompt, '@/lib/studio/reference-assets': references, '@/lib/studio/video-policy': video,
  })
  return {
    './canvas-workspace': load('../components/free-canvas/canvas-workspace.ts'),
    './canvas-generation-policy': policy, '../canvas-generation-policy': policy,
    '@/lib/studio/team-generation': load('../lib/studio/team-generation.ts'),
    '@/lib/studio/video-policy': video, '@/lib/studio/prompt-references': prompt,
  }
}

export const canvasTestModel = (id = 'image-model', capability = 'image') => ({ id, name: id, shortName: id, capability, status: '可用', capabilities: {
  maxReferences: 15, maxBatchSize: 1, ratios: ['1:1', '16:9'], resolutions: ['1K', '2K'], qualities: capability === 'video' ? ['720'] : ['auto', 'high'], durations: ['4 秒', '6 秒', '8 秒'], firstFrame: true, lastFrame: true,
  videoPolicy: { supportsVideoReference: true, supportsAudioReference: true, frameReferenceTypes: ['image', 'audio'] },
} })

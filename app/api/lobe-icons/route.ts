import { NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ICON_INDEX_URL = 'https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons/'
const ICON_CDN_BASE = 'https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons'
const MAX_RESULTS = 80

type IconFile = { path?: string; type?: string }
type LobeIconIndex = { files?: IconFile[] }

const labels: Record<string, string> = {
  openai: 'OpenAI', claude: 'Claude', anthropic: 'Anthropic', gemini: 'Gemini', google: 'Google',
  deepseek: 'DeepSeek', qwen: 'Qwen', doubao: '豆包', jimeng: '即梦', zhipu: '智谱', moonshot: 'Moonshot',
  minimax: 'MiniMax', mistral: 'Mistral', grok: 'Grok', xai: 'xAI', perplexity: 'Perplexity', cohere: 'Cohere',
  ollama: 'Ollama', azure: 'Azure OpenAI', vertexai: 'Vertex AI', dalle: 'DALL·E', flux: 'FLUX',
  midjourney: 'Midjourney', stability: 'Stable Diffusion', runway: 'Runway', kling: '可灵', sora: 'Sora',
  ideogram: 'Ideogram', bytedance: '字节跳动', 'bytedance-brand': '字节跳动',
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[\s_-]+/g, '')
}

function labelFor(slug: string) {
  return labels[slug] || slug.split('-').map((part) => part ? part[0].toUpperCase() + part.slice(1) : part).join(' ')
}

function slugFromPath(path: string) {
  return path.replace(/^\/icons\//, '').replace(/\.svg$/i, '')
}

async function readIndex() {
  const response = await fetch(ICON_INDEX_URL, { next: { revalidate: 3600 } })
  if (!response.ok) throw new Error(`LobeHub icon index returned ${response.status}`)
  const data = await response.json() as LobeIconIndex
  const files = (data.files || []).filter((file) => file.type === 'file' && typeof file.path === 'string' && file.path.endsWith('.svg'))
  // Prefer the plain icon when the package contains monochrome, text and color variants.
  const slugs = new Set<string>()
  for (const file of files) {
    const slug = slugFromPath(file.path!)
    if (!slug.endsWith('-color') && !slug.endsWith('-text')) slugs.add(slug)
  }
  for (const file of files) {
    const slug = slugFromPath(file.path!)
    if ((slug.endsWith('-color') || slug.endsWith('-text')) && !slugs.has(slug.replace(/-(?:color|text)$/, ''))) slugs.add(slug)
  }
  return [...slugs].sort().map((slug) => ({
    slug,
    label: labelFor(slug),
    aliases: [],
    group: '模型' as const,
    url: `${ICON_CDN_BASE}/${encodeURIComponent(slug)}.svg`,
  }))
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q') || ''
  try {
    const needle = normalize(query)
    const icons = await readIndex()
    const items = needle
      ? icons.filter((item) => normalize(`${item.slug} ${item.label}`).includes(needle))
      : icons
    return Response.json({ items: items.slice(0, MAX_RESULTS), total: items.length, source: 'LobeHub Icons' }, {
      headers: { 'cache-control': 'private, max-age=300, stale-while-revalidate=3600' },
    })
  } catch {
    return Response.json({ items: [], total: 0, source: 'LobeHub Icons', error: '图标库暂时无法连接' }, { status: 502 })
  }
}

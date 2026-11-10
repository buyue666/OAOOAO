import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import * as jsxRuntime from 'react/jsx-runtime'
import ts from 'typescript'

const root = new URL('../', import.meta.url)
const read = async (path) => readFile(new URL(path, root), 'utf8')

const componentCode = ts.transpileModule(await read('components/studio/tools/ai-tryon-tool.tsx'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText

function elements(node) {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!node || typeof node !== 'object' || !node.props) return []
  return [node, ...elements(node.props.children)]
}

function tryOnHarness() {
  const slots = []
  let cursor = 0
  const requests = [], destinations = []
  const model = { id: 'fixture-image', shortName: 'Fixture', capabilities: { ratios: ['2:3'], resolutions: ['1K'], maxBatchSize: 1 } }
  const imports = {
    '../ui': { ModelNote: 'ModelNote' },
    'react': {
      useState(initial) {
        const index = cursor++
        if (!(index in slots)) slots[index] = initial
        return [slots[index], (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }]
      },
      useMemo: (compute) => compute(), useEffect() {},
    },
    'react/jsx-runtime': jsxRuntime,
    'lucide-react': {},
    'next/navigation': { useRouter: () => ({ push: (path) => destinations.push(path) }) },
    '@/lib/studio/store': { useStudio: () => ({ state: { liveModels: [model] }, estimateCredits: () => 1 }) },
    '@/lib/studio/generation-store': { useGeneration: () => ({ createImage: async (input) => { requests.push(input); return { id: 'fixture-task' } } }) },
    '@/lib/studio/studio-models': { filterModelsByCapability: () => [model], imageQualityOptions: () => ['auto'], qualityLabel: (quality) => quality },
    '@/lib/studio/generation-api': {}, '@/lib/studio/account-api': {},
    '@/lib/studio/use-account-data': { useLibraryAssets: () => ({ assets: [], state: 'ready', reload: async () => {} }) },
    '@/lib/studio/reference-assets': {}, '@/lib/utils': { cn: (...classes) => classes.filter(Boolean).join(' ') },
  }
  const exports = {}
  new Function('require', 'exports', componentCode)((name) => {
    if (!(name in imports)) throw new Error(`Unexpected runtime dependency: ${name}`)
    return imports[name]
  }, exports)
  const tool = exports.default
  const render = () => { cursor = 0; return elements(tool()) }
  const field = (id) => render().find((node) => node.props['data-testid'] === id)
  const selectReferences = () => {
    for (const [label, id] of [['模特', 'person'], ['服装', 'garment']]) {
      render().find((node) => node.props.label === label).props.onSelect({ id, title: id, url: `/api/generation-assets/fixture/${id}.png` })
    }
    render().find((node) => node.type === 'select').props.onChange({ target: { value: model.id } })
  }
  return { render, field, selectReferences, requests, destinations }
}

test('try-on hides presets by default and allows submitting without supplementary instructions', async () => {
  const h = tryOnHarness()
  assert.equal(h.field('ai-tryon-preset').type, 'details')
  assert.ok(!h.field('ai-tryon-preset').props.open)
  assert.equal(h.field('ai-tryon-requirements').props.value, '')
  assert.match(h.field('ai-tryon-preset-prompt').props.value, /Dress the person/)
  h.selectReferences()
  assert.equal(h.field('ai-tryon-submit').props.disabled, false)
  h.field('ai-tryon-submit').props.onClick()
  await new Promise(setImmediate)
  assert.equal(h.requests.length, 1)
  assert.match(h.requests[0].prompt, /Keep the person's identity/)
  assert.match(h.requests[0].prompt, /Reference 1 is the person\. Reference 2 is the garment\.$/)
  assert.deepEqual(h.requests[0].references.map((reference) => reference.name), ['person', 'garment'])
  assert.deepEqual(h.destinations, ['/works'])
})

test('try-on combines edited presets and supplementary instructions without replacing the preset', async () => {
  const h = tryOnHarness()
  h.selectReferences()
  const preset = h.field('ai-tryon-preset-prompt').props.value + ' Keep the original framing.'
  h.field('ai-tryon-preset-prompt').props.onChange({ target: { value: preset } })
  h.field('ai-tryon-requirements').props.onChange({ target: { value: '  衣服更合身  ' } })
  h.field('ai-tryon-submit').props.onClick()
  await new Promise(setImmediate)
  assert.equal(h.requests.length, 1)
  assert.equal(h.requests[0].prompt, `${preset}\n\n衣服更合身\n\nReference 1 is the person. Reference 2 is the garment.`)
  assert.equal(h.field('ai-tryon-requirements').props.value, '  衣服更合身  ')
})

test('image remix tool is reachable from the protected studio shell', async () => {
  const [page, component, shell, nav] = await Promise.all([
    read('app/tools/page.tsx'), read('components/studio/tools/image-remix-tool.tsx'), read('components/studio/studio-app.tsx'), read('components/studio/studio-nav.tsx'),
  ])
  assert.match(page, /PluginCenter/)
  assert.match(await read('app/tools/[tool]/page.tsx'), /ToolsPage/)
  assert.match(component, /data-testid="image-remix-tool"/)
  assert.match(component, /data-testid="image-remix-collapse"/)
  assert.match(nav, /href: '\/tools'/)
  assert.match(shell, /pathname === '\/tools'/)
})

test('image remix source uses private uploads and the existing task pipeline', async () => {
  const component = await read('components/studio/tools/image-remix-tool.tsx')
  assert.match(component, /uploadPersistentAsset\(file, 'image'\)/)
  assert.match(component, /generation\.createText/)
  assert.match(component, /generation\.createImage/)
  assert.match(component, /kind: 'edit'/)
  assert.match(component, /references:/)
})

test('creative tools expose an AI try-on workflow with library sources', async () => {
  const [component, references, backend] = await Promise.all([read('components/studio/tools/ai-tryon-tool.tsx'), read('lib/studio/reference-assets.ts'), read('backend/src/creative.ts')])
  assert.match(component, /data-testid="ai-tryon-tool"/)
  assert.match(await read('components/studio/tools-page.tsx'), /data-testid="creative-tools-collapse"/)
  assert.match(await read('components/studio/tools-page.tsx'), /data-testid="tool-ai-tryon"/)
  assert.match(component, /useLibraryAssets\(\{ kind: 'image'/)
  assert.match(component, /createLibraryAsset\(/)
  assert.match(component, /title: 'AI换装'/)
  assert.match(component, /Reference 1 is the person/)
  assert.match(component, /role: 'reference'/)
  assert.match(component, /生成模特/)
  assert.match(component, /assetRole: role === 'person' \? 'character' : 'garment'/)
  assert.match(component, /personSources/)
  assert.match(component, /garmentSources/)
  assert.match(component, /estimateCredits\(imageModel/)
  assert.match(component, /预计消耗/)
  assert.match(references, /garment: '服装'/)
  assert.match(backend, /'garment'/)
})

test('vision messages accept only owned media paths server side', async () => {
  const creative = await read('backend/src/creative.ts')
  const providers = await read('backend/src/providers.ts')
  assert.match(creative, /Image analysis only accepts an owned media URL/)
  assert.match(creative, /Unsupported image analysis asset/)
  assert.match(providers, /providerTextMessages/)
  assert.match(providers, /data:\$\{ref\.mimeType\};base64/)
})


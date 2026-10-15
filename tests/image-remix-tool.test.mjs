import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const read = async (path) => readFile(new URL(path, root), 'utf8')

test('image remix tool is reachable from the protected studio shell', async () => {
  const [page, component, shell, nav] = await Promise.all([
    read('app/tools/page.tsx'), read('components/studio/tools-page.tsx'), read('components/studio/studio-app.tsx'), read('components/studio/studio-nav.tsx'),
  ])
  assert.match(page, /ToolsPage/)
  assert.match(component, /data-testid="image-remix-tool"/)
  assert.match(component, /data-testid="image-remix-collapse"/)
  assert.match(nav, /href: '\/tools'/)
  assert.match(shell, /pathname === '\/tools'/)
})

test('image remix source uses private uploads and the existing task pipeline', async () => {
  const component = await read('components/studio/tools-page.tsx')
  assert.match(component, /uploadPersistentAsset\(file, 'image'\)/)
  assert.match(component, /generation\.createText/)
  assert.match(component, /generation\.createImage/)
  assert.match(component, /kind: 'edit'/)
  assert.match(component, /references:/)
})

test('vision messages accept only owned media paths server side', async () => {
  const creative = await read('backend/src/creative.ts')
  const providers = await read('backend/src/providers.ts')
  assert.match(creative, /Image analysis only accepts an owned media URL/)
  assert.match(creative, /Unsupported image analysis asset/)
  assert.match(providers, /providerTextMessages/)
  assert.match(providers, /data:\$\{ref\.mimeType\};base64/)
})


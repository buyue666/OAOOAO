import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function compile(source, dependencies = {}) {
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} }
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, { Error })(name => {
    assert.ok(name in dependencies, `Unexpected import ${name}`)
    return dependencies[name]
  }, module, module.exports)
  return module.exports
}
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const plain = value => JSON.parse(JSON.stringify(value))
const asset = (id, kind) => ({ id, kind, title: id, createdAt: '2026-10-14T00:00:00Z' })

test('personal defaults select a logical models request alias and save explicit user changes', async () => {
  const calls=[],state={user:{id:'synthetic-user'},backendStatus:'connected',liveModels:[{id:'image-route',name:'图片',capability:'image'},{id:'other-route',name:'另一图片',capability:'image'}],sessionSettings:{defaultModels:{imageModel:'logical-image'},logicalModels:[{id:'logical-image',capability:'image',bindings:[{enabled:true,requestAlias:'image-route'}]}]}}
  const api=compile(read('../components/studio/account-model-defaults.tsx'),{
    react:{useState:value=>[value,()=>{}],useRef:value=>({current:value}),useEffect(){}},'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},'lucide-react':{Check:'Check',LoaderCircle:'Loader'},
    '@/lib/studio/api':{request:async(path,options)=>calls.push([path,JSON.parse(options.body)])},'@/lib/studio/store':{useStudio:()=>({state,refreshSession:async()=>{}})},'./model-icon':{ModelIcon:'ModelIcon'},'./ui':{ModelNote:'ModelNote',Notice:'Notice',SectionHeading:'Heading'},'@/lib/utils':{cn:(...values)=>values.filter(Boolean).join(' ')},
  })
  const all=node=>node&&typeof node==='object'?[node,...[node.props?.children].flat(Infinity).flatMap(all)]:[]
  const tree=all(api.AccountModelDefaults()),radios=tree.filter(node=>node.type==='input'&&node.props.type==='radio')
  assert.equal(radios[0].props.checked,true);assert.equal(radios[1].props.checked,false)
  await radios[1].props.onChange();await new Promise(resolve=>setImmediate(resolve))
  assert.deepEqual(plain(calls),[['/api/account/model-defaults',{imageModel:'other-route'}]])
})

test('media library excludes skills at the request boundary and continues every media page', async () => {
  const records = [...Array.from({ length: 130 }, (_, n) => asset(`skill-${n}`, 'text')), ...Array.from({ length: 62 }, (_, n) => asset(`image-${n}`, 'image')), asset('video', 'video'), asset('audio', 'audio')]
  const requests = []
  const pages = new Map()
  const useLibraryAssets = ({ kind, pageSize }) => {
    if (!pages.has(kind)) {
      requests.push({ kind, page: 1, pageSize })
      const matches = records.filter(item => item.kind === kind)
      const page = { assets: matches.slice(0, pageSize), total: matches.length, page: 1, pageSize, state: 'ready', message: '', loadingMore: false, hasMore: matches.length > pageSize,
        reload: async () => {}, loadMore: async () => { requests.push({ kind, page: ++page.page, pageSize }); page.assets = matches.slice(0, page.page * pageSize); page.hasMore = page.assets.length < page.total },
      }
      pages.set(kind, page)
    }
    return pages.get(kind)
  }
  const api = compile(read('../lib/studio/use-media-library.ts'), { react: { useRef: value => ({ current: value }) }, './use-account-data': { useLibraryAssets } })
  let result = api.useMediaLibrary()
  assert.deepEqual(requests.map(item => item.kind), ['image', 'video', 'audio'])
  assert.equal(result.total, 64); assert.equal(result.assets.length, 62); assert.equal(result.hasMore, true)
  assert.equal(result.assets.some(item => item.kind === 'text'), false)
  await result.loadMore()
  result = api.useMediaLibrary()
  assert.equal(result.assets.length, 64); assert.equal(result.hasMore, false); assert.equal(result.totalKnown, true)
  assert.deepEqual(requests.at(-1), { kind: 'image', page: 2, pageSize: 60 })
  assert.deepEqual(plain(result.assets.map(item => item.id).sort()), records.filter(item => item.kind !== 'text').map(item => item.id).sort())
})

test('media page failures do not claim an exact zero or conceal pagination errors', async () => {
  const api = compile(read('../lib/studio/use-media-library.ts'), { react: { useRef: value => ({ current: value }) }, './use-account-data': {} })
  const ready = { assets: [asset('image', 'image')], total: 1, state: 'ready', message: '', hasMore: false, loadingMore: false }
  const failed = { ...ready, assets: [], total: 0, state: 'error', message: 'Synthetic unavailable' }
  const result = api.mediaLibrarySummary([ready, failed])
  assert.equal(result.state, 'error'); assert.equal(result.totalKnown, false); assert.equal(result.assets.length, 1)
  assert.equal(result.message, 'Synthetic unavailable')
  const moreError = api.mediaLibrarySummary([{ ...ready, total: 2, hasMore: true, message: 'Next page failed' }])
  assert.equal(moreError.hasMore, true); assert.equal(moreError.message, 'Next page failed')
})

test('rapid media pagination clicks start only one request per source', async () => {
  let finish
  let calls = 0
  const waiting = new Promise(resolve => { finish = resolve })
  const source = { assets: [], total: 1, state: 'ready', message: '', hasMore: true, loadingMore: false, loadMore: async () => { calls++; await waiting } }
  const api = compile(read('../lib/studio/use-media-library.ts'), { react: { useRef: value => ({ current: value }) }, './use-account-data': { useLibraryAssets: () => source } })
  const result = api.useMediaLibrary()
  const first = result.loadMore(); await result.loadMore()
  assert.equal(calls, 3); finish(); await first
})

const storageHelpers = compile(read('../lib/studio/object-storage-status.ts'))
const savedStorage = { enabled: false, endpoint: 'https://storage.example', region: 'region', bucket: 'bucket', prefix: 'existing/prefix', forcePathStyle: true, hasAccessKeyId: true, hasSecretAccessKey: true }

test('storage enables the implemented writer only on explicit save and preserves saved secrets', () => {
  const existing = { ...savedStorage, enabled: true }
  assert.equal(storageHelpers.storageUpdateInput(existing, '', '').enabled,true)
  assert.equal(existing.enabled, true)
  const input = storageHelpers.storageUpdateInput(savedStorage, '', '')
  assert.deepEqual(plain(input), { provider:'s3', enabled: false, endpoint: savedStorage.endpoint, region: 'region', bucket: 'bucket', prefix: 'existing/prefix', forcePathStyle: true })
  assert.equal('accessKeyId' in input, false); assert.equal('secretAccessKey' in input, false)
  assert.equal(storageHelpers.storageUpdateInput(savedStorage, 'new-id', 'new-secret').secretAccessKey, 'new-secret')
})

test('bucket tests distinguish unverified, verified, missing and failed write evidence', () => {
  assert.match(storageHelpers.storageTestMessage({ code: 0, data: { ok: true, bucketAccessible: true, writeVerified: false } }), /可访问；未验证写入权限/)
  assert.match(storageHelpers.storageTestMessage({ ok: true, bucketAccessible: true, writeVerified: true }), /服务端报告写入已验证/)
  assert.match(storageHelpers.storageTestMessage({ ok: true, bucketAccessible: true }), /未返回写入验证状态/)
  for (const value of [null, { code: 2, data: { ok: true, bucketAccessible: true } }, { ok: true }, { ok: false, bucketAccessible: true }]) {
    assert.throws(() => storageHelpers.storageTestMessage(value), /未确认/)
  }
  assert.throws(() => storageHelpers.assertStorageSaved({ code: 0, data: {} }, savedStorage), /未确认/)
  storageHelpers.assertStorageSaved({ code: 0, data: savedStorage }, savedStorage)
  for (const code of ['error', '500', '0', null, {}, undefined]) {
    assert.throws(() => storageHelpers.storageTestMessage({ code, data: { ok: true, bucketAccessible: true, writeVerified: true } }), /未确认/)
    assert.throws(() => storageHelpers.assertStorageSaved({ code, data: savedStorage }, savedStorage), /未确认/)
  }
})

function storageFixture(initial, { badAck = false, testResult = { code: 0, data: { ok: true, bucketAccessible: true, writeVerified: false } } } = {}) {
  const state = []; let cursor = 0
  const refs = []; let refCursor = 0
  const react = {
    useState: value => { const index = cursor++; if (!(index in state)) state[index] = value; return [state[index], next => { state[index] = typeof next === 'function' ? next(state[index]) : next }] },
    useRef: value => { const index = refCursor++; return refs[index] ??= { current: value } },
    useEffect: () => {},
  }
  const messages = [], errors = [], writes = []
  let tests = 0, reloads = 0
  const full = ts.createSourceFile('settings.tsx', read('../components/studio/admin-settings.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declaration = full.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'StorageSection')
  assert.ok(declaration)
  const imports = `import { useState, useRef, useEffect } from 'react'; import { assertStorageSaved, CREATIVE_STORAGE_NOTICE, storageTestMessage, storageUpdateInput } from './helpers'; import { updateObjectStorage, testObjectStorage } from './api'; import { AdminEmpty, AdminNotice, AdminSectionCard, StatusBadge, AdminField, AdminInput, AdminSelect, ControlButton, Cloud, Save } from './ui';`
  const controls = Object.fromEntries(['AdminEmpty', 'AdminNotice', 'AdminSectionCard', 'StatusBadge', 'AdminField', 'AdminInput', 'AdminSelect', 'ControlButton', 'Cloud', 'Save'].map(name => [name, name]))
  const api = compile(imports + '\nexport ' + declaration.getText(full), {
    react, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }, './helpers': storageHelpers, './ui': controls,
    './api': { updateObjectStorage: async input => { writes.push(input); return badAck ? { code: 0, data: {} } : { code: 0, data: input } }, testObjectStorage: async () => { tests++; return testResult } },
  })
  const render = () => { cursor = 0; refCursor = 0; return api.StorageSection({ storage: initial, onMessage: value => messages.push(value), onError: value => errors.push(value), onReload: () => { reloads++ } }) }
  function all(node) { return node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(all)] : [] }
  const find = predicate => all(render()).find(predicate)
  const button = label => find(node => node.type === 'ControlButton' && JSON.stringify(node.props.children).includes(label))
  return { writes, messages, errors, button, find, tests: () => tests, reloads: () => reloads }
}

test('actual settings handlers support explicit enable and disable with confirmed saves and preserved keys', async () => {
  const f = storageFixture({ ...savedStorage, enabled: true })
  assert.equal(f.writes.length, 0)
  const checkbox = f.find(node => node.type === 'input' && node.props.type === 'checkbox')
  assert.equal(checkbox.props.checked, true)
  await f.button('保存存储配置').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].enabled,true)
  checkbox.props.onChange({ target: { checked: false } })
  await f.button('保存存储配置').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.writes.length, 2); assert.equal(f.writes[1].enabled, false)
  assert.equal('accessKeyId' in f.writes[0], false); assert.equal('secretAccessKey' in f.writes[0], false)
  assert.equal(f.reloads(), 2); assert.match(f.messages.at(-1), /新素材继续使用服务器存储/)
})

test('actual settings detector cannot turn HeadBucket into a write-success message', async () => {
  const f = storageFixture({ ...savedStorage, enabled: true })
  await f.button('检测上传、读取与删除').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.tests(), 1); assert.equal(f.writes.length, 0)
  assert.match(f.messages.at(-1), /未验证写入权限/)
  assert.equal(storageFixture(savedStorage).button('检测上传、读取与删除').props.disabled, false)
  const verified=storageFixture(savedStorage,{testResult:{code:0,data:{ok:true,bucketAccessible:true,writeVerified:true,readVerified:true,deleteVerified:true}}})
  await verified.button('检测上传、读取与删除').props.onClick();await new Promise(resolve=>setImmediate(resolve));assert.match(verified.messages.at(-1),/上传、读取和删除检测均通过/)
  const missing = storageFixture(savedStorage, { badAck: true })
  await missing.button('保存存储配置').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(missing.reloads(), 0); assert.match(missing.errors.at(-1), /未确认存储配置保存/)
  assert.equal(missing.messages.some(value => value.includes('配置已保存')), false)
})

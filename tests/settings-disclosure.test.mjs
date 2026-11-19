import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as runtime from 'react/jsx-runtime'

const elements = node => Array.isArray(node) ? node.flatMap(elements) : node && typeof node === 'object' && node.props ? [node, ...elements(node.props.children)] : []
test('settings sections toggle independently, keep content and recover the saved collapse state', () => {
  const storage = new Map(), slots = [], effects = []
  let cursor = 0
  const exports = {}
  const source = readFileSync(new URL('../components/studio/settings-disclosure.tsx', import.meta.url), 'utf8')
  new Function('exports', 'require', 'localStorage', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText)(exports, name => ({
    react: { useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = value; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next }] }, useId: () => `section-${cursor}`, useEffect: effect => effects.push(effect) },
    'react/jsx-runtime': runtime, 'lucide-react': { ChevronDown: 'ChevronDown' },
  })[name], { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) })
  const render = () => { cursor = 0; return ['appearance', 'models'].map(id => elements(exports.SettingsDisclosure({ id, title: id, summary: 'summary', children: runtime.jsx('input', { defaultValue: 'kept' }) }))) }
  let panels = render(); effects.splice(0).forEach(effect => effect())
  assert.equal(panels[0].find(n => n.type === 'button').props['aria-expanded'], false)
  assert.equal(panels[1].find(n => n.props.id).props.hidden, true)
  panels[0].find(n => n.type === 'button').props.onClick(); panels = render()
  assert.equal(panels[0].find(n => n.type === 'button').props['aria-expanded'], true)
  assert.equal(panels[1].find(n => n.type === 'button').props['aria-expanded'], false)
  assert.ok(panels[0].some(n => n.type === 'input'))
  assert.equal(storage.get('oao-settings-section:appearance'), 'open')
  slots.length = 0; effects.length = 0; render(); effects.splice(0).forEach(effect => effect()); panels = render()
  assert.equal(panels[0].find(n => n.type === 'button').props['aria-expanded'], true)
  assert.equal(panels[1].find(n => n.type === 'button').props['aria-expanded'], false)
})

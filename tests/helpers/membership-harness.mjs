import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
export function compile(path, imports = {}) {
  const code = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const exports = {}
  new Function('require', 'exports', code)(name => { assert.ok(name in imports, `Unexpected import ${name}`); return imports[name] }, exports)
  return exports
}
const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' }
const styles = { default: new Proxy({}, { get: (_, key) => key }) }
const button = { Button: 'Button' }
const common = { 'react/jsx-runtime': jsx, '@/components/ui/button': button, './membership.module.css': styles }
export const membership = compile('lib/studio/membership.ts')
export const drafts = compile('lib/studio/product-draft.ts')
const policy = compile('lib/studio/commerce-policy.ts')
const benefits = compile('components/membership/benefits.ts')
const helpers = compile('components/membership/purchase-helpers.ts', { '@/lib/studio/membership': membership })
export const card = compile('components/membership/plan-card.tsx', { ...common, '@/lib/studio/membership': membership, './benefits': benefits, './purchase-helpers': helpers }).PlanCard
const review = compile('components/membership/purchase-confirmation.tsx', {
  ...common, '@/lib/studio/membership': membership, '@/lib/studio/commerce-policy': policy, './purchase-helpers': helpers,
  '@/components/ui/dialog': Object.fromEntries(['Dialog', 'DialogContent', 'DialogDescription', 'DialogHeader', 'DialogTitle'].map(name => [name, name])),
})
export const confirmation = review.PurchaseConfirmation

// Execute the production component with persistent hook state. Leaf UI primitives
// are inert so tests exercise catalog selection and purchase events without HTTP.
export function viewHarness(props) {
  const slots = []; let cursor = 0
  const react = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }] },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index] },
  }
  const view = compile('components/membership/membership-purchase-view.tsx', { ...common, react, './benefits': benefits, './purchase-helpers': helpers, './purchase-confirmation': review, './plan-card': { PlanCard: card } }).MembershipPurchaseView
  const input = { generationColumns: [], generationRows: [], faqItems: [], products: [], billingOptions: membership.billingOptions, onSelectPlan() {}, onClose() {}, ...props }
  return { input, render() { cursor = 0; return view(input) } }
}
export const view = props => viewHarness(props).render()
export const all = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(all)] : []
export const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : node && typeof node === 'object' ? [node.props?.children].flat(Infinity).map(text).join('') : ''

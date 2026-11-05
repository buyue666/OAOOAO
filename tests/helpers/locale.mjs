import {readFileSync} from 'node:fs'
import ts from 'typescript'

const compile = (path, imports = {}) => {
  const source = readFileSync(new URL('../../' + path, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText
  const module = {exports: {}}
  new Function('require', 'module', 'exports', code)(name => {if (!(name in imports)) throw new Error('Unexpected locale import: ' + name); return imports[name]}, module, module.exports)
  return module.exports
}
export const messages = compile('lib/studio/studio-messages.ts')
export const {translateUiText} = compile('lib/studio/ui-translation.ts', {'./studio-messages': messages})
export const chineseText = (source, values) => translateUiText('zh-CN', source, values)
export const englishText = (source, values) => translateUiText('en-US', source, values)
export const chineseLocale = {useUiText: () => chineseText}
export const englishLocale = {useUiText: () => englishText}
export {compile as compileLocaleModule}

import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import React from 'react'
import * as jsx from 'react/jsx-runtime'
import {renderToStaticMarkup} from 'react-dom/server'
import ts from 'typescript'
import {englishLocale} from './helpers/locale.mjs'

function load(path,imports={}){
  const source=readFileSync(new URL('../'+path,import.meta.url),'utf8')
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText
  const module={exports:{}};new Function('require','module','exports',code)(name=>{assert.ok(name in imports,name);return imports[name]},module,module.exports);return module.exports
}
const leaf=({children,role,className,...props})=>React.createElement('span',{role,className,'data-tooltip-content':props['data-tooltip-content']},children)
const imports={react:React,'react/jsx-runtime':jsx,'react-dom':{createPortal:node=>node},'lucide-react':new Proxy({},{get:()=>()=>null}),'radix-ui':{Tooltip:{Provider:leaf,Root:leaf,Trigger:leaf,Portal:leaf,Content:leaf}},'@/lib/utils':{cn:(...items)=>items.filter(Boolean).join(' ')},'@/lib/studio/i18n':englishLocale}
const ui=load('components/studio/ui.tsx',imports)
const html=(type,props)=>renderToStaticMarkup(React.createElement(type,props))

test('model notes are inherited by every request entry and whitespace notes stay absent',()=>{
  const {modelsFromSession}=load('lib/studio/studio-models.ts')
  const model={id:'synthetic',name:'Synthetic',capability:'video',enabled:true,note:'  使用说明\n参考图片  ',bindings:[{id:'a',channelId:'a',upstreamModel:'synthetic',enabled:true,requestAlias:'entry-a'},{id:'b',channelId:'b',upstreamModel:'synthetic',enabled:true,requestAlias:'entry-b'}]}
  const models=modelsFromSession({logicalModels:[model]});assert.equal(models.length,2);assert.ok(models.every(item=>item.note==='使用说明\n参考图片'))
  model.note=' \n ';assert.ok(modelsFromSession({logicalModels:[model]}).every(item=>item.note===undefined))
})

test('only nonempty notes show a focusable hint, preserve literal text and never become HTML',()=>{
  for(const note of [undefined,'',' \n '])assert.equal(html(ui.ModelNote,{note}),'')
  const result=html(ui.ModelNote,{note:'参考图片\n<b>public note</b>'})
  assert.match(result,/data-model-note/);assert.match(result,/aria-label="Model note"/);assert.match(result,/role="tooltip"/)
  assert.ok(result.includes('参考图片\n&lt;b&gt;public note&lt;/b&gt;'));assert.ok(result.includes('z-[250]'));assert.ok(result.includes('whitespace-pre-wrap'))
  assert.doesNotMatch(result,/<b>public note/)
  let prevented=false,stopped=false;const node=ui.ModelNote({note:'help'}).props.children
  node.props.onClick({preventDefault(){prevented=true},stopPropagation(){stopped=true}})
  assert.ok(prevented&&stopped,'hint activation must not select a model or toggle its dropdown')
})

test('selected and dropdown models show only their own notes with no nested buttons',()=>{
  const options=[{value:'one',label:'Model one',note:'First note'},{value:'two',label:'Model two'}]
  const selected=html(ui.SelectField,{label:'视频模型',value:'one',onChange(){assert.fail('render changed selection')},options})
  assert.equal((selected.match(/data-model-note/g)||[]).length,1)
  assert.doesNotMatch(selected.match(/<button[^>]+aria-haspopup="listbox"[\s\S]*?<\/button>/)?.[0]||'',/data-model-note/)
  assert.doesNotMatch(html(ui.SelectField,{value:'two',onChange(){},options}),/data-model-note/)
  const oldDocument=globalThis.document;globalThis.document={body:{}}
  try{
    const openUi=load('components/studio/ui.tsx',{...imports,react:{...React,useState:initial=>[initial===false?true:initial===null?{top:0,left:0,width:360,maxHeight:200}:initial,()=>{}]}})
    const menu=html(openUi.SelectField,{value:'one',onChange(){},options})
    assert.match(menu,/role="option"[^>]+aria-description="First note"/)
    assert.equal((menu.match(/data-model-note/g)||[]).length,2)
    for(const row of menu.matchAll(/<button[^>]*role="option"[^>]*>([\s\S]*?)<\/button>/g))assert.doesNotMatch(row[1],/<button/)
  }finally{globalThis.document=oldDocument}
})

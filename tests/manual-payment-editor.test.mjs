import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
const source=readFileSync(new URL('../lib/studio/payment-provider-config.ts',import.meta.url),'utf8')
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const api={};new Function('exports',code)(api)
const provider={id:'ciyuan_balance',name:'New API 余额支付',checkoutKind:'redirect',enabled:true,ready:true,fields:[
  {key:'gatewayUrl',kind:'url',label:'网站地址',required:true,secret:false,configured:true,value:'https://gateway.example/'},
  {key:'merchantId',kind:'text',label:'商户标识',required:true,secret:false,configured:true,value:'oaooao'},
  {key:'secret',kind:'secret',label:'商户签名密钥',required:true,secret:true,configured:true},
]}
test('New API configuration preserves existing credentials and rejects retired manual collection',()=>{
  assert.equal(api.canConfigureOnlinePayment(provider),true)
  assert.equal(api.canConfigureOnlinePayment({...provider,id:'manual',checkoutKind:'manual'}),false)
  assert.equal(api.paymentProviderName(provider),'New API 余额支付')
  const values=api.paymentValues(provider);assert.equal(values.secret,'')
  const input=api.paymentProviderInput(provider,true,values)
  assert.deepEqual(input,{providerId:'ciyuan_balance',enabled:true,values:{gatewayUrl:'https://gateway.example/',merchantId:'oaooao'}})
  api.assertPaymentProviderSaved({providers:[provider]},input)
  assert.throws(()=>api.assertPaymentProviderSaved({providers:[{...provider,enabled:false}]},input))
  assert.throws(()=>api.paymentProviderInput({...provider,fields:provider.fields.map(f=>({...f,configured:false}))},true,{...values,secret:''}))
})
test('payment configuration rejects embedded credentials and unsafe URLs',()=>{
  for(const gatewayUrl of ['http://gateway.example','https://user:secret@gateway.example/','https://gateway.example/?token=abc','https://gateway.example/#key'])assert.throws(()=>api.paymentProviderInput(provider,true,{...api.paymentValues(provider),gatewayUrl}))
})

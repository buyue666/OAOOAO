import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import ts from 'typescript'

function load(path,imports={}){const module={exports:{}};const code=ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('module','exports','require',code)(module,module.exports,name=>{assert.ok(name in imports,name);return imports[name]});return module.exports}
const {scheduleVideoQuote}=load('lib/studio/video-quote.ts')
const tick=async()=>{await Promise.resolve();await Promise.resolve()}
test('quote debounce cancels pending work and aborts obsolete requests without publishing stale results',async()=>{
  const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout,timers=new Map();let id=0;
  globalThis.setTimeout=(fn,ms)=>{timers.set(++id,{fn,ms});return id};globalThis.clearTimeout=key=>timers.delete(key);
  try{
    const values=[],errors=[];let calls=0,signal,finish;
    const start=()=>scheduleVideoQuote({load:async value=>{calls++;signal=value;return new Promise(done=>finish=done)},onSuccess:value=>values.push(value),onError:error=>errors.push(error)});
    const pending=start();assert.equal([...timers.values()][0].ms,150);pending();assert.equal(timers.size,0);assert.equal(calls,0);
    const cancel=start();[...timers.values()][0].fn();assert.equal(calls,1);cancel();assert.equal(signal.aborted,true);finish({points:10});await tick();assert.deepEqual(values,[]);assert.deepEqual(errors,[]);
    const current=start();[...timers.values()].at(-1).fn();finish({points:20});await tick();assert.deepEqual(values,[{points:20}]);current();
  }finally{globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear}
})
test('aborted upload resolution never starts a quote request',async()=>{
  let uploadDone,calls=0;const oldSet=globalThis.setTimeout,oldClear=globalThis.clearTimeout;let run;
  globalThis.setTimeout=fn=>{run=fn;return 1};globalThis.clearTimeout=()=>{};
  try{
    const cancel=scheduleVideoQuote({load:async signal=>{await new Promise(done=>uploadDone=done);signal.throwIfAborted();calls++;return 1},onSuccess(){assert.fail('cancelled quote completed')},onError(){assert.fail('cancelled quote failed')}});
    run();cancel();uploadDone();await tick();assert.equal(calls,0);
  }finally{globalThis.setTimeout=oldSet;globalThis.clearTimeout=oldClear}
})

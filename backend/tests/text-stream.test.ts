import test from 'node:test';
import assert from 'node:assert/strict';
import {createTextStream} from '../src/text-stream.js';
import {generationInput} from '../src/creative.js';

const event=(delta:object,finish_reason?:string)=>`data: ${JSON.stringify({choices:[{delta,finish_reason}]})}\r\n\r\n`;
test('SSE survives byte boundaries, Chinese UTF-8, keepalives and never retains reasoning',()=>{
 const progress:any[]=[],stream=createTextStream(p=>progress.push(p)),expected='{"summary":"街头追逐","design":{"setting":"城市白天","layout":"人车分离"}}';
 const source=': keepalive\r\n\r\n'+event({reasoning_content:'PRIVATE REASONING'})+event({content:expected.slice(0,20)})+event({content:expected.slice(20)})+event({},'stop')+'data: [DONE]\r\n\r\n';
 for(const byte of Buffer.from(source))stream.push(Uint8Array.of(byte));
 assert.equal(stream.finish(),expected);assert.equal(progress[0].stage,'thinking');
 assert.equal(progress.at(-1).receivedCharacters,expected.length);assert.match(progress.at(-1).preview,/人车分离/);
 assert.ok(!JSON.stringify(progress).includes('PRIVATE REASONING'));
});
test('incomplete, length-limited and provider-error streams cannot become successful results',()=>{
 for(const body of [event({content:'partial'}),event({content:'partial'},'length'),'data: {"error":{"message":"SECRET upstream diagnostic"}}\n\n']){
  const stream=createTextStream();assert.throws(()=>{stream.push(Buffer.from(body));stream.finish();},/方案|完整/);
 }
 const noText=createTextStream();noText.push(Buffer.from('data: [DONE]\n\n'));assert.throws(()=>noText.finish(),/未返回/);
});
test('non-streaming compatible responses can be parsed once without a second provider request',()=>{
 const stream=createTextStream();stream.push(Buffer.from('{"choices":[{"message":{"content":"fixture"}}]}'));assert.equal(stream.finish(),undefined);
});
test('director context larger than 32000 characters remains valid JSON and over-limit text is rejected',()=>{
 const content=JSON.stringify({catalog:'资'.repeat(42000),scene:{id:'tail-still-present'}});
 const input=generationInput('text',{messages:[{role:'system',content:'Synthetic system'},{role:'user',content}],config:{stream:true}});
 assert.equal(input.messages[1].content,content);assert.equal(JSON.parse(input.messages[1].content).scene.id,'tail-still-present');
 assert.throws(()=>generationInput('text',{messages:[{role:'user',content:'x'.repeat(64001)}]}),/过长/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeAgentProject} from '../src/agent-context.js';

test('planner context retains saved node facts while excluding inline media and bounding large documents',()=>{
  const snapshot=summarizeAgentProject({title:'Synthetic scene',nodes:[{id:'one',data:{prompt:'A ceramic cup',src:'data:image/png;base64,'+'a'.repeat(1000000)}}],script:'x'.repeat(100000),episodes:Array.from({length:100},(_,i)=>({title:`Episode ${i}`,script:'b'.repeat(10000)}))});
  const wire=JSON.stringify(snapshot);
  assert.match(wire,/A ceramic cup/);assert.doesNotMatch(wire,/data:image/);assert.ok(wire.length<75000);assert.equal(snapshot.contextTruncated,true);
});
test('small context does not falsely claim omission',()=>{
  const snapshot=summarizeAgentProject({title:'Synthetic',nodes:[{id:'one',data:{prompt:'Saved instructions'}}],connections:[]});
  assert.equal(snapshot.contextTruncated,false);
  assert.equal((snapshot.nodes as any[])[0].data.prompt,'Saved instructions');
});
test('serialized budget also bounds numerical matrices, huge keys and escaped strings',()=>{
  for (const project of [
    {nodes:Array.from({length:80},()=>Array.from({length:80},()=>Array(80).fill(123456789)))},
    {['key'.repeat(100000)]:true},
    {nodes:Array.from({length:80},()=>({prompt:'\u0000'.repeat(2000),value:123456789}))},
  ]) {
    const result=summarizeAgentProject(project);
    assert.ok(JSON.stringify(result).length<60100);
    assert.equal(result.contextTruncated,true);
  }
});

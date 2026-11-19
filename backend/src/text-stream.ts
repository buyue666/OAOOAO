/** Incremental OpenAI-compatible SSE reader. Reasoning text is never retained. */
export type TextProgress = {stage:'thinking'|'writing';receivedCharacters:number;preview:string;updatedAt:number};
export class TextStreamError extends Error {}
export function createTextStream(onProgress:(progress:TextProgress)=>void=()=>{}) {
  const decoder=new TextDecoder();let pending='',content='',events=0,done=false,finishReason:string|undefined;
  const preview=()=>{
    const values:string[]=[];
    for(const key of ['summary','setting','layout']){
      const found=new RegExp('"'+key+'"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")').exec(content);
      if(found)try{values.push(JSON.parse(found[1]));}catch{}
    }
    return values.join('\n').slice(0,2400);
  };
  const report=(stage:'thinking'|'writing')=>onProgress({stage,receivedCharacters:content.length,preview:preview(),updatedAt:Date.now()});
  const event=(block:string)=>{
    const data=block.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n').trim();
    if(!data||done)return;
    events++;
    if(data==='[DONE]'){done=true;return;}
    let value:any;try{value=JSON.parse(data);}catch{throw new TextStreamError('文字模型返回了无法解析的流式内容');}
    if(value.error)throw new TextStreamError('文字模型生成失败，未返回完整方案');
    const choice=value.choices?.[0],delta=choice?.delta;
    if(typeof delta?.content==='string'){
      content+=delta.content;
      if(content.length>256000)throw new TextStreamError('文字方案超过长度限制，请分步规划');
      report('writing');
    }else if(delta?.reasoning_content||delta?.reasoning)report(content?'writing':'thinking');
    if(typeof choice?.finish_reason==='string')finishReason=choice.finish_reason;
  };
  const drain=()=>{pending=pending.replace(/\r\n/g,'\n');let at;while((at=pending.indexOf('\n\n'))!==-1){event(pending.slice(0,at));pending=pending.slice(at+2);}};
  return {
    push(bytes:Uint8Array){pending+=decoder.decode(bytes,{stream:true});if(pending.length>2*1024*1024)throw new TextStreamError('文字模型返回内容过大');drain();},
    finish(){pending+=decoder.decode();drain();if(pending.trim())event(pending);if(!events)return undefined;
      if(finishReason&&finishReason!=='stop')throw new TextStreamError('文字模型未完成方案，请减少单次规划内容');
      if(!done&&finishReason!=='stop')throw new TextStreamError('文字模型连接提前结束，方案不完整');
      if(!content.trim())throw new TextStreamError('文字模型未返回可用方案');
      return content;
    },
  };
}

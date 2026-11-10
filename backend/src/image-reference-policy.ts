import { httpError } from './core.js';

/** The same limit check is used by quotes and actual submissions. */
export function assertImageReferencePolicy(input: Record<string,any>, profile: Record<string,any>) {
  const count=(input.references||[]).length;
  if(count&&profile.supportsReferenceImage===false)throw httpError(400,'当前模型不支持参考图');
  if(count>1&&profile.supportsMultiReference===false)throw httpError(400,'当前模型只支持一张参考图');
  const max=Number(profile.maxReferences??profile.maxReferenceImages);
  if(max>0&&count>max)throw httpError(400,`当前模型最多支持 ${max} 张参考图`);
  const outputs=Number(input.config?.n??1);
  if(!Number.isInteger(outputs)||outputs<1||outputs>20)throw httpError(400,'图片生成数量无效');
  const batch=Number(profile.maxBatchSize);
  if(batch>0&&outputs>batch)throw httpError(400,`当前模型每次最多生成 ${batch} 张图片`);
}

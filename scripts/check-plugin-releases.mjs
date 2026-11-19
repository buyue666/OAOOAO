import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scopes = {
  remix: ['components/studio/tools/image-remix-tool.tsx'],
  tryon: ['components/studio/tools/ai-tryon-tool.tsx','components/studio/tools/tryon-','lib/studio/tryon'],
  agent: ['components/director/','components/studio/agent-','lib/studio/director-'],
  drama: ['components/studio/drama-','lib/studio/drama-','lib/studio/use-drama-'],
  canvas: ['components/free-canvas/'],
  director: ['components/free-canvas/director/','components/free-canvas/director-studio.tsx','components/free-canvas/director-desk.tsx','components/free-canvas/plugin-director.tsx','vendor/director-studio/src/'],
}
const semver = value => typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
const greater = (a,b) => { const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++){if(x[i]!==y[i])return x[i]>y[i]}return false }
export function validateReleaseTransition(releases, current, previous = {}) {
  if (Object.keys(releases).sort().join() !== Object.keys(scopes).sort().join()) throw Error('插件发布清单与插件目录不一致')
  for (const [id, release] of Object.entries(releases)) {
    if (!semver(release.version) || !/^\d{4}-\d{2}-\d{2}$/.test(release.releasedAt) || !Array.isArray(release.notes) || !release.notes.length || release.notes.some(n=>typeof n!=='string'||!n.trim())) throw Error('插件发布信息不完整：'+id)
    const old=previous[id]
    if (old && old.fingerprint !== current[id].fingerprint && !greater(release.version,old.version)) throw Error(`插件 ${id} 的实现已变化，请升级版本并填写更新记录（原版本 ${old.version}）`)
    if (old && greater(old.version,release.version)) throw Error('插件版本不能倒退：'+id)
  }
}
export function checkPluginReleases(root, record=false) {
  const releases=JSON.parse(readFileSync(path.join(root,'lib/studio/creative-plugin-releases.json'),'utf8'))
  const files=[]
  function walk(folder) { for(const entry of readdirSync(folder,{withFileTypes:true})){const file=path.join(folder,entry.name);if(entry.isDirectory())walk(file);else if(/\.(tsx?|css|json)$/.test(entry.name))files.push(path.relative(root,file).replaceAll('\\','/'))} }
  for(const folder of ['components','lib'])walk(path.join(root,folder))
  const current={}
  for(const [id,prefixes] of Object.entries(scopes)){
    const matching=files.filter(name=>prefixes.some(prefix=>name.startsWith(prefix)) && !(id==='canvas'&&scopes.director.some(prefix=>name.startsWith(prefix)))).sort()
    if(!matching.length)throw Error('未找到插件实现文件：'+id)
    const hash=createHash('sha256');for(const name of matching)hash.update(name+'\0').update(readFileSync(path.join(root,name)))
    current[id]={version:releases[id]?.version,fingerprint:hash.digest('hex'),files:matching.length}
  }
  const lock=path.join(root,'lib/studio/creative-plugin-release-lock.json')
  let previous
  try{previous=JSON.parse(readFileSync(lock,'utf8'))}catch(error){if(error.code!=='ENOENT')throw error;if(!record)throw Error('缺少插件发布锁，请确认版本后运行 npm run release:plugins')}
  validateReleaseTransition(releases,current,previous)
  if(record)writeFileSync(lock,JSON.stringify(current,null,2)+'\n')
  else for(const [id,value] of Object.entries(current))if(value.fingerprint!==previous[id]?.fingerprint||value.version!==previous[id]?.version)throw Error('插件发布记录未锁定：'+id+'；运行 npm run release:plugins')
  return current
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
  const result=checkPluginReleases(path.resolve(fileURLToPath(new URL('..',import.meta.url))),process.argv.includes('--record'))
  console.log('Plugin release check passed: '+Object.entries(result).map(([id,v])=>id+'@'+v.version).join(', '))
}

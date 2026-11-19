import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validateReleaseTransition } from '../scripts/check-plugin-releases.mjs'
const releases=JSON.parse(readFileSync(new URL('../lib/studio/creative-plugin-releases.json',import.meta.url),'utf8'))
const current=Object.fromEntries(Object.entries(releases).map(([id,v])=>[id,{version:v.version,fingerprint:'current'}]))
test('changed plugin code requires an incremented plugin version',()=>{
  const previous=structuredClone(current);previous.tryon.fingerprint='old'
  assert.throws(()=>validateReleaseTransition(releases,current,previous),/tryon.*升级版本/)
  previous.tryon.version='0.0.9'
  assert.doesNotThrow(()=>validateReleaseTransition(releases,current,previous))
})
test('release versions cannot move backwards or omit release notes',()=>{
  const previous=structuredClone(current);previous.director.version='9.0.0'
  assert.throws(()=>validateReleaseTransition(releases,current,previous),/不能倒退/)
  const invalid=structuredClone(releases);invalid.director.notes=[]
  assert.throws(()=>validateReleaseTransition(invalid,current),/不完整/)
})

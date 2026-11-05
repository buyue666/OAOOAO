import test from 'node:test';
import assert from 'node:assert/strict';
import {validateVideoInput,validateVideoPolicySettings,videoInputMode} from '../src/video-policy.js';

const frame=(role:string)=>({type:'image',role});
const profile={supportsReferenceImage:true,supportsFirstFrame:true,supportsLastFrame:true,supportsAudioReference:true,supportsVideoReference:true,frameReferenceTypes:['image','audio'],maxReferences:15,maxReferenceImages:9,maxReferenceVideos:3,maxReferenceAudios:3};

test('frame requests preserve optional tail and permit additional images/audio, while video is rejected',()=>{
  const first=frame('first_frame'),last=frame('last_frame'),image={type:'image',role:'reference'},audio={type:'audio',role:'reference'};
  assert.doesNotThrow(()=>validateVideoInput({references:[first,image,audio]},profile));
  assert.doesNotThrow(()=>validateVideoInput({references:[first,last,image,audio]},profile));
  assert.equal(videoInputMode({references:[first,image,audio]}),'first');
  assert.equal(videoInputMode({references:[first,last,image,audio]}),'ends');
  assert.throws(()=>validateVideoInput({references:[first,last,{type:'video',role:'reference'}]},profile),/不支持参考视频/);
  assert.throws(()=>validateVideoInput({references:[last,image]},profile),/同时提供首帧/);
  assert.throws(()=>validateVideoInput({references:[{type:'video',role:'first_frame'}]},profile),/各限一张图片/);
});

test('frame capabilities and total/per-type ceilings cannot be bypassed through direct API requests',()=>{
  const first=frame('first_frame'),last=frame('last_frame'),image={type:'image'},audio={type:'audio'};
  assert.throws(()=>validateVideoInput({references:[first,image]},{...profile,frameReferenceTypes:[]}),/不支持首尾帧搭配/);
  assert.throws(()=>validateVideoInput({references:[first,audio]},{...profile,frameReferenceTypes:['image']}),/不支持首尾帧搭配/);
  assert.throws(()=>validateVideoInput({references:[first,last,image,audio]},{...profile,videoReferenceTotalLimit:3}),/合计最多 3/);
  assert.throws(()=>validateVideoInput({references:[first,last,...Array(8).fill(image)]},profile),/最多 9/);
  assert.doesNotThrow(()=>validateVideoInput({references:[{type:'video'},audio]},profile),'multi-reference mode still allows video');
  for(const value of [['video'],['image','video'],'image',null])assert.throws(()=>validateVideoPolicySettings({frameReferenceTypes:value}),/附加参考类型/);
  assert.doesNotThrow(()=>validateVideoPolicySettings({frameReferenceTypes:['image','audio']}));
});

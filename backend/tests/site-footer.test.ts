import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {buildApp} from '../src/app.js';
import {hashToken} from '../src/core.js';
import {DEFAULT_SITE_FOOTER,footerUrl,publicSiteFooter,validateSiteFooter} from '../src/site-footer.js';
import {createTestDatabase} from './core-helpers.js';

test('footer validates bounded plain text and safe links without silently accepting unsafe input',()=>{
  for(const url of ['/image','/assets?q=test#item','https://example.invalid/path','http://example.invalid'])assert.equal(footerUrl(url),url);
  for(const url of ['//example.invalid','javascript:alert(1)','data:text/plain,test','https:example.invalid','https:///example.invalid','https://user@example.invalid','https://@example.invalid','/\\example.invalid','/ok\nunsafe','https://example.invalid/'+ 'a'.repeat(2048)])assert.throws(()=>footerUrl(url));
  for(const data of [{showOnStudio:'false'},{description:'x'.repeat(501)},{copyrightHolder:'x'.repeat(161)},{contactEmail:'broken'},{socialLinks:Array.from({length:9},()=>({label:'Test',url:'/safe'}))},{productLinks:[{label:'',url:'/safe'}]},{customHtml:'<script/>'}])assert.throws(()=>validateSiteFooter(data));
  const legacy=publicSiteFooter({contactUrl:'javascript:alert(1)',socialLinks:[{label:'Unsafe',url:'//example.invalid'}],description:42});assert.equal(legacy.contactUrl,'');assert.deepEqual(legacy.socialLinks,[]);assert.equal(legacy.description,'');
  assert.deepEqual(publicSiteFooter(undefined),DEFAULT_SITE_FOOTER);
});

test('footer persists to PostgreSQL, survives partial settings writes, and is published without retired fallback',async t=>{
  const fixture=await createTestDatabase(),app=await buildApp({db:fixture.db,config:fixture.config,coreOnly:true});t.after(async()=>{await app.close();await fixture.cleanup();});
  const tokens=new Map<string,string>();
  for(const [id,role,permissions] of [['footer-admin','admin',['system.manage']],['footer-user','user',[]]] as const){const token=randomBytes(32).toString('base64url');tokens.set(id,token);await fixture.db.query("INSERT INTO oaooao_users(id,username,password_hash,role,admin_permissions) VALUES($1,$1,'synthetic-unused',$2,$3)",[id,role,JSON.stringify(permissions)]);await fixture.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[hashToken(token),id]);}
  const headers=(id='footer-admin')=>({cookie:`oaooao_session=${tokens.get(id)}`,origin:fixture.config.origin});
  const footer={...DEFAULT_SITE_FOOTER,showOnStudio:true,description:'独立合成页脚',contactEmail:'footer@example.invalid',socialLinks:[{label:'社区',url:'https://community.example.invalid'}],registrationLabel:'测试备案',registrationUrl:'https://registration.example.invalid'};
  assert.equal((await app.inject({method:'PATCH',url:'/api/admin/settings',headers:headers('footer-user'),payload:{site:{footer}}})).statusCode,403);
  const saved=await app.inject({method:'PATCH',url:'/api/admin/settings',headers:headers(),payload:{site:{footer}}});assert.equal(saved.statusCode,200,saved.body);assert.deepEqual(saved.json().settings.site.footer,footer);
  assert.deepEqual((await fixture.db.query("SELECT value#>'{site,footer}' footer FROM oaooao_settings WHERE id='global'")).rows[0].footer,footer);
  const changed=await app.inject({method:'PATCH',url:'/api/admin/settings',headers:headers(),payload:{site:{title:'新品牌'}}});assert.equal(changed.statusCode,200);assert.deepEqual(changed.json().settings.site.footer,footer);
  for(const input of [{contactUrl:'javascript:alert(1)'},{productLinks:[{label:'Hello',url:'https://user:pass@example.invalid'}]}]){const invalid=await app.inject({method:'PATCH',url:'/api/admin/settings',headers:headers(),payload:{site:{footer:input}}});assert.equal(invalid.statusCode,400,invalid.body);}
  const session=await app.inject({url:'/api/auth/session'});assert.deepEqual(session.json().settings.site.footer,footer);assert.equal(session.json().settings.site.announcementBar,undefined);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { HTTPMethods } from 'fastify';
import { buildApp } from '../src/app.js';

// Snapshot of HTTP call contracts, not frontend implementations. Consulted files:
// OAOOAO-icon-fix/lib/studio/{api,account-api,admin-api,creative-api,generation-api}.ts.
// This verifies assembled registration independently of database fixtures or integrations.
test('assembled backend registers every reviewed frontend HTTP call contract',async t=>{
  const app=await buildApp({config:{databaseUrl:'postgres://synthetic:synthetic@127.0.0.1:1/unused',
    origin:'http://localhost:3000',allowedOrigins:['http://localhost:3000'],production:false,
    sessionCookieName:'synthetic_session',sessionTtlSeconds:3600,encryptionKey:randomBytes(32).toString('base64'),
    mediaRoot:'.private/unused-contract-media',host:'127.0.0.1',port:3001,workerEnabled:false}});
  t.after(()=>app.close());await app.ready();
  const expected:[HTTPMethods,string][]=[];
  const add=(method:HTTPMethods,...paths:string[])=>paths.forEach(path=>expected.push([method,path]));
  add('GET','/api/auth/session','/api/auth/wechat-official/sessions/example','/api/account/wechat-official',
    '/api/integrations/wechat-official/callback','/api/billing/webhooks/epay','/api/billing/epay/return',
    '/api/billing/products','/api/billing/orders','/api/billing/orders/example','/api/points','/api/referrals',
    '/api/library-assets','/api/generation-logs','/api/agent/runs','/api/agent/runs/example','/api/agent/runs/example/events',
    '/api/drama/render-capability','/api/drama/render/example','/api/drama/projects/example/versions',
    '/api/admin/users','/api/admin/generation-operations','/api/admin/generation-overview',
    '/api/admin/settings','/api/admin/billing/summary','/api/admin/billing/payment-config',
    '/api/admin/object-storage','/api/admin/launch-readiness','/api/admin/billing/products','/api/admin/billing/orders',
    '/api/admin/billing/promotions','/api/admin/billing/coupon-templates','/api/admin/referrals',
    '/api/admin/referrals/relationships','/api/admin/referrals/rewards','/api/admin/announcements',
    '/api/admin/works','/api/admin/work-cases','/api/admin/audit-logs');
  add('POST','/api/auth/login','/api/auth/logout','/api/auth/register','/api/auth/email-code','/api/auth/password/reset',
    '/api/auth/wechat-official/sessions','/api/auth/wechat-official/sessions/example/consume',
    '/api/account/wechat-official/bind-sessions','/api/integrations/wechat-official/callback','/api/billing/webhooks/epay',
    '/api/billing/orders','/api/billing/orders/example/checkout','/api/billing/orders/example/cancel',
    '/api/reference-assets','/api/library-assets','/api/agent/runs',
    '/api/agent/runs/example/approve','/api/agent/runs/example/cancel','/api/agent/runs/example/pause','/api/agent/runs/example/resume','/api/agent/runs/example/retry',
    '/api/agent/runs/example/tasks/example/retry','/api/drama/render',
    '/api/drama/projects/example/versions','/api/drama/projects/example/versions/example','/api/drama/projects/example/export-jianying',
    '/api/video-generation-tasks','/api/admin/users','/api/admin/generation-operations/image/example/review',
    '/api/admin/mail/test','/api/admin/object-storage','/api/admin/models','/api/admin/billing/products',
    '/api/admin/billing/orders/example/close','/api/admin/billing/orders/example/complete','/api/admin/billing/orders/example/refund',
    '/api/admin/billing/orders/example/refund/prepare','/api/admin/billing/orders/example/refund/cancel',
    '/api/admin/billing/promotions','/api/admin/billing/coupon-templates','/api/admin/billing/coupons/grant',
    '/api/admin/announcements','/api/admin/works/example/review','/api/admin/works/example/take-down',
    '/api/admin/works/example/feature','/api/admin/work-cases/example/resolve');
  add('PATCH','/api/auth/profile','/api/auth/password','/api/admin/users/example','/api/admin/settings',
    '/api/admin/billing/payment-config','/api/admin/object-storage','/api/admin/billing/products/example',
    '/api/admin/billing/promotions/example','/api/admin/billing/coupon-templates/example','/api/admin/referrals','/api/admin/announcements/example');
  add('DELETE','/api/library-assets/example','/api/canvas/projects','/api/admin/billing/promotions/example',
    '/api/admin/announcements/example','/api/admin/works/example');
  for(const kind of ['canvas','drama']){
    add('GET',`/api/${kind}/projects`,`/api/${kind}/projects/example`);add('POST',`/api/${kind}/projects`);
    add('PATCH',`/api/${kind}/projects/example`);if(kind==='drama')add('DELETE','/api/drama/projects/example');
  }
  for(const kind of ['image','text','video','audio']){
    if(kind!=='video')add('POST',`/api/${kind}-tasks`);
    for(const method of ['GET','PATCH','POST'] as const)add(method,`/api/${kind}-tasks/example`);
  }
  for(const [method,url] of expected)assert.ok(app.findRoute({method,url}),`Missing frontend contract: ${method} ${url}`);
  assert.equal(new Set(expected.map(([method,url])=>`${method} ${url}`)).size,expected.length,'Contract snapshot must not duplicate entries');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../src/app.js';
import {createTestDatabase} from './core-helpers.js';

test('health aliases match and readiness rejects partial or mismatched migration manifests',async()=>{
  const fixture=await createTestDatabase(),app=await buildApp({db:fixture.db,config:fixture.config,coreOnly:true});
  try{
    for(const url of ['/health','/api/health/live','/ready','/api/health/ready']){
      const response=await app.inject({url});assert.equal(response.statusCode,200,response.body);assert.deepEqual(response.json(),{ok:true});
    }
    const last=(await fixture.db.query('SELECT name,checksum,applied_at FROM oaooao_migrations ORDER BY name DESC LIMIT 1')).rows[0];
    await fixture.db.query('DELETE FROM oaooao_migrations WHERE name=$1',[last.name]);
    for(const url of ['/ready','/api/health/ready']){
      const response=await app.inject({url});assert.equal(response.statusCode,503);assert.equal(response.json().msg,'Database schema is not ready');assert.ok(!response.body.includes(last.name));assert.ok(!response.body.includes(fixture.config.encryptionKey));
    }
    assert.deepEqual((await app.inject({url:'/api/health/live'})).json(),{ok:true});
    await fixture.db.query('INSERT INTO oaooao_migrations(name,checksum,applied_at) VALUES($1,$2,$3)',[last.name,'0'.repeat(64),last.applied_at]);
    assert.equal((await app.inject({url:'/api/health/ready'})).statusCode,503);
    await fixture.db.query('UPDATE oaooao_migrations SET checksum=$2 WHERE name=$1',[last.name,last.checksum]);
    assert.deepEqual((await app.inject({url:'/api/health/ready'})).json(),{ok:true});
  }finally{await app.close();await fixture.cleanup();}
});

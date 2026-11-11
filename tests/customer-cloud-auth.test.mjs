import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {login,authenticated,setCustomerPassword} from '../cloud/auth.mjs';

// Real SQLite constraints and transactions behind the D1 statement interface.
test('cloud customer passwords use D1 accounts, private hashes, scoped sessions and atomic resets',async()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec(await fs.readFile(new URL('../migrations/0001_cloud_workspace.sql',import.meta.url),'utf8'));
  db.exec(await fs.readFile(new URL('../migrations/0004_launch_controls.sql',import.meta.url),'utf8'));
  const DB={prepare(sql){const stmt=db.prepare(sql);let values=[];return {bind(...args){values=args;return this;},first(){return stmt.get(...values)||null;},run(){const r=stmt.run(...values);return {meta:{changes:r.changes}};}};},async batch(statements){db.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}}};
  const env={DB},c={id:'customer-test',email:'client@example.invalid',name:'Client company',contact:'Client contact',active:true};
  const insert=db.prepare('INSERT INTO entities(collection,id,payload,position) VALUES(?,?,?,0)');insert.run('customer',c.id,JSON.stringify(c));
  const request=new Request('https://example.test/api/auth/login',{headers:{'CF-Connecting-IP':'test'}});
  await setCustomerPassword(env,c,{username:'cusA',password:'cloud-test-secret'});
  const stored=db.prepare('SELECT * FROM accounts WHERE id=?').get(c.id);assert.equal(stored.role,'Customer');assert.notEqual(stored.password_hash,'cloud-test-secret');
  await assert.rejects(login(request,env,{username:'cusA',password:'cloud-test-secret'}),{status:401});
  await assert.rejects(login(request,env,{username:'cusA',password:'wrong',audience:'customer'}),{status:401});
  const session=await login(request,env,{username:'CUSA',password:'cloud-test-secret',audience:'customer'});assert.equal(session.user.role,'Customer');assert.match(session.cookie,/Secure/);
  const signed=new Request('https://example.test/api/auth/me',{headers:{Cookie:session.cookie.split(';')[0]}});
  assert.equal((await authenticated(signed,env)).email,c.email);
  const c2={...c,id:'customer-other'};insert.run('customer',c2.id,JSON.stringify(c2));
  await assert.rejects(setCustomerPassword(env,c2,{username:'cusa',password:'another-secret'}),{status:409});
  await setCustomerPassword(env,c,{username:'cusA',password:'replacement-secret'});
  await assert.rejects(authenticated(signed,env),{status:401});
  await assert.rejects(login(request,env,{username:'cusA',password:'cloud-test-secret',audience:'customer'}),{status:401});
  await login(request,env,{username:'cusA',password:'replacement-secret',audience:'customer'});
  db.prepare('UPDATE entities SET payload=? WHERE id=?').run(JSON.stringify({...c,active:false}),c.id);
  await assert.rejects(login(request,env,{username:'cusA',password:'replacement-secret',audience:'customer'}),{status:401});
 }finally{db.close();}
});

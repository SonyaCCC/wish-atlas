import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,readdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
test('local server persists manual/import records, enforces token and recovers backup',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'wish-atlas-test-'));
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'0',WISH_DATA_DIR:dir},windowsHide:true,stdio:['ignore','pipe','pipe']});
 t.after(()=>child.kill());
 const base=await new Promise((resolve,reject)=>{child.stdout.on('data',data=>{const m=data.toString().match(/http:\/\/127.0.0.1:\d+/);if(m)resolve(m[0]);});child.on('error',reject);child.on('exit',()=>reject(Error('server stopped')));});
 const html=await(await fetch(base)).text();const token=html.match(/name="wish-token" content="([^"]+)"/)[1];
 const call=async(route,body)=>{const res=await fetch(base+route,{method:body?'POST':'GET',headers:{'x-wish-token':token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:res.status,data:await res.json()};};
 assert.equal((await fetch(base+'/api/state')).status,403);
 assert.equal((await fetch(base+'/data/records.json')).status,404);
 assert.equal((await fetch(base+'/api/state',{headers:{'x-wish-token':token,origin:'https://evil.example'}})).status,403);
 assert.equal((await call('/api/account',{uid:'123456789',timezone:8})).status,200);
 const manual={uid:'123456789',gacha_type:'301',rank_type:'5',name:'刻晴',time:'2021-01-01 12:00:00',kind:'summary',span:75,outcome:'loss'};
 assert.equal((await call('/api/record',manual)).status,200);
 const file={info:{uid:'123456789'},list:[{id:'1697591160000515623',gacha_type:'301',rank_type:'5',name:'纳西妲',time:'2024-01-01 12:00:00'}]};
 assert.equal((await call('/api/import',file)).data.added,1);assert.equal((await call('/api/import',file)).data.duplicates,1);
 const before=(await call('/api/state')).data;assert.equal(before.accounts[0].records.length,2);
 const id=before.accounts[0].records[0].id;
 assert.equal((await call('/api/record',{uid:'123456789',id,outcome:'win',target:'unknown',note:'校正'})).status,200);
 const backup=(await call('/api/export?format=backup')).data;assert.equal(backup.accounts[0].records[0].note,'校正');
 assert.equal((await call('/api/record',{uid:'123456789',id,delete:true})).status,200);
 assert.equal((await call('/api/import',backup)).data.added,1);
 assert.equal((await call('/api/export?format=uigf')).data.hk4e[0].list.length,1);
 assert.equal(JSON.parse(await readFile(path.join(dir,'records.json'),'utf8')).accounts[0].records.length,2);
 assert.ok((await readdir(path.join(dir,'backups'))).length>=5);
 const old=JSON.stringify((await call('/api/state')).data);
 assert.equal((await call('/api/import',{info:{uid:'123456789'},list:[{...file.list[0],name:'冲突'}]})).status,400);
 assert.equal(JSON.stringify((await call('/api/state')).data),old);
 const stopped=new Promise(resolve=>child.once('exit',resolve));
 assert.equal((await call('/api/stop',{})).status,200);
 await stopped;
});

test('sync API defaults to incremental, supports full mode and never rewrites unchanged archives',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'wish-incremental-test-'));
 const rows=Array.from({length:60},(_,i)=>({uid:'123456789',id:String(9007199254740993000n+BigInt(100-i)),gacha_type:'301',name:'弹弓',rank_type:'3',item_type:'武器',time:'2026-09-20 12:00:00'}));
 const preload='data:text/javascript,'+encodeURIComponent(`const rows=${JSON.stringify(rows)};globalThis.fetch=async u=>({ok:true,json:async()=>({retcode:0,data:{list:u.searchParams.get('gacha_type')==='301'?rows.slice((Number(u.searchParams.get('page'))-1)*20,Number(u.searchParams.get('page'))*20):[]}})});`);
 const child=spawn(process.execPath,['--import',preload,'server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'0',WISH_DATA_DIR:dir},windowsHide:true,stdio:['ignore','pipe','pipe']});
 t.after(()=>child.kill());
 const base=await new Promise((resolve,reject)=>{child.stdout.on('data',d=>{const m=d.toString().match(/http:\/\/127.0.0.1:\d+/);if(m)resolve(m[0]);});child.on('error',reject);child.on('exit',()=>reject(Error('server stopped')));});
 const token=(await(await fetch(base)).text()).match(/name="wish-token" content="([^"]+)"/)[1];
 const call=async(route,body)=>{const res=await fetch(base+route,{method:body?'POST':'GET',headers:{'x-wish-token':token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert.ok(res.ok);return res.json();};
 await call('/api/import',{info:{uid:'123456789'},list:rows});
 const before=await stat(path.join(dir,'records.json'));
 const sync=async full=>{
  await call('/api/sync',{url:'https://webstatic.mihoyo.com/?authkey=test',...(full?{full:true}:{})});
  for(let i=0;i<100;i++){const job=await call('/api/job');if(job.status!=='running')return job;await new Promise(r=>setTimeout(r,25));}
  throw Error('sync timeout');
 };
 const incremental=await sync(false);assert.equal(incremental.status,'done');assert.equal(incremental.count,20);assert.equal(incremental.added,0);assert.deepEqual(incremental.matchedPools,['301']);
 const full=await sync(true);assert.equal(full.status,'done');assert.equal(full.count,60);assert.deepEqual(full.matchedPools,[]);
 assert.equal((await stat(path.join(dir,'records.json'))).mtimeMs,before.mtimeMs);
 assert.equal((await call('/api/state')).accounts[0].records.length,60);
});

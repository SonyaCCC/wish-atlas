import test from 'node:test';
import assert from 'node:assert/strict';
import {apiURL,collect,detectLocalURL,requestFailure} from '../lib/api.mjs';
import {importedAccounts,mergeAccounts} from '../public/core.mjs';
const link='https://webstatic.mihoyo.com/hk4e/event/e20190909gacha-v3/index.html?authkey=fake%2Bkey%3D&region=cn_gf01';
test('only official links; fixed destination; key encoding preserved',()=>{
 assert.equal(apiURL(link).hostname,'public-operation-hk4e.mihoyo.com');assert.equal(apiURL(link).searchParams.get('authkey'),'fake+key=');
 assert.equal(apiURL(link.replace('webstatic.mihoyo.com','webstatic-sea.hoyoverse.com')).hostname,'public-operation-hk4e-sg.hoyoverse.com');
 for(const value of ['http://127.0.0.1/?authkey=x','https://mihoyo.com.attacker.test/?authkey=x','https://webstatic.mihoyo.com/'])assert.throws(()=>apiURL(value));
});
test('fetches all pools using end_id, including combined character records',async()=>{
 const calls=[];const result=await collect(link,{delay:async()=>{},fetcher:async u=>{
   calls.push(new URL(u));const type=u.searchParams.get('gacha_type'),page=u.searchParams.get('page');
   const list=type==='301'&&page==='1'?[{uid:'123456789',id:'9007199254740993',gacha_type:'400'}]:[];
   return {ok:true,json:async()=>({retcode:0,data:{list}})};
 }});assert.equal(result.uid,'123456789');assert.equal(calls[1].searchParams.get('end_id'),'9007199254740993');assert.equal(new Set(calls.map(u=>u.searchParams.get('gacha_type'))).size,5);
});
test('expired auth is actionable and never prints credential',async()=>{
 await assert.rejects(collect(link,{delay:async()=>{},fetcher:async()=>({ok:true,json:async()=>({retcode:-101,message:'authkey timeout fake-secret'})})}),/历史链接已过期/);
});
test('repeated page IDs and mixed UIDs fail instead of looping/merging',async()=>{
 await assert.rejects(collect(link,{delay:async()=>{},fetcher:async()=>({ok:true,json:async()=>({retcode:0,data:{list:[{uid:'123456789',id:'1'}]}})})}),/分页异常/);
 await assert.rejects(collect(link,{delay:async()=>{},fetcher:async()=>({ok:true,json:async()=>({retcode:0,data:{list:[{uid:'123456789',id:'1'},{uid:'987654321',id:'2'}]}})})}),/不同 UID/);
});
test('markdown-escaped query separators are accepted without changing authkey',()=>{
 const escaped=link.replaceAll('_','\\_').replaceAll('&','\\&');
 assert.equal(apiURL(escaped).toString(),apiURL(link).toString());
});
test('permission denied fails immediately with useful guidance, no credential leakage',async()=>{
 let attempts=0;
 await assert.rejects(collect(link,{delay:async()=>{},fetcher:async()=>{
  attempts++;throw Object.assign(Error('fetch failed '+link),{cause:{code:'EACCES'}});
 }}),e=>e.message.includes('联网权限')&&!e.message.includes('authkey')&&!e.message.includes('fake'));
 assert.equal(attempts,1);
});
test('network failures distinguish DNS, timeout and TLS',()=>{
 assert.match(requestFailure({cause:{code:'ENOTFOUND'}}).message,/DNS/);
 assert.match(requestFailure({name:'TimeoutError'}).message,/超时/);
 assert.match(requestFailure({cause:{code:'CERT_HAS_EXPIRED'}}).message,/证书/);
});
test('HTTP and official error codes survive retries without exposing raw response',async()=>{
 await assert.rejects(collect(link,{delay:async()=>{},fetcher:async()=>({ok:false,status:403})}),/HTTP 403/);
 await assert.rejects(collect(link,{delay:async()=>{},fetcher:async()=>({ok:true,json:async()=>({retcode:-110,message:'private response secret'})})}),e=>e.message.includes('-110')&&!e.message.includes('secret'));
});
test('cache permission failure is not reported as missing history',async()=>{
 await assert.rejects(detectLocalURL({io:{readFile:async()=>{throw Object.assign(Error('denied'),{code:'EACCES'});}}}),/没有权限读取/);
 await assert.rejects(detectLocalURL({io:{readFile:async()=>{throw Object.assign(Error('missing'),{code:'ENOENT'});}}}),/未找到 PC 原神的游戏日志/);
});
test('cache scan skips unreadable files and extracts URL without executing content',async()=>{
 let reads=0;
 const io={readFile:async(file)=>{
   if(file.endsWith('output_log.txt'))return 'Initialize D:/Genshin/YuanShen_Data';
   reads++;if(file.endsWith('data_1'))throw Object.assign(Error(),{code:'EACCES'});
   return Buffer.from('binary\x00'+link+'\x00more');
 },readdir:async()=>[{name:'data_1',isDirectory:()=>false},{name:'data_2',isDirectory:()=>false}],stat:async()=>({size:1000,mtimeMs:1})};
 assert.equal(await detectLocalURL({io}),link);assert.equal(reads,2);
});
test('a failed page resumes at its cursor without re-fetching completed pools',async()=>{
 let saved=null,calls=[];
 const good={uid:'123456789',id:'9007199254740993',gacha_type:'301'};
 await assert.rejects(collect(link,{delay:async()=>{},checkpoint:c=>{saved=c;},fetcher:async u=>{
   const p=u.searchParams.get('gacha_type'),page=u.searchParams.get('page');
   if(p==='302')throw Object.assign(Error('blocked'),{cause:{code:'EACCES'}});
   return {ok:true,json:async()=>({retcode:0,data:{list:p==='301'&&page==='1'?[good]:[]}})};
 }}),/联网权限/);
 assert.equal(saved.records.length,1);assert.equal(saved.positions['301'].complete,true);
 const result=await collect(link,{delay:async()=>{},resume:saved,fetcher:async u=>{calls.push(u.searchParams.get('gacha_type'));return {ok:true,json:async()=>({retcode:0,data:{list:[]}})};}});
 assert.equal(calls[0],'302');assert.ok(!calls.includes('301'));assert.equal(result.list.length,1);
});

const pulls=(count,{uid='123456789',pool='301',top=200}={})=>Array.from({length:count},(_,i)=>({uid,id:String(9007199254740993000n+BigInt(top-i)),gacha_type:pool,time:'2026-09-20 12:00:00',name:'弹弓',rank_type:'3',item_type:'武器',item_id:'15301'}));
function pages(rows,calls=[],fail=()=>false){return async u=>{
 const pool=u.searchParams.get('gacha_type'),page=Number(u.searchParams.get('page'));calls.push([pool,page]);
 if(fail(pool,page))throw Object.assign(Error('interrupted'),{cause:{code:'EACCES'}});
 const all=rows.filter(r=>(r.gacha_type==='400'?'301':r.gacha_type)===pool);
 const start=u.searchParams.get('end_id')==='0'?0:all.findIndex(r=>r.id===u.searchParams.get('end_id'))+1;
 return {ok:true,json:async()=>({retcode:0,data:{list:all.slice(start,start+20)}})};
};}
const localAccount=records=>({uid:records[0]?.uid??'123456789',records});

test('incremental stops each pool after 20 exact records and keeps all older history and annotations',async()=>{
 const rows=pulls(100),accounts=importedAccounts({info:{uid:rows[0].uid},list:rows});accounts[0].records[0].note='保留标记';
 const calls=[],result=await collect(link,{accounts,fetcher:pages(rows,calls),delay:async()=>{}});
 assert.deepEqual(result.matchedPools,['301']);assert.equal(result.list.length,20);
 assert.deepEqual(calls.filter(([p])=>p==='301'),[['301',1]]);
 const merged=mergeAccounts(accounts,importedAccounts({info:{uid:result.uid},list:result.list}));
 assert.equal(merged.added,0);assert.equal(merged.accounts[0].records.length,100);assert.equal(merged.accounts[0].records.find(r=>r.id===accounts[0].records[0].id).note,'保留标记');
});

test('new pulls followed by a cross-page window add only new records, including shared character pools',async()=>{
 const rows=pulls(100).map((r,i)=>({...r,gacha_type:i%2?'301':'400'})),accounts=[localAccount(rows.slice(17))],calls=[];
 const result=await collect(link,{accounts,fetcher:pages(rows,calls),delay:async()=>{}});
 assert.equal(result.list.length,37);assert.equal(calls.filter(([p])=>p==='301').length,2);
 const merged=mergeAccounts(importedAccounts({info:{uid:rows[0].uid},list:rows.slice(17)}),importedAccounts({info:{uid:result.uid},list:result.list}));
 assert.equal(merged.added,17);assert.equal(merged.duplicates,20);assert.equal(merged.accounts[0].records.length,100);
});

test('overlap is scoped to API UID and individual pool, never the selected or another account',async()=>{
 const character=pulls(60),weapon=pulls(40,{pool:'302'}),calls=[];
 const result=await collect(link,{accounts:[{uid:'987654321',records:character},localAccount(weapon)],fetcher:pages([...character,...weapon],calls),delay:async()=>{}});
 assert.deepEqual(result.matchedPools,['302']);assert.equal(result.list.length,80);
 assert.equal(calls.filter(([p])=>p==='301').length,4);assert.equal(calls.filter(([p])=>p==='302').length,1);
});

test('fewer than 20 matches and same items with different IDs cannot stop a pool',async()=>{
 for(const records of [pulls(19),pulls(60,{top:1000})]){
  const result=await collect(link,{accounts:[localAccount(records)],fetcher:pages(pulls(60)),delay:async()=>{}});
  assert.equal(result.list.length,60);assert.deepEqual(result.matchedPools,[]);
 }
});

test('immutable field mismatches, missing local rows and declared gaps reset the continuous window',async()=>{
 const rows=pulls(60);
 for(const field of ['name','rank_type','time','gacha_type','item_id','item_type','gapBefore','missing']){
  const records=structuredClone(rows);
  if(field==='missing')records.splice(15,1);
  else records[15][field]=field==='gapBefore'?true:field==='gacha_type'?'400':field==='time'?'2026-09-20 12:00:01':'different';
  const result=await collect(link,{accounts:[localAccount(records)],fetcher:pages(rows),delay:async()=>{}});
  assert.equal(result.list.length,36,field);assert.deepEqual(result.matchedPools,['301']);
 }
});

test('interrupted incremental sync reconstructs its partial window across retry pages',async()=>{
 const rows=pulls(100),accounts=[localAccount(rows.slice(17))];let checkpoint;
 await assert.rejects(collect(link,{accounts,fetcher:pages(rows,[],(pool,page)=>pool==='301'&&page===2),delay:async()=>{},checkpoint:c=>checkpoint=c}),/联网权限/);
 assert.equal(checkpoint.records.length,20);
 const calls=[],result=await collect(link,{accounts,resume:checkpoint,fetcher:pages(rows,calls),delay:async()=>{}});
 assert.deepEqual(calls[0],['301',2]);assert.equal(result.list.length,37);assert.deepEqual(result.matchedPools,['301']);
});

test('full mode bypasses overlap; matched pools in a resumed job are not downloaded again',async()=>{
 const rows=pulls(60),accounts=[localAccount(rows)];
 const full=await collect(link,{full:true,accounts,fetcher:pages(rows),delay:async()=>{}});
 assert.equal(full.list.length,60);assert.deepEqual(full.matchedPools,[]);
 let checkpoint;
 await assert.rejects(collect(link,{accounts,fetcher:pages(rows,[],p=>p==='302'),delay:async()=>{},checkpoint:c=>checkpoint=c}),/联网权限/);
 const calls=[],resumed=await collect(link,{accounts,resume:checkpoint,fetcher:pages(rows,calls),delay:async()=>{}});
 assert.ok(calls.every(([p])=>p!=='301'));assert.deepEqual(resumed.matchedPools,['301']);
});

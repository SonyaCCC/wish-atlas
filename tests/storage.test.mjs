import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {initializeStore,inspectStore,legacyCandidates,storageDirectory} from '../lib/storage.mjs';
import {normalize} from '../public/core.mjs';
const fixture=()=>({format:'wish-atlas-backup-v1',updated:'2026-09-25T00:00:00Z',accounts:[
 {uid:'123456789',timezone:8,settings:{'500':{initialPity:12,initialGuarantee:'unknown',bridge:true}},records:[normalize({id:'manual-old',name:'莫娜',rank_type:'5',gacha_type:'500',time:'2023-01-01 00:00:00',kind:'summary',span:75,outcome:'win',target:'yes',gapBefore:true,note:'不要丢失我的标记'},'manual')]},
 {uid:'987654321',timezone:-5,settings:{'301':{initialPity:0,initialGuarantee:'no'}},records:[normalize({id:'9007199254740993555',name:'纳西妲',rank_type:'5',gacha_type:'301',time:'2026-01-01 00:00:00',outcome:'radiance',note:'长整数 ID'},'api')]}
]});
const root=()=>fs.mkdtempSync(path.join(os.tmpdir(),'wish-migration-test-'));
test('migration copies every byte, all accounts, manual marks/settings and keeps immutable source backup',()=>{
 const dir=root(),source=path.join(dir,'old.json'),dataDir=path.join(dir,'shared');
 const bytes=Buffer.from('\ufeff'+JSON.stringify(fixture(),null,2));fs.writeFileSync(source,bytes);
 const result=initializeStore(dataDir,source),dest=path.join(dataDir,'records.json');
 assert.equal(result.mode,'migrated');assert.equal(result.count,2);assert.deepEqual(result.uids,['123456789','987654321']);
 assert.deepEqual(fs.readFileSync(dest),bytes);assert.deepEqual(fs.readFileSync(source),bytes);assert.deepEqual(fs.readFileSync(result.backup),bytes);
 assert.deepEqual(inspectStore(dest).db,inspectStore(source).db);assert.equal(inspectStore(dest).sha256,inspectStore(source).sha256);
 assert.match(path.basename(result.backup),/^migration-/);assert.ok(fs.existsSync(path.join(dataDir,'migration-info.json')));
});
test('a later version or bundled snapshot cannot replace existing data, marks, or an intentionally empty store',()=>{
 const dir=root(),source=path.join(dir,'old.json'),seed=path.join(dir,'seed.json'),dataDir=storageDirectory(dir);
 fs.writeFileSync(source,JSON.stringify(fixture()));initializeStore(dataDir,source);
 const current=fixture();current.accounts[0].records[0].note='新版后来改过';fs.writeFileSync(path.join(dataDir,'records.json'),JSON.stringify(current));
 fs.writeFileSync(seed,JSON.stringify({accounts:[]}));
 assert.equal(initializeStore(dataDir,seed).mode,'existing');assert.deepEqual(inspectStore(path.join(dataDir,'records.json')).db,JSON.parse(JSON.stringify(current)));
 const emptyDir=path.join(dir,'empty');initializeStore(emptyDir);assert.equal(initializeStore(emptyDir,source).mode,'existing');assert.equal(inspectStore(path.join(emptyDir,'records.json')).count,0);
});
test('malformed or duplicate old records never initialize an empty replacement; corrupt shared store is not overwritten',()=>{
 const dir=root(),source=path.join(dir,'bad.json'),dataDir=path.join(dir,'shared');
 fs.writeFileSync(source,'broken');assert.throws(()=>initializeStore(dataDir,source),/损坏/);assert.equal(fs.existsSync(path.join(dataDir,'records.json')),false);
 const bad=fixture();bad.accounts[0].records.push(bad.accounts[0].records[0]);fs.writeFileSync(source,JSON.stringify(bad));assert.throws(()=>initializeStore(dataDir,source),/重复抽卡 ID/);
 fs.writeFileSync(path.join(dataDir,'records.json'),'bad-shared');fs.writeFileSync(source,JSON.stringify(fixture()));assert.throws(()=>initializeStore(dataDir,source),/损坏/);assert.equal(fs.readFileSync(path.join(dataDir,'records.json'),'utf8'),'bad-shared');
});
test('legacy discovery is restricted to known sibling app folders and reports unreadable archives',()=>{
 const dir=root(),app=path.join(dir,'WishAtlas-1.3.1-clean');fs.mkdirSync(app);
 for(const name of ['WishAtlas-1.3.0-clean','unrelated']){
  const old=path.join(dir,name);fs.mkdirSync(path.join(old,'resources','app'),{recursive:true});fs.mkdirSync(path.join(old,'data'));
  fs.writeFileSync(path.join(old,'resources','app','package.json'),JSON.stringify({name:'wish-atlas'}));fs.writeFileSync(path.join(old,'data','records.json'),JSON.stringify(fixture()));
 }
 let found=legacyCandidates(app);assert.equal(found.length,1);assert.equal(found[0].count,2);
 fs.writeFileSync(found[0].file,'broken');found=legacyCandidates(app);assert.match(found[0].error,/损坏/);
});

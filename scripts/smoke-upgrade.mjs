import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {normalize} from '../public/core.mjs';
// The caller supplies the built executable so paths with non-ASCII characters
// never need to be interpreted as shell code.
const exe=path.resolve(process.argv[2]);
if(!fs.existsSync(exe))throw Error('Built EXE missing');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wish-desktop-upgrade-'));
const source=path.join(dir,'old-records.json'),dataDir=path.join(dir,'shared');
const db={accounts:[{uid:'123456789',timezone:8,settings:{'500':{initialPity:0,bridge:true,initialGuarantee:'unknown'}},records:[normalize({id:'manual-fixture',name:'莫娜',gacha_type:'500',rank_type:'5',time:'2024-01-01 00:00:00',kind:'summary',span:75,outcome:'win',target:'yes',note:'迁移测试标记'},'manual')]},{uid:'987654321',timezone:8,settings:{},records:[]}]};
const original=Buffer.from(JSON.stringify(db));fs.writeFileSync(source,original);
async function launch(name){
 const resultFile=path.join(dir,name+'.json');
 await new Promise((resolve,reject)=>{
  const child=spawn(exe,[],{windowsHide:true,stdio:'ignore',env:{...process.env,WISH_DESKTOP_DATA_DIR:dataDir,WISH_DESKTOP_SMOKE_RESULT:resultFile,WISH_DESKTOP_MIGRATION_SOURCE:source}});
  const timer=setTimeout(()=>{child.kill();reject(Error('Desktop upgrade smoke timed out'));},45000);
  child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('Desktop upgrade startup failed '+code));});
 });
 const result=JSON.parse(fs.readFileSync(resultFile,'utf8'));assert.equal(result.ok,true);return result;
}
const first=await launch('first');assert.equal(first.storage.mode,'migrated');assert.equal(first.accounts,2);assert.equal(first.records,1);
assert.deepEqual(fs.readFileSync(path.join(dataDir,'records.json')),original);assert.deepEqual(fs.readFileSync(first.storage.backup),original);
db.accounts[0].records[0].note='新版本后来修改的标记';fs.writeFileSync(path.join(dataDir,'records.json'),JSON.stringify(db));
const second=await launch('next-version');assert.equal(second.storage.mode,'existing');
assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir,'records.json'),'utf8')),JSON.parse(JSON.stringify(db)));assert.deepEqual(fs.readFileSync(source),original);
console.log('Desktop upgrade smoke passed: all accounts, records, settings and annotations preserved; old snapshot cannot overwrite newer edits.');

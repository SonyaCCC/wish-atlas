import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {normalize,validateAccount} from '../public/core.mjs';

export const storageDirectory=appData=>path.join(appData,'WishAtlas','data');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function inspectStore(file){
  const bytes=fs.readFileSync(file);let db;
  try{db=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));}catch{throw Error('档案 JSON 已损坏，未覆盖任何数据：'+file);}
  if(!Array.isArray(db?.accounts))throw Error('请选择旧版 data/records.json 或“完整备份”，UIGF 文件请进入软件后导入');
  const uids=new Set();let count=0;
  for(const a of db.accounts){
    if(!Array.isArray(a.records)||uids.has(a.uid))throw Error('档案账号列表无效或存在重复 UID');
    uids.add(a.uid);
    const normalized={...a,records:a.records.map(r=>normalize(r,r.source))};validateAccount(normalized);
    if(new Set(a.records.map(r=>r.id)).size!==a.records.length)throw Error('档案中存在重复抽卡 ID，请先在旧版核对');
    count+=a.records.length;
  }
  return {bytes,db,sha256:hash(bytes),count,uids:[...uids],file};
}
export function legacyCandidates(portableRoot){
  const files=new Set([path.join(portableRoot,'data','records.json')]);
  // Only discover recognizable sibling app folders; never crawl the user's disk.
  const parent=path.dirname(portableRoot);
  for(const entry of fs.readdirSync(parent,{withFileTypes:true})){
    if(!entry.isDirectory()||!/^WishAtlas-/i.test(entry.name))continue;
    const dir=path.join(parent,entry.name);
    try{const pkg=JSON.parse(fs.readFileSync(path.join(dir,'resources','app','package.json'),'utf8'));if(pkg.name==='wish-atlas')files.add(path.join(dir,'data','records.json'));}catch{}
  }
  return [...files].filter(f=>fs.existsSync(f)).map(file=>{
    try{const s=inspectStore(file);return {file,count:s.count,uids:s.uids,modified:fs.statSync(file).mtimeMs};}
    catch(e){return {file,error:e.message,count:0,uids:[],modified:0};}
  }).sort((a,b)=>b.modified-a.modified);
}
export function initializeStore(dataDir,source=null){
  fs.mkdirSync(dataDir,{recursive:true});const destination=path.join(dataDir,'records.json');
  // Existing shared storage always wins, including an intentionally empty store.
  // A new app or a bundled old snapshot must never overwrite it.
  if(fs.existsSync(destination)){const existing=inspectStore(destination);return {mode:'existing',count:existing.count,uids:existing.uids,sha256:existing.sha256};}
  const incoming=source?inspectStore(source):null;
  const bytes=incoming?.bytes??Buffer.from(JSON.stringify({accounts:[],updated:new Date().toISOString()}));
  const checksum=hash(bytes),id=randomUUID(),tmp=path.join(dataDir,`migration-${id}.tmp`);
  let backup=null;
  if(incoming){
    const backups=path.join(dataDir,'backups');fs.mkdirSync(backups,{recursive:true});
    backup=path.join(backups,`migration-${id}.json`);
    fs.writeFileSync(backup,bytes,{flag:'wx',flush:true});
    if(hash(fs.readFileSync(backup))!==checksum)throw Error('迁移备份校验失败，已有档案未改动');
  }
  fs.writeFileSync(tmp,bytes,{flag:'wx',flush:true});
  try{
    if(hash(fs.readFileSync(tmp))!==checksum)throw Error('迁移写入校验失败');
    if(incoming&&hash(fs.readFileSync(source))!==checksum)throw Error('旧版档案在迁移期间发生变化，请关闭旧版后重新打开新版');
    // Hard-link publication is atomic and cannot replace an existing file.
    // It also protects against another writer appearing after the first check.
    fs.linkSync(tmp,destination);
  }finally{fs.unlinkSync(tmp);}
  const copied=inspectStore(destination);
  if(copied.sha256!==checksum)throw Error('迁移完整性校验失败，请使用迁移备份恢复');
  if(incoming)fs.writeFileSync(path.join(dataDir,'migration-info.json'),JSON.stringify({source:path.resolve(source),sha256:checksum,backup,accounts:copied.uids,records:copied.count,migratedAt:new Date().toISOString()},null,2));
  return {mode:incoming?'migrated':'empty',count:copied.count,uids:copied.uids,sha256:checksum,backup};
}

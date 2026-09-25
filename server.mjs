import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {normalize,importedAccounts,mergeAccounts,validateAccount,exportUIGF,POOLS} from './public/core.mjs';
import {collect,detectLocalURL,apiURL} from './lib/api.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const dataDir=process.env.WISH_DATA_DIR||path.join(root,'data');
fs.mkdirSync(dataDir,{recursive:true});
const storePath=path.join(dataDir,'records.json');
let db={accounts:[]};
if(fs.existsSync(storePath)) {try{db=JSON.parse(fs.readFileSync(storePath,'utf8').replace(/^\uFEFF/,''));if(!Array.isArray(db.accounts))throw Error();}catch{console.error('数据文件损坏。请从 data/backups 恢复 records.json 后重启；未覆盖原文件。');process.exit(1);}}
function save(accounts) {
  const next={accounts,updated:new Date().toISOString()};
  const tmp=storePath+'.tmp';fs.writeFileSync(tmp,JSON.stringify(next,null,2),'utf8');
  if(fs.existsSync(storePath)) {
    const backupDir=path.join(dataDir,'backups');fs.mkdirSync(backupDir,{recursive:true});
    fs.copyFileSync(storePath,path.join(backupDir,Date.now()+'-'+randomBytes(3).toString('hex')+'.json'));
    const files=fs.readdirSync(backupDir).filter(x=>/^\d+-[a-f0-9]+\.json$/.test(x)).sort();
    for(const f of files.slice(0,-30))fs.unlinkSync(path.join(backupDir,f));
  }
  fs.renameSync(tmp,storePath);db=next;
}
const token=randomBytes(24).toString('hex');let job=null,pending=null;
function respond(res,status,value) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
async function body(req) {
  const chunks=[];let size=0;for await(const b of req) {size+=b.length;if(size>30*1024*1024)throw Error('文件超过 30 MB，请拆分后导入');chunks.push(b);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/,''));}catch{throw Error('JSON 格式错误');}
}
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    const allowed=new Set([`127.0.0.1:${server.address().port}`,`localhost:${server.address().port}`]);
    if(!allowed.has(req.headers.host))return respond(res,403,{error:'非法请求来源'});
    const origin=req.headers.origin;
    if(origin&&!allowed.has(new URL(origin).host))return respond(res,403,{error:'非法请求来源'});
    const url=new URL(req.url,'http://127.0.0.1');
    if(url.pathname.startsWith('/api/')) {
      if(req.headers['x-wish-token']!==token)return respond(res,403,{error:'请刷新页面后重试'});
      if(req.method==='GET'&&url.pathname==='/api/state')return respond(res,200,db);
      if(req.method==='GET'&&url.pathname==='/api/storage')return respond(res,200,{file:storePath,desktop:process.env.WISH_DESKTOP==='1'});
      if(req.method==='GET'&&url.pathname==='/api/job')return respond(res,200,job??{status:'idle'});
      if(req.method==='GET'&&url.pathname==='/api/export')return respond(res,200,url.searchParams.get('format')==='uigf'?exportUIGF(db.accounts):{format:'wish-atlas-backup-v1',...db});
      if(req.method!=='POST')return respond(res,405,{error:'不支持的操作'});
      const input=await body(req);
      if(url.pathname==='/api/stop') {
        if(job?.status==='running')throw Error('同步正在进行，请完成后再重启');
        respond(res,200,{ok:true});server.close(()=>process.exit(0));
        setTimeout(()=>process.exit(0),1500).unref();return;
      }
      if(url.pathname==='/api/import') {
        const imported=importedAccounts(input);
        const enriched=imported.reduce((n,a)=>n+a.records.filter(r=>r.metadataSource).length,0);
        const merged=mergeAccounts(db.accounts,imported);save(merged.accounts);return respond(res,200,{added:merged.added,duplicates:merged.duplicates,enriched});
      }
      if(url.pathname==='/api/account') {
        const a={uid:String(input.uid),timezone:Number(input.timezone??8),records:[],settings:{}};validateAccount(a);
        if(db.accounts.some(x=>x.uid===a.uid))throw Error('该 UID 已存在');
        save([...db.accounts,a]);return respond(res,200,{uid:a.uid});
      }
      if(url.pathname==='/api/record') {
        const accounts=structuredClone(db.accounts),a=accounts.find(x=>x.uid===input.uid);if(!a)throw Error('请先选择账号');
        if(input.delete) {const old=a.records.find(x=>x.id===input.id);if(!old||old.source!=='manual')throw Error('只能删除手动补录；导入记录可修改标记');a.records=a.records.filter(x=>x.id!==input.id);}
        else if(input.id) {
          const old=a.records.find(x=>x.id===input.id);if(!old)throw Error('记录不存在');
          Object.assign(old,normalize({...old,outcome:input.outcome,target:input.target,note:input.note,gapBefore:input.gapBefore},old.source));
        } else {
          const r=normalize({...input,id:'manual-'+randomUUID(),source:'manual'},'manual');
          if(a.records.some(x=>x.time===r.time&&x.gacha_type===r.gacha_type&&x.name===r.name&&x.kind==='summary'&&r.kind==='summary'))throw Error('已有相同日期、物品的简化补录，请检查是否重复');
          a.records.push(r);
        }
        validateAccount(a);save(accounts);return respond(res,200,{ok:true});
      }
      if(url.pathname==='/api/settings') {
        const accounts=structuredClone(db.accounts),a=accounts.find(x=>x.uid===input.uid);if(!a||!POOLS[input.pool])throw Error('账号或卡池不存在');
        const pity=input.initialPity===''?null:Number(input.initialPity);
        if(pity!==null&&(!Number.isInteger(pity)||pity<0||pity>=(input.pool==='302'?80:90)))throw Error('起始垫抽数不合法');
        if(!['unknown','yes','no'].includes(input.initialGuarantee))throw Error('保底状态不合法');
        a.settings[input.pool]={initialPity:pity,initialGuarantee:input.initialGuarantee,bridge:input.bridge===true};save(accounts);return respond(res,200,{ok:true});
      }
      if(url.pathname==='/api/sync') {
        if(job?.status==='running')throw Error('已有同步正在进行');
        const full=input.full===true;
        job={status:'running',pool:'301',page:1,count:0,full,matchedPools:[]};respond(res,202,job);
        (async()=>{
          try{
            const value=input.auto?await detectLocalURL():String(input.url??'');
            // Keep checkpoints in memory, scoped to the same credential and
            // region. Never persist credentials or mix checkpoints by account.
            const key=createHash('sha256').update(apiURL(value).toString()+':'+full).digest('hex');
            if(pending?.key!==key)pending={key,checkpoint:null};
            const result=await collect(value,{accounts:db.accounts,full,resume:pending.checkpoint,checkpoint:c=>{pending.checkpoint=c;},progress:p=>{job={...job,...p};}});
            const incoming=importedAccounts({info:{uid:result.uid,region_time_zone:result.timezone},list:result.list});
            incoming[0].records.forEach(r=>r.source='api');
            const merged=mergeAccounts(db.accounts,incoming);if(merged.added)save(merged.accounts);
            job={status:'done',uid:result.uid,added:merged.added,duplicates:merged.duplicates,count:result.list.length,full,matchedPools:result.matchedPools};
            pending=null;
          }catch(e){const count=pending?.checkpoint?.records.length??0;job={status:'error',count,error:e.message+(count?` 已暂存 ${count} 条读取进度；保持后台运行，用同一链接重试可继续。`: '')};}
        })();return;
      }
      return respond(res,404,{error:'接口不存在'});
    }
    if(req.method!=='GET')return respond(res,405,{error:'不支持的操作'});
    const allowedFiles={'/':'index.html','/app.mjs':'app.mjs','/studio.mjs':'studio.mjs','/fun-core.mjs':'fun-core.mjs','/share.mjs':'share.mjs','/studio.css':'studio.css','/core.mjs':'core.mjs','/items.mjs':'items.mjs','/style.css':'style.css','/banners.json':'banners.json','/favicon.svg':'favicon.svg'};
    const name=allowedFiles[url.pathname];if(!name)return respond(res,404,{error:'页面不存在'});
    let content=fs.readFileSync(path.join(root,'public',name));
    if(name==='index.html')content=content.toString().replace('__TOKEN__',token);
    res.writeHead(200,{'Content-Type':({'html':'text/html','mjs':'text/javascript','css':'text/css','json':'application/json','svg':'image/svg+xml'})[name.split('.').at(-1)]+'; charset=utf-8','Cache-Control':'no-store'});res.end(content);
  }catch(e){respond(res,400,{error:e.message});}
});
server.listen(Number(process.env.PORT??3210),'127.0.0.1',()=>{
  console.log(`祈愿手账已启动：http://127.0.0.1:${server.address().port}`);
  process.parentPort?.postMessage({type:'ready',port:server.address().port,token});
});
server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'3210 端口已被占用。工具可能已启动，请打开 http://127.0.0.1:3210':e.message);process.exitCode=1;});

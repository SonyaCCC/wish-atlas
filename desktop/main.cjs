const {app,BrowserWindow,Menu,dialog,shell,utilityProcess}=require('electron');
const path=require('node:path');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const portableRoot=path.dirname(process.execPath);
// Version-independent storage: extracting an update never replaces player data.
const dataDir=process.env.WISH_DESKTOP_DATA_DIR||path.join(app.getPath('appData'),'WishAtlas','data');
const smokeFile=process.env.WISH_DESKTOP_SMOKE_RESULT;
app.setName('祈愿手账');
fs.mkdirSync(path.join(dataDir,'.desktop-profile'),{recursive:true});
app.setPath('userData',path.join(dataDir,'.desktop-profile'));
let win,worker,origin,token,closing=false,loaded=false;
let storageResult;
const externalHosts=new Set(['uigf.org','github.com','www.lelaer.com','www.hoyolab.com']);
function openReference(value){try{const u=new URL(value);if(u.protocol==='https:'&&externalHosts.has(u.hostname))shell.openExternal(u.href);}catch{}}
async function localAPI(route,body){const r=await fetch(origin+route,{method:body?'POST':'GET',headers:{'X-Wish-Token':token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error('本地服务请求失败');return r.json();}
function fail(message){if(smokeFile){fs.writeFileSync(smokeFile,JSON.stringify({ok:false,message}));closing=true;worker?.kill();app.exit(1);}else {dialog.showErrorBox('祈愿手账',message);app.quit();}}
if(!app.requestSingleInstanceLock()){app.quit();}else{
 app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.show();win.focus();}});
 app.whenReady().then(async()=>{
  Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'档案',submenu:[{label:'打开数据文件夹',click:()=>shell.openPath(dataDir)},{label:'打开迁移备份',click:()=>{const dir=path.join(dataDir,'backups');fs.mkdirSync(dir,{recursive:true});shell.openPath(dir);}},{type:'separator'},{role:'quit',label:'退出'}]}]));
  const appRoot=path.resolve(__dirname,'..');
  const {initializeStore,legacyCandidates}=await import(pathToFileURL(path.join(appRoot,'lib','storage.mjs')).href);
  let source=null;
  if(!fs.existsSync(path.join(dataDir,'records.json'))){
    if(smokeFile)source=process.env.WISH_DESKTOP_MIGRATION_SOURCE||null;
    else {
      const candidates=legacyCandidates(portableRoot);
      if(candidates.length===1&&!candidates[0].error)source=candidates[0].file;
      else {
        const choice=await dialog.showMessageBox({type:'question',title:'保留你的旧版档案',message:candidates.length?'发现多份旧版档案，请选择要迁移的一份。':'这是首次使用固定数据目录。你有旧版记录吗？',detail:'1.3.1 起记录保存在：'+dataDir+'\n迁移前请关闭旧版。选旧版 data/records.json 或导出的完整备份，账号、补录、标记和设置会完整复制，原文件保留。\n'+candidates.map(c=>c.file+'（'+(c.error?'需要检查':c.count+' 条')+'）').join('\n'),buttons:['选择旧版档案或完整备份','首次使用，创建空档案','退出'],defaultId:0,cancelId:2});
        if(choice.response===2){closing=true;app.quit();return;}
        if(choice.response===0){
          const selected=await dialog.showOpenDialog({title:'选择旧版 data/records.json 或完整备份',defaultPath:candidates[0]?.file,filters:[{name:'JSON 档案',extensions:['json']}],properties:['openFile']});
          if(selected.canceled){closing=true;app.quit();return;}source=selected.filePaths[0];
        }
      }
    }
  }
  storageResult=initializeStore(dataDir,source);
  worker=utilityProcess.fork(path.join(appRoot,'server.mjs'),[],{cwd:appRoot,env:{...process.env,PORT:'0',WISH_DATA_DIR:dataDir,WISH_DESKTOP:'1'},stdio:'pipe',serviceName:'祈愿手账本地数据服务'});
  const timer=setTimeout(()=>fail('本地数据服务启动超时，请确认软件已完整解压到可写入的文件夹。'),20000);
  worker.on('exit',()=>{clearTimeout(timer);if(!closing)fail('本地数据服务已退出。请检查 data/records.json 是否有效，重新打开程序。');});
  worker.on('message',async message=>{
   if(message?.type!=='ready'||loaded)return;loaded=true;clearTimeout(timer);
   origin=`http://127.0.0.1:${message.port}`;token=message.token;
   win=new BrowserWindow({width:1360,height:920,minWidth:780,minHeight:600,title:'祈愿手账',show:false,backgroundColor:'#f3f6f6',autoHideMenuBar:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,partition:'wish-atlas',webSecurity:true}});
   win.webContents.session.setPermissionRequestHandler((_web,_permission,callback)=>callback(false));
   win.webContents.session.setPermissionCheckHandler(()=>false);
   win.webContents.setWindowOpenHandler(({url})=>{openReference(url);return {action:'deny'};});
   win.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==origin){event.preventDefault();openReference(url);}});
   win.webContents.on('will-attach-webview',event=>event.preventDefault());
   win.on('close',async event=>{
    if(closing)return;event.preventDefault();
    try{const job=await localAPI('/api/job');if(job.status==='running'){
      const choice=await dialog.showMessageBox(win,{type:'question',title:'同步尚未完成',message:'退出将丢失这次尚未保存的读取进度，已有档案不受影响。',buttons:['继续同步','退出程序'],defaultId:0,cancelId:0});
      if(choice.response!==1)return;
    }}catch{}
    closing=true;worker?.kill();win.destroy();app.quit();
   });
   try{
    await win.loadURL(origin);
    if(smokeFile){
      const state=await localAPI('/api/state');
      const assets=await Promise.all(['/app.mjs','/core.mjs','/items.mjs','/banners.json','/studio.mjs','/fun-core.mjs','/share.mjs','/studio.css'].map(async p=>{const r=await fetch(origin+p);if(!r.ok)throw Error('缺少程序文件 '+p);return p;}));
      fs.writeFileSync(smokeFile,JSON.stringify({ok:true,windowCreated:!win.isDestroyed(),title:win.getTitle(),accounts:state.accounts.length,records:state.accounts.reduce((n,a)=>n+a.records.length,0),assets,origin,storage:storageResult,dataDir},null,2));
      closing=true;worker.kill();win.destroy();app.quit();
    }else {win.show();if(storageResult.mode==='migrated')dialog.showMessageBox(win,{type:'info',title:'旧版档案已完整迁移',message:`已保留 ${storageResult.uids.length} 个账号、${storageResult.count} 条记录。`,detail:'已校验原文件与新档案的 SHA-256 完全一致；补录、手动标记和设置均保留。\n原文件未删除，迁移备份不会被常规快照轮换清除。\n以后更新直接读取固定数据目录：'+dataDir+'\n完成迁移后请使用新版，旧版仍使用旧目录，两边不会互相同步。'});}
   }catch{fail('界面无法加载，请确认整个软件文件夹已解压完整。');}
  });
 }).catch(e=>fail('档案初始化失败，未用空数据覆盖旧记录。\n'+e.message+'\n数据目录：'+dataDir));
 app.on('window-all-closed',()=>app.quit());
 app.on('before-quit',()=>{closing=true;worker?.kill();});
}

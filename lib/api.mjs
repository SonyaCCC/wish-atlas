import {readFile,readdir,stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {compare,poolOf} from '../public/core.mjs';
export function apiURL(value) {
  let u; try {u=new URL(value.trim().replace(/\\([_&])/g,'$1').replace(/&amp;/g,'&'));}catch{throw Error('请粘贴完整的祈愿历史链接');}
  if(u.protocol!=='https:'||!/(^|\.)(mihoyo\.com|hoyoverse\.com)$/.test(u.hostname)) throw Error('只接受米哈游 / HoYoverse 官方历史链接');
  const raw=u.search.match(/(?:\?|&)authkey=([^&]+)/)?.[1];
  if(raw?.includes('+')&&!raw.includes('%')) u.searchParams.set('authkey',raw);
  if(!u.searchParams.get('authkey')) throw Error('链接缺少 authkey，请重新打开游戏中的祈愿历史获取链接');
  const overseas=u.hostname.includes('hoyoverse')||u.hostname.includes('-os')||u.hostname.includes('-sea');
  const result=new URL(`https://${overseas?'public-operation-hk4e-sg.hoyoverse.com':'public-operation-hk4e.mihoyo.com'}/gacha_info/api/getGachaLog`);
  for(const key of ['authkey','authkey_ver','sign_type','auth_appid','region','game_biz']) if(u.searchParams.has(key)) result.searchParams.set(key,u.searchParams.get(key));
  result.searchParams.set('lang','zh-cn');
  return result;
}
const permissionHint='程序的联网权限被运行环境拒绝。请关闭当前后台服务，再从资源管理器双击“启动祈愿手账.cmd”启动；不需要管理员权限。';
export function requestFailure(error) {
  if(error.safeMessage) return error;
  const nested=[error,error.cause,...(error.cause?.errors??[])];
  const codes=nested.map(e=>e?.code);
  let message='无法连接原神官方接口，请检查网络或代理设置后重试。';
  let fatal=false;
  if(codes.some(c=>['EACCES','EPERM'].includes(c))) {message=permissionHint;fatal=true;}
  else if(codes.some(c=>['ENOTFOUND','EAI_AGAIN'].includes(c))) message='无法解析原神官方接口域名，请检查网络与 DNS 设置后重试。';
  else if(error.name==='TimeoutError'||codes.some(c=>['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT'].includes(c))) message='连接原神官方接口超时，请检查网络或代理设置后重试。';
  else if(codes.some(c=>/CERT|TLS|SELF_SIGNED|VERIFY_LEAF/.test(c??''))) message='原神官方接口的 HTTPS 证书验证失败，请检查系统时间或代理证书配置。';
  return Object.assign(Error(message+' 已有记录未改动。'),{safeMessage:true,fatal});
}
function safeError(message,fatal=false) {return Object.assign(Error(message),{safeMessage:true,fatal});}
// Walk both histories in newest-first order. IDs alone do not prove that
// adjacent records agree; keep the local position and compare immutable fields.
function overlapMatcher(accounts,uid,pool) {
  const local=(accounts.find(a=>String(a.uid)===uid)?.records??[]).filter(r=>poolOf(r)===pool).slice().sort((a,b)=>compare(b,a));
  const indices=new Map(local.map((r,i)=>[String(r.id),i]));
  let previous=-2,run=0;
  return record=>{
    const index=indices.get(String(record.id)),old=local[index];
    const same=old&&old.kind!=='summary'&&/^\d+$/.test(String(record.id))&&
      ['id','time','name','rank_type','gacha_type'].every(k=>record[k]!=null&&String(record[k])===String(old[k]))&&
      ['item_id','item_type'].every(k=>!record[k]||!old[k]||String(record[k])===String(old[k]));
    if(!same){previous=-2;run=0;return false;}
    run=index===previous+1&&!local[previous]?.gapBefore?run+1:1;
    previous=index;
    return run>=20;
  };
}
export async function collect(value,{fetcher=fetch,delay=ms=>new Promise(r=>setTimeout(r,ms)),progress=()=>{},resume=null,checkpoint=()=>{},accounts=[],full=false}={}) {
  const base=apiURL(value),records=[...(resume?.records??[])],positions=structuredClone(resume?.positions??{});let uid=resume?.uid??null;
  const remember=()=>checkpoint({uid,records,positions:structuredClone(positions)});
  for(const pool of ['301','302','200','500','100']) {
    if(positions[pool]?.complete)continue;
    let matches=null;
    const initMatcher=()=>{
      matches=overlapMatcher(accounts,uid,pool);
      // Reconstruct a partial window after a failed request, using current
      // local records rather than indices from a potentially changed database.
      for(const r of records.filter(r=>poolOf(r)===pool).slice(-19))matches(r);
    };
    if(uid&&!full)initMatcher();
    let end=positions[pool]?.end??'0';const seen=new Set(end==='0'?[]:[end]);
    for(let page=positions[pool]?.page??1;page<=10000;page++) {
      progress({pool,page,count:records.length,retry:0,matchedPools:Object.keys(positions).filter(p=>positions[p].reason==='overlap')});
      const url=new URL(base);url.searchParams.set('gacha_type',pool);url.searchParams.set('page',String(page));url.searchParams.set('size','20');url.searchParams.set('end_id',end);
      let json;
      for(let retry=0;retry<5;retry++) {
        try {
          const response=await fetcher(url,{signal:AbortSignal.timeout(20000),redirect:'error'});
          if(!response.ok) throw safeError(`原神官方接口返回 HTTP ${Number(response.status)}；已有记录未改动。`,[400,401,403,404].includes(response.status));
          try {json=await response.json();} catch {throw safeError('官方接口没有返回有效的 JSON，可能受到代理或网络拦截；已有记录未改动。');}
          if(json.retcode!==0) {
            if(/authkey|auth key/i.test(json.message??'')) throw safeError('历史链接已过期或无效，请在游戏中重新打开祈愿历史并获取链接',true);
            throw safeError(`官方接口暂不可用（错误码 ${Number(json.retcode)}）；已有记录未改动。`);
          }
          if(!Array.isArray(json.data?.list)) throw safeError('官方接口返回格式异常；已有记录未改动。',true);
          break;
        } catch(e) {
          const failure=requestFailure(e);if(failure.fatal||retry===4) throw failure;
          progress({pool,page,count:records.length,retry:retry+1});
          await delay([1000,3000,6000,10000][retry]);
        }
      }
      const list=json.data.list;
      if(!list.length) {positions[pool]={complete:true,page,end};remember();break;}
      const pageUid=String(list[0].uid);
      if(uid&&pageUid!==uid||list.some(r=>String(r.uid)!==pageUid))throw Error('接口返回了不同 UID，已终止同步');
      if(list.some(r=>r.gacha_type!=null&&poolOf(r)!==pool))throw Error('接口返回了不同卡池，已终止同步');
      if(!uid){uid=pageUid;if(!full)initMatcher();}
      const next=list.at(-1).id;
      if(typeof next!=='string'||seen.has(next)) throw Error('接口分页异常，已终止同步');
      let matched=false;
      for(const r of list) {
        records.push(r);
        if(matches?.(r)){matched=true;break;}
      }
      seen.add(next);end=next;
      positions[pool]={page:page+1,end,complete:matched,...(matched?{reason:'overlap'}:{})};remember();
      if(matched)break;
      if(page===10000) throw Error('记录数量超过单次导入限制');
      await delay(350);
    }
  }
  if(!uid) throw Error('没有查询到抽卡记录；请确认账号、链接和游戏记录是否已更新');
  const region=base.searchParams.get('region')??'';
  return {uid,timezone:region==='os_usa'?-5:region==='os_euro'?1:8,list:records,matchedPools:Object.keys(positions).filter(p=>positions[p].reason==='overlap')};
}
export async function detectLocalURL({userHome=homedir(),io={readFile,readdir,stat}}={}) {
  const candidates=[],visited=new Set();let permissionDenied=false,logFound=false,cacheFound=false;
  const denied=e=>{if(['EACCES','EPERM'].includes(e.code))permissionDenied=true;};
  for(const game of ['原神','Genshin Impact']) {
    const log=path.join(userHome,'AppData','LocalLow','miHoYo',game,'output_log.txt');
    let text;try{text=await io.readFile(log,'utf8');logFound=true;}catch(e){denied(e);continue;}
    const found=[...text.matchAll(/[A-Za-z]:[\\/][^\r\n"<>]*?(?:YuanShen_Data|GenshinImpact_Data)/g)];
    for(const match of found) {
      const cache=path.join(match[0],'webCaches');
      if(visited.has(cache))continue;visited.add(cache);
      async function walk(dir,depth) {
        if(depth>4)return;
        let entries;try{entries=await io.readdir(dir,{withFileTypes:true});cacheFound=true;}catch(e){denied(e);return;}
        for(const entry of entries) {
          const file=path.join(dir,entry.name);
          if(entry.isDirectory()) await walk(file,depth+1);
          else if(/^data_[0-3]$/.test(entry.name)) {try{const s=await io.stat(file);if(s.size<64*1024*1024)candidates.push({file,mtime:s.mtimeMs});}catch(e){denied(e);}}
        }
      }
      await walk(cache,0);
    }
  }
  for(const c of candidates.sort((a,b)=>b.mtime-a.mtime)) {
    let text;try{text=(await io.readFile(c.file)).toString('utf8');}catch(e){denied(e);continue;}
    const urls=[...text.matchAll(/https:\/\/[^\s\x00-\x1f"<>]+authkey=[^\s\x00-\x1f"<>]+/g)];
    for(const m of urls.reverse()) {try{apiURL(m[0]);return m[0];}catch{}}
  }
  if(permissionDenied)throw Error('程序没有权限读取原神日志或祈愿缓存。请关闭当前后台服务，再从资源管理器双击“启动祈愿手账.cmd”启动；不需要管理员权限。也可粘贴历史链接。');
  if(!logFound)throw Error('未找到 PC 原神的游戏日志。请先在本机启动游戏并打开祈愿历史；云游戏或其他设备的记录请用链接或 UIGF 导入。');
  if(!cacheFound)throw Error('已找到游戏日志，但未找到对应的网页缓存目录。请重新打开游戏中的祈愿历史；若游戏安装位置已更改，可先粘贴历史链接同步。');
  throw Error('已读取游戏缓存，但没有找到祈愿历史链接。请打开祈愿→历史记录并翻页后重试；也可粘贴链接或导入 UIGF。');
}

import {ITEMS} from './items.mjs';
export const POOLS = {'301':'角色活动','302':'武器活动','200':'常驻祈愿','500':'集录祈愿','100':'新手祈愿'};
export const OUTCOMES = {auto:'自动判断',win:'小保底不歪',loss:'歪了',guaranteed:'大保底 UP',radiance:'捕获明光',up:'UP（保底未知）',unknown:'无法判定'};
export const poolOf = r => String(r.gacha_type)==='400'?'301':String(r.gacha_type);
export const average = a => a.length ? a.reduce((s,x)=>s+x,0)/a.length : null;
export function compare(a,b) {
  const t = a.time.localeCompare(b.time);
  if (t) return t;
  if (/^\d+$/.test(a.id)&&/^\d+$/.test(b.id)) return BigInt(a.id)<BigInt(b.id)?-1:BigInt(a.id)>BigInt(b.id)?1:0;
  return a.id.localeCompare(b.id);
}
export function validTime(t) {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(t)) return false;
  const d = new Date(t.replace(' ','T')+'Z');
  return Number.isFinite(+d) && d.toISOString().slice(0,19).replace('T',' ')===t;
}
export function normalize(r, source='import',fileItems={}) {
  if (!r || typeof r!=='object') throw Error('记录格式错误');
  const itemName=String(r.name??'').trim();
  const catalog=ITEMS[itemName],local=fileItems[itemName];
  if(r.rank_type==null||r.rank_type==='') {
    const item=catalog??local;
    if(!item)throw Error(`无法识别“${itemName||'未命名物品'}”的星级，请更新物品资料或补充该条 rank_type`);
    r={...r,rank_type:item.rank_type,item_type:r.item_type||item.item_type,metadataSource:catalog?'catalog':'file'};
  }
  if (typeof r.id!=='string'||!r.id||r.id.length>100) throw Error('抽卡 ID 必须是字符串，不能丢失长整数精度');
  const time = String(r.time??'').replace('T',' ');
  if (!validTime(time)) throw Error('记录时间应为 YYYY-MM-DD HH:mm:ss');
  if (!Object.hasOwn(POOLS,poolOf(r))) throw Error('不支持的卡池类型');
  if (![3,4,5].includes(Number(r.rank_type))) throw Error(`“${itemName}”的星级无效：rank_type 应为 3、4 或 5`);
  if (!String(r.name??'').trim()) throw Error('记录缺少物品名称');
  if (r.count!=null && String(r.count)!=='1') throw Error('逐抽记录 count 必须为 1');
  const kind = r.kind==='summary'?'summary':'exact';
  const span = kind==='summary'?Number(r.span):1;
  if (!Number.isInteger(span)||span<1||span>(poolOf(r)==='302'?80:90)||kind==='summary'&&Number(r.rank_type)!==5) throw Error('五星补录抽数超出卡池范围');
  const outcome = r.outcome??'auto';
  if (!Object.hasOwn(OUTCOMES,outcome)) throw Error('无效的歪卡标记');
  if (!['unknown','yes','no'].includes(r.target??'unknown')) throw Error('无效的定轨标记');
  return {id:r.id,gacha_type:String(r.gacha_type),time,name:String(r.name).trim().slice(0,100),rank_type:String(r.rank_type),item_type:String(r.item_type||catalog?.item_type||local?.item_type||''),item_id:String(r.item_id??''),kind,span,outcome,target:r.target??'unknown',gapBefore:r.gapBefore===true,note:String(r.note??'').slice(0,500),source:r.source==='manual'?'manual':source,metadataSource:['catalog','file'].includes(r.metadataSource)?r.metadataSource:undefined};
}
export function importedAccounts(input) {
  if (input?.format==='wish-atlas-backup-v1') {
    if (!Array.isArray(input.accounts)) throw Error('备份文件无效');
    return input.accounts.map(a=>({uid:String(a.uid),timezone:Number(a.timezone??8),records:a.records.map(r=>normalize(r,r.source)),settings:a.settings??{}}));
  }
  const accounts = Array.isArray(input?.hk4e)?input.hk4e:Array.isArray(input?.list)?[{...input.info,list:input.list,timezone:input.info?.region_time_zone}]:null;
  if (!accounts?.length) throw Error('请选择原神 UIGF 2.x / 3.x / 4.x 或本工具完整备份 JSON');
  return accounts.map(a=>{
    const fileItems=Object.create(null);
    for(const r of a.list){
      if(![3,4,5].includes(Number(r.rank_type)))continue;
      const name=String(r.name??'').trim(),rank=String(r.rank_type);
      if(fileItems[name]&&fileItems[name].rank_type!==rank)throw Error(`“${name}”在文件中出现不同星级，未导入`);
      fileItems[name]={rank_type:rank,item_type:r.item_type??''};
    }
    return {uid:String(a.uid??''),timezone:Number(a.timezone??8),records:a.list.map(r=>normalize(r,'import',fileItems)),settings:{}};
  });
}
export function validateAccount(a) {
  if (!/^\d{5,12}$/.test(a.uid)) throw Error('UID 必须为 5–12 位数字');
  if (!Number.isInteger(a.timezone)||a.timezone< -12||a.timezone>14) throw Error('账号时区无效');
  if(a.settings!=null) {
    if(typeof a.settings!=='object'||Array.isArray(a.settings))throw Error('历史衔接设置无效');
    for(const [p,cfg] of Object.entries(a.settings)) {
      if(!Object.hasOwn(POOLS,p)||!cfg||typeof cfg!=='object')throw Error('历史衔接设置无效');
      if(cfg.initialPity!=null&&(!Number.isInteger(cfg.initialPity)||cfg.initialPity<0||cfg.initialPity>=(p==='302'?80:90)))throw Error('备份起始垫抽数无效');
      if(cfg.initialGuarantee!=null&&!['unknown','yes','no'].includes(cfg.initialGuarantee))throw Error('备份保底状态无效');
    }
  }
  for (const pool of Object.keys(POOLS)) {
    const rows=a.records.filter(r=>poolOf(r)===pool).sort(compare);
    const exact=rows.find(r=>r.kind!=='summary');
    if (exact && rows.some(r=>r.kind==='summary'&&r.time>=exact.time)) throw Error(`${POOLS[pool]}：简化补录只能早于该池最早逐抽记录，避免重复计算。重叠记录请先删除简化补录。`);
  }
}
export function mergeAccounts(current,incoming) {
  const result=structuredClone(current); let added=0,duplicates=0;
  for (const src of incoming) {
    validateAccount(src);
    let a=result.find(x=>x.uid===src.uid);
    if (!a) {a={uid:src.uid,timezone:src.timezone,settings:src.settings??{},records:[]};result.push(a);}
    if (a.records.length && a.timezone!==src.timezone) throw Error('同一 UID 的时区不一致，请先核对导出文件');
    const map=new Map(a.records.map(r=>[r.id,r]));
    for (const r of src.records) {
      const old=map.get(r.id);
      if (old) {
        if (old.time!==r.time||old.gacha_type!==r.gacha_type||old.name!==r.name||old.rank_type!==r.rank_type) throw Error(`ID ${r.id} 的记录内容冲突，未导入`);
        duplicates++;
      } else {map.set(r.id,r);added++;}
    }
    a.records=[...map.values()].sort(compare);validateAccount(a);
  }
  return {accounts:result,added,duplicates};
}
function shifted(t, hours) {return new Date(new Date(t.replace(' ','T')+'Z').getTime()+hours*3600000).toISOString().slice(0,19).replace('T',' ');}
export function featuredStatus(r,calendar,timezone=8) {
  if (!['301','302'].includes(poolOf(r))) return null;
  const knownNames=new Set(['琴','迪卢克','七七','莫娜','刻晴','提纳里','迪希雅','梦见月瑞希','风鹰剑','天空之刃','天空之傲','狼的末路','天空之脊','和璞鸢','天空之卷','四风原典','天空之翼','阿莫斯之弓',...calendar.flatMap(b=>b.featured)]);
  if(!knownNames.has(r.name)) return null;
  const rules=calendar.filter(b=>b.pool===poolOf(r)&&r.time>=shifted(b.start,b.timezoneDependent?timezone-8:0)&&r.time<=b.end);
  if (!rules.length) return null;
  return rules.some(b=>b.featured.includes(r.name));
}
export function analyze(account,calendar=[]) {
  const records=[...(account?.records??[])].sort(compare), pools={};
  for (const pool of Object.keys(POOLS)) {
    const rows=records.filter(r=>poolOf(r)===pool), cfg=account?.settings?.[pool]??{};
    let pity=Number(cfg.initialPity??0),known=cfg.initialPity!=null, guarantee=cfg.initialGuarantee??'unknown';
    let cost=0,costKnown=known&&pity===0,prev=null,segment=0;
    let wins=0,losses=0,guarantees=0,radiance=0,unknown=0,total=0,four=0;
    const fives=[],upCosts=[],monthly={},histogram=Array(9).fill(0);
    for (const r of rows) {
      const disconnected = r.gapBefore || (prev?.kind==='summary'&&r.kind!=='summary'&&!cfg.bridge);
      if (disconnected) {pity=0;known=false;guarantee='unknown';cost=0;costKnown=false;segment++;}
      if(r.kind==='summary') {pity=r.span;known=true;} else pity++;
      const n=r.kind==='summary'?r.span:1;
      total+=n;cost+=n;
      monthly[r.time.slice(0,7)]=(monthly[r.time.slice(0,7)]??0)+n;
      if(r.rank_type==='4') four++;
      if(r.rank_type==='5') {
        const featured=featuredStatus(r,calendar,account.timezone);
        let outcome=r.outcome??'auto';
        if(outcome==='auto') {
          outcome=featured===false?'loss':featured===true?(guarantee==='yes'?'guaranteed':guarantee==='no'?'win':'up'):'unknown';
        }
        // Chronicled Wish requires the user's chosen target, which is absent
        // from the API. Preserve explicit labels, but never infer its outcome.
        if(!['301','302','500'].includes(pool)) outcome='unknown';
        const up=['win','guaranteed','radiance','up'].includes(outcome);
        if (outcome==='win'||outcome==='radiance') wins++;
        if (outcome==='loss') losses++;
        if (outcome==='guaranteed') guarantees++;
        if (outcome==='radiance') radiance++;
        if (outcome==='unknown'||outcome==='up') unknown++;
        const upCost=up&&costKnown&&pool!=='500'?cost:null;
        if(up) {if(upCost!=null) upCosts.push(upCost);cost=0;costKnown=true;}
        else if(outcome==='unknown') {cost=0;costKnown=false;}
        // Weapon Fate Points are not present in the API. After an UP that
        // might have missed the chosen path, the next gold may be guaranteed.
        guarantee=pool==='500'?'unknown':outcome==='loss'?'yes':up?(pool==='302'&&r.target!=='yes'?'unknown':'no'):'unknown';
        const interval=known?pity:null;
        fives.push({...r,outcome,interval,observed:pity,up,upCost,segment});
        if(interval!=null) histogram[Math.min(8,Math.floor((interval-1)/10))]++;
        pity=0;known=true;
      }
      prev=r;
    }
    const intervals=fives.map(r=>r.interval).filter(x=>x!=null);
    const exact=rows.filter(r=>r.kind!=='summary');
    const sorted=[...intervals].sort((a,b)=>a-b);
    const median=sorted.length?(sorted[Math.floor((sorted.length-1)/2)]+sorted[Math.floor(sorted.length/2)])/2:null;
    let streak=0,bestStreak=0,lastSegment=0;
    for (const r of fives) {if(r.segment!==lastSegment)streak=0;lastSegment=r.segment;if(['win','radiance'].includes(r.outcome)) {streak++;bestStreak=Math.max(bestStreak,streak);} else if(r.outcome!=='guaranteed') streak=0;}
    pools[pool]={rows,total,four,fives,wins,losses,guarantees,radiance,unknown,winRate:wins+losses?wins/(wins+losses)*100:null,avg:average(intervals),median,min:sorted[0]??null,max:sorted.at(-1)??null,intervals:intervals.length,avgUp:average(upCosts),upSamples:upCosts.length,pity,known,guarantee,monthly,histogram,bestStreak,exactCount:exact.length,summaryCount:rows.length-exact.length,observedFiveRate:exact.length?exact.filter(r=>r.rank_type==='5').length/exact.length*100:null};
  }
  return {pools,total:Object.values(pools).reduce((s,p)=>s+p.total,0),fives:Object.values(pools).reduce((s,p)=>s+p.fives.length,0),records};
}
export function exportUIGF(accounts) {
  return {info:{export_timestamp:Math.floor(Date.now()/1000),export_app:'Wish Atlas',export_app_version:'1.3.1',version:'v4.0'},hk4e:accounts.map(a=>({uid:a.uid,timezone:a.timezone,lang:'zh-cn',list:a.records.filter(r=>r.kind!=='summary'&&/^\d+$/.test(r.id)&&r.source!=='manual').map(r=>({id:r.id,gacha_type:r.gacha_type,uigf_gacha_type:poolOf(r),item_id:r.item_id,name:r.name,item_type:r.item_type,rank_type:r.rank_type,time:r.time,count:'1'}))}))};
}

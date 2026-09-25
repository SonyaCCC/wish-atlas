import {analyze,average,compare,poolOf,POOLS} from './core.mjs';
import {ITEMS} from './items.mjs';

export function dateRange(preset='all',today=new Date().toISOString().slice(0,10),from='',to='') {
  if(preset==='year')return {from:today.slice(0,4)+'-01-01',to:today};
  if(preset==='month')return {from:today.slice(0,7)+'-01',to:today};
  if(preset==='custom'){
    const valid=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
    if(!valid(from)||!valid(to)||from>to)throw Error('请选择有效的起止日期，结束日期不能早于开始日期');
    return {from,to};
  }
  return {from:'',to:''};
}
export function scopedAccount(account,{from='',to='',pool='all'}={}) {
  const records=(account?.records??[]).filter(r=>(pool==='all'||poolOf(r)===pool)&&(!from||r.time.slice(0,10)>=from)&&(!to||r.time.slice(0,10)<=to));
  const settings={};
  for(const p of Object.keys(POOLS)){
    const original=(account?.records??[]).filter(r=>poolOf(r)===p).sort(compare),first=records.filter(r=>poolOf(r)===p).sort(compare)[0];
    // A date filter is a new unknown boundary unless it retains the real start.
    if(first&&first.id===original[0]?.id)settings[p]=account.settings?.[p]??{};
  }
  return {uid:account?.uid??'',timezone:account?.timezone??8,records,settings};
}
export function bestWindows(records,sizes=[10,30,100]) {
  const best=Object.fromEntries(sizes.map(n=>[n,null]));
  for(const pool of Object.keys(POOLS)){
    let segment=[];
    const flush=()=>{
      for(const size of sizes){
        let gold=0;
        for(let i=0;i<segment.length;i++){
          gold+=Number(segment[i].rank_type==='5');
          if(i>=size)gold-=Number(segment[i-size].rank_type==='5');
          if(i+1>=size&&(!best[size]||gold>best[size].count)){
            const rows=segment.slice(i-size+1,i+1);
            best[size]={size,count:gold,pool,start:rows[0].time,end:rows.at(-1).time,golds:rows.filter(r=>r.rank_type==='5')};
          }
        }
      }
      segment=[];
    };
    for(const r of records.filter(r=>poolOf(r)===pool).sort(compare)){
      if(r.gapBefore||r.kind==='summary')flush();
      if(r.kind!=='summary')segment.push(r);
    }
    flush();
  }
  return best;
}
export function forecast(account,calendar,pool,additional=30) {
  const p=analyze(account,calendar).pools[pool],limit=pool==='302'?80:90;
  if(pool==='100')return {reason:'新手祈愿不做保底假设'};
  if(!p?.known)return {reason:'当前垫抽起点未知，补全衔接信息后才能计算'};
  if(!Number.isInteger(additional)||additional<1||p.pity+additional>limit)return {reason:`按当前垫抽，最多再 ${Math.max(0,limit-p.pity)} 抽到五星保底，请调整假设`};
  const interval=p.pity+additional,avg=(p.avg*p.intervals+interval)/(p.intervals+1);
  return {interval,avg,primogems:avg*160,samples:p.intervals+1};
}
export function funReport(account,calendar=[],scope={}) {
  const selected=scopedAccount(account,scope),stats=analyze(selected,calendar),rows=stats.records;
  const fives=Object.values(stats.pools).flatMap(p=>p.fives).sort(compare);
  const intervals=fives.filter(r=>r.interval!=null),days={},months={},groups=new Map();
  for(const r of rows){
    const date=r.time.slice(0,10),month=date.slice(0,7),n=r.kind==='summary'?r.span:1;
    days[date]??={date,pulls:0,golds:0};days[date].pulls+=n;days[date].golds+=Number(r.rank_type==='5');
    months[month]??={date:month,pulls:0,golds:0};months[month].pulls+=n;months[month].golds+=Number(r.rank_type==='5');
  }
  for(const r of fives){
    const type=r.item_type||ITEMS[r.name]?.item_type||'未知类型',key=type+'\0'+r.name;
    if(!groups.has(key))groups.set(key,{name:r.name,type,count:0,records:[],losses:0});
    const g=groups.get(key);g.count++;g.records.push(r);g.losses+=Number(r.outcome==='loss'&&['301','302'].includes(poolOf(r)));
  }
  const ranking=[...groups.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'zh-CN'));
  const chases=[];
  for(const pool of ['301','302']){
    let golds=[];
    for(const r of stats.pools[pool].fives){
      if(golds.length&&golds.at(-1).segment!==r.segment)golds=[];
      golds.push(r);
      if(r.up){if(r.upCost!=null)chases.push({pool,cost:r.upCost,target:r.name,end:r.time,golds:[...golds]});golds=[];}
      else if(r.outcome==='unknown')golds=[];
    }
  }
  chases.sort((a,b)=>b.cost-a.cost);
  const trends=Object.entries(stats.pools).map(([pool,p])=>{
    const known=p.fives.filter(r=>r.interval!=null);
    const points=known.map((r,i)=>({date:r.time.slice(0,10),avg:average(known.slice(Math.max(0,i-9),i+1).map(x=>x.interval)),samples:Math.min(10,i+1),segment:r.segment}));
    return {pool,avg:p.avg,recent:points.at(-1)?.avg??null,samples:points.at(-1)?.samples??0,points};
  });
  const character=stats.pools['301'],weapon=stats.pools['302'];
  let currentStreak=0;
  for(const r of [...character.fives].reverse()){
    if(r.segment!==character.fives.at(-1)?.segment)break;
    if(['win','radiance'].includes(r.outcome))currentStreak++;
    else if(r.outcome!=='guaranteed')break;
  }
  const fastest=intervals.reduce((best,r)=>!best||r.interval<best.interval?r:best,null);
  const titles=[];
  if(currentStreak>=3)titles.push({name:'小保底连胜中',rule:`角色池当前连续 ${currentStreak} 次小保底不歪（大保底跳过，未知或断档中断）`});
  if(ranking.some(g=>g.losses>=3))titles.push({name:'常驻老朋友',rule:'角色或武器活动池中，同一五星至少 3 次被标记为歪'});
  if(fastest?.interval<=10)titles.push({name:'早早赴约',rule:'至少一个已知完整出金区间不超过 10 抽'});
  const last=fives.at(-1);
  if(last?.interval!=null&&poolOf(last)!=='100'&&last.interval>=(poolOf(last)==='302'?75:85))titles.push({name:'最后几抽的惊喜',rule:'最近一次五星位于对应卡池硬保底前最后 6 抽区间'});
  const bestDay=Object.values(days).sort((a,b)=>b.pulls-a.pulls||a.date.localeCompare(b.date))[0]??null;
  const bestMonth=Object.values(months).sort((a,b)=>b.golds-a.golds||a.date.localeCompare(b.date))[0]??null;
  return {stats,fives,ranking,windows:bestWindows(rows),chases,trends,days,months,fastest,bestDay,bestMonth,titles,currentStreak,
    characters:fives.filter(r=>(r.item_type||ITEMS[r.name]?.item_type)==='角色').length,
    weapons:fives.filter(r=>(r.item_type||ITEMS[r.name]?.item_type)==='武器').length,
    character,weapon,avg:average(intervals.map(r=>r.interval)),samples:intervals.length,
    range:rows.length?`${rows[0].time.slice(0,10)} — ${rows.at(-1).time.slice(0,10)}`:'此范围暂无记录',
    summaries:rows.filter(r=>r.kind==='summary').length,gaps:rows.filter(r=>r.gapBefore).length};
}

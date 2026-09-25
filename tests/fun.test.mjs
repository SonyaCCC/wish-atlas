import test from 'node:test';
import assert from 'node:assert/strict';
import {normalize} from '../public/core.mjs';
import {dateRange,scopedAccount,bestWindows,forecast,funReport} from '../public/fun-core.mjs';
import {cardPages,zipFiles} from '../public/share.mjs';
const row=(id,extra={})=>normalize({id:String(id),gacha_type:'301',rank_type:'3',name:'弹弓',time:'2026-01-01 12:00:00',...extra});
const account=(records,settings={})=>({uid:'123456789',timezone:8,records,settings});
const gold=(id,span,outcome='win',extra={})=>row(id,{name:'纳西妲',rank_type:'5',kind:'summary',span,outcome,...extra});
test('date ranges validate calendar dates; trimming history discards an inherited initial pity',()=>{
 assert.deepEqual(dateRange('month','2026-09-26'),{from:'2026-09-01',to:'2026-09-26'});
 assert.deepEqual(dateRange('year','2026-09-26'),{from:'2026-01-01',to:'2026-09-26'});
 assert.throws(()=>dateRange('custom','', '2026-02-30','2026-03-01'));
 assert.throws(()=>dateRange('custom','', '2026-02-03','2026-02-01'));
 const a=account([row(1,{time:'2025-12-31 12:00:00'}),row(2,{rank_type:'5',name:'纳西妲'})],{'301':{initialPity:70}});
 assert.equal(scopedAccount(a,{}).settings['301'].initialPity,70);
 assert.deepEqual(scopedAccount(a,{from:'2026-01-01'}).settings,{});
 const report=funReport(a,[],{from:'2026-01-01'});assert.equal(report.samples,0);assert.equal(report.stats.total,1);assert.equal(report.fives[0].interval,null);
});
test('best windows combine 301/400 but never cross pools, gaps or summary records',()=>{
 const rows=Array.from({length:20},(_,i)=>row(i,{gacha_type:i%2?'400':'301',rank_type:i===8||i===10?'5':'3'}));
 assert.equal(bestWindows(rows)[10].count,2);
 const gap=rows.map((r,i)=>({...r,gapBefore:i===9||i===18}));assert.equal(bestWindows(gap)[10],null);
 const mixed=rows.map((r,i)=>({...r,gacha_type:i<9?'301':'302'}));assert.equal(bestWindows(mixed)[10].count,1);
 assert.equal(bestWindows([...rows.slice(0,9),gold(100,70),...rows.slice(9,18).map(r=>({...r,time:'2026-01-02 00:00:00'}))])[10],null);
 assert.equal(bestWindows(rows)[30],null);
});
test('reports retain whole UP chases, rank duplicates and summarize calendar without inventing pulls',()=>{
 const a=account([gold(1,70,'loss',{name:'七七'}),gold(2,75,'guaranteed'),gold(3,40)],{'301':{initialPity:0}}),r=funReport(a);
 assert.equal(r.chases[0].cost,145);assert.deepEqual(r.chases[0].golds.map(x=>x.name),['七七','纳西妲']);
 assert.equal(r.ranking[0].name,'纳西妲');assert.equal(r.ranking[0].count,2);
 assert.equal(r.bestDay.pulls,185);assert.equal(r.bestMonth.golds,3);assert.equal(r.characters,3);assert.equal(r.weapons,0);
 assert.equal(r.windows[10],null);assert.equal(r.trends.find(x=>x.pool==='301').recent,185/3);
 const broken=funReport({...a,records:a.records.map((x,i)=>({...x,gapBefore:i===1}))});assert.equal(broken.chases[0].cost,40);
});
test('forecasts use current known pity and exclude impossible or unknown assumptions',()=>{
 const a=account([gold(1,70),row(2,{time:'2026-01-02 00:00:00'})],{'301':{initialPity:0,bridge:true}});
 assert.equal(forecast(a,[],'301',29).avg,50);assert.equal(forecast(a,[],'301',29).interval,30);
 assert.match(forecast(a,[],'301',90).reason,/最多再/);
 assert.match(forecast(account([row(1)]),[],'301',10).reason,/未知/);
 assert.match(forecast(a,[],'100',10).reason,/新手/);
});
test('title conditions use sample evidence; unknown results and gaps break current streak',()=>{
 const a=account([gold(1,5),gold(2,10),gold(3,20)]),r=funReport(a);
 assert.equal(r.currentStreak,3);assert.ok(r.titles.some(x=>x.name==='小保底连胜中'));assert.ok(r.titles.some(x=>x.name==='早早赴约'));
 assert.equal(funReport({...a,records:[...a.records,gold(4,50,'unknown')]}).currentStreak,0);
 assert.equal(funReport({...a,records:a.records.map((g,i)=>({...g,gapBefore:i===2}))}).currentStreak,1);
});
test('share defaults hide UIDs, keeps denominators, and paginates every record without loss',()=>{
 const a=account(Array.from({length:23},(_,i)=>gold(i+1,10))),r=funReport(a);
 const pages=cardPages(r,{type:'timeline',uid:a.uid});assert.equal(pages.length,3);assert.equal(pages.flatMap(x=>x.entries).length,23);assert.ok(pages.every(x=>x.uid==null));
 const journey=cardPages(r,{type:'character',character:'纳西妲'});assert.equal(journey.length,3);assert.match(journey[2].entries[0].label,/第 19 次/);
 assert.equal(cardPages(r,{uid:a.uid,showUid:true})[0].uid,a.uid);
 const pair=cardPages(r,{type:'compare',uid:a.uid,secondUid:'987654321'},r)[0];assert.equal(pair.secondUid,null);assert.match(pair.entries[1].detail,/23 \/ 23/);
 assert.ok(cardPages(funReport(account([])))[0].entries.every(e=>!e.value.includes('NaN')));
});
test('PNG bundle is a standard ZIP with UTF-8 names, checksums and correct central offsets',async()=>{
 const data=new TextEncoder().encode('abc'),bytes=new Uint8Array(await zipFiles([{name:'wish-001.png',data}]).arrayBuffer()),v=new DataView(bytes.buffer);
 assert.equal(v.getUint32(0,true),0x04034b50);assert.equal(v.getUint32(14,true),0x352441c2);
 const central=v.getUint32(bytes.length-6,true);assert.equal(v.getUint32(central,true),0x02014b50);assert.equal(v.getUint16(bytes.length-12,true),1);
 assert.deepEqual(bytes.slice(42,45),data);
});

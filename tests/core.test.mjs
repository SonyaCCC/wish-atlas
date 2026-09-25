import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalize,analyze,importedAccounts,mergeAccounts,exportUIGF,featuredStatus,validateAccount,compare} from '../public/core.mjs';
const calendar=JSON.parse(readFileSync(new URL('../public/banners.json',import.meta.url))).rules;
const mk=(id,rank=3,extra={})=>normalize({id:String(id),gacha_type:'301',rank_type:String(rank),time:'2024-01-01 12:00:00',name:rank===5?'纳西妲':'以理服人',...extra});
const account=(records,settings={})=>({uid:'123456789',timezone:8,records,settings});
const summary=(i,span,outcome)=>mk(i,5,{kind:'summary',span,outcome,time:`2023-0${i}-01 12:00:00`});
test('unknown initial gold excluded; shared 301/400 pity; known start restores',()=>{
 const rows=[mk(1),mk(2,5,{outcome:'win'}),mk(3,3,{gacha_type:'400'}),mk(4,5,{gacha_type:'400',outcome:'loss'}),mk(5)];
 const p=analyze(account(rows)).pools['301'];assert.equal(p.total,5);assert.equal(p.avg,2);assert.equal(p.intervals,1);assert.equal(p.fives[0].interval,null);assert.equal(p.pity,1);assert.equal(p.guarantee,'yes');assert.equal(p.winRate,50);
 assert.equal(analyze(account(rows,{'301':{initialPity:10}})).pools['301'].avg,7);
});
test('five-star vs UP average; guarantees excluded; unfinished tail excluded',()=>{
 const rows=[summary(1,70,'loss'),summary(2,75,'guaranteed'),summary(3,40,'win')];
 const p=analyze(account(rows,{'301':{initialPity:0,initialGuarantee:'no'}})).pools['301'];
 assert.equal(p.avg,185/3);assert.equal(p.avgUp,92.5);assert.equal(p.winRate,50);assert.equal(p.guarantees,1);assert.equal(p.total,185);
});
test('gap cuts guarantee and UP cycle, summary interval stays exact',()=>{
 const rows=[summary(1,70,'loss'),{...summary(2,75,'guaranteed'),gapBefore:true},summary(3,40,'win')];
 const p=analyze(account(rows,{'301':{initialPity:0}})).pools['301'];assert.equal(p.avgUp,40);assert.equal(p.upSamples,1);
});
test('summary to exact defaults to gap, user-confirmed bridge restores',()=>{
 const rows=[summary(1,70,'loss'),mk(100),mk(101,5,{outcome:'guaranteed'})];
 const p=analyze(account(rows)).pools['301'];assert.equal(p.fives[1].interval,null);
 const connected=analyze(account(rows,{'301':{bridge:true,initialPity:0}})).pools['301'];assert.equal(connected.fives[1].interval,2);assert.equal(connected.avgUp,72);
});
test('banner calendar handles featured standard character and weapon',()=>{
 assert.equal(featuredStatus(mk(1,5,{name:'刻晴',time:'2021-02-20 12:00:00'}),calendar),true);
 assert.equal(featuredStatus(mk(1,5,{name:'刻晴',time:'2021-03-06 12:00:00'}),calendar),false);
 assert.equal(featuredStatus(mk(1,5,{name:'Unknown Future Name'}),calendar),null);
 assert.equal(featuredStatus(mk(1,5,{time:'2099-01-01 12:00:00'}),calendar),null);
 const b=calendar.find(x=>x.pool==='302');assert.ok(b);assert.equal(featuredStatus(mk(1,5,{gacha_type:'302',name:b.featured[0],time:b.start}),calendar),true);
});
test('automatic guarantees distinguish loss then UP then small win',()=>{
 const cal=[{pool:'301',start:'2024-01-01 00:00:00',end:'2024-01-31 23:59:59',featured:['纳西妲']}];
 const p=analyze(account([mk(1,5,{name:'七七'}),mk(2,5),mk(3,5)]),cal).pools['301'];
 assert.deepEqual(p.fives.map(x=>x.outcome),['loss','guaranteed','win']);assert.equal(p.winRate,50);
});
test('weapon unknown fate state is excluded from small-pity rate',()=>{
 const cal=[{pool:'302',start:'2024-01-01 00:00:00',end:'2024-01-31 23:59:59',featured:['护摩之杖']}];
 const p=analyze(account([mk(1,5,{gacha_type:'302',name:'护摩之杖'}),mk(2,5,{gacha_type:'302',name:'护摩之杖'})]),cal).pools['302'];assert.equal(p.winRate,null);assert.equal(p.guarantee,'unknown');
});
test('radiance counted as final win, cannot infer it automatically',()=>{
 const p=analyze(account([summary(1,50,'radiance'),summary(2,70,'loss')])).pools['301'];assert.equal(p.radiance,1);assert.equal(p.winRate,50);
});

test('chronicled explicit outcomes survive analysis, backup and merge; auto never infers fate across banners',()=>{
 const a=account(['win','loss','guaranteed','auto'].map((outcome,i)=>mk(i+1,5,{gacha_type:'500',outcome})),{'500':{initialPity:0,initialGuarantee:'yes'}});
 const p=analyze(a,calendar).pools['500'];
 assert.deepEqual(p.fives.map(r=>r.outcome),['win','loss','guaranteed','unknown']);
 assert.equal(p.winRate,50);assert.equal(p.guarantees,1);assert.equal(p.guarantee,'unknown');assert.equal(p.avgUp,null);
 const restored=mergeAccounts([],importedAccounts({format:'wish-atlas-backup-v1',accounts:[a]}));
 assert.equal(analyze(restored.accounts[0]).pools['500'].fives[0].outcome,'win');
});
test('UIGF v3/v4 merge preserves string IDs, separates UID, is idempotent',()=>{
 const r=mk('1697591160000515623',5);
 const a=importedAccounts({info:{uid:'123456789'},list:[r]});
 const b=importedAccounts({info:{version:'v4.2'},hk4e:[{uid:'987654321',timezone:8,list:[r]}]});
 const merged=mergeAccounts(a,b);assert.equal(merged.accounts.length,2);
 const again=mergeAccounts(merged.accounts,a);assert.equal(again.added,0);assert.equal(again.duplicates,1);assert.equal(again.accounts[0].records[0].id,r.id);
 assert.throws(()=>normalize({...r,id:Number(r.id)}),/字符串/);
 assert.equal(compare({...r,id:'9007199254740992'},{...r,id:'9007199254740993'}),-1);
});
test('bad record, conflict and overlap reject entire merge',()=>{
 const r=mk(1,5);const a=account([r]);assert.throws(()=>mergeAccounts([a],[account([{...r,name:'钟离'}])]),/冲突/);assert.equal(a.records[0].name,'纳西妲');
 assert.throws(()=>normalize({...r,time:'2024-02-30 12:00:00'}),/时间/);
 assert.throws(()=>normalize({...r,gacha_type:'__proto__'}),/卡池/);
 assert.throws(()=>validateAccount(account([r,{...summary(2,70,'win'),time:'2024-02-01 12:00:00'}])),/简化补录/);
});
test('backup round trip preserves annotations; UIGF does not fabricate pulls',()=>{
 const a=account([mk(100),summary(1,70,'loss')],{'301':{bridge:true}});
 const restored=importedAccounts({format:'wish-atlas-backup-v1',accounts:[a]});assert.equal(restored[0].records[1].span,70);assert.equal(restored[0].settings['301'].bridge,true);
 const out=exportUIGF([a]);assert.equal(out.hk4e[0].list.length,1);assert.equal(out.hk4e[0].list[0].uigf_gacha_type,'301');
});
test('empty account never reports NaN or invented rates',()=>{const p=analyze(account([])).pools['301'];assert.equal(p.avg,null);assert.equal(p.winRate,null);assert.equal(p.known,false);assert.equal(p.total,0);});
test('legacy helper records recover rarity from item catalog without changing IDs or dates',()=>{
 const rows=[{...mk(1),name:'沐浴龙血的剑',rank_type:undefined},{...mk(2),name:'罗莎莉亚',rank_type:undefined},{...mk(3),name:'娜维娅',rank_type:undefined}];
 const a=importedAccounts({info:{uid:'123456789',uigf_version:'v2.2'},list:rows})[0];
 assert.deepEqual(a.records.map(r=>r.rank_type),['3','4','5']);assert.equal(a.records[0].metadataSource,'catalog');assert.equal(a.records[0].id,rows[0].id);assert.equal(a.records[0].time,rows[0].time);
});
test('unknown missing rarity fails explicitly; known file metadata can fill new items',()=>{
 assert.throws(()=>normalize({...mk(1),name:'未知物品',rank_type:undefined}),/无法识别/);
 assert.throws(()=>normalize({...mk(1),rank_type:'0'}),/星级无效/);
 const a=importedAccounts({info:{uid:'123456789'},list:[{...mk(1,5),name:'未来角色'},{...mk(2),name:'未来角色',rank_type:undefined}]})[0];
 assert.equal(a.records[1].rank_type,'5');assert.equal(a.records[1].metadataSource,'file');
 assert.throws(()=>importedAccounts({info:{uid:'123456789'},list:[{...mk(1,5),name:'未来角色'},{...mk(2,4),name:'未来角色'}]}),/不同星级/);
});

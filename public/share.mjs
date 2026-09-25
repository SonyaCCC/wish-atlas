import {POOLS,OUTCOMES,poolOf} from './core.mjs';
const n=(x,d=0)=>x==null?'—':Number(x).toLocaleString('zh-CN',{maximumFractionDigits:d});
const chunks=(a,size)=>Array.from({length:Math.max(1,Math.ceil(a.length/size))},(_,i)=>a.slice(i*size,(i+1)*size));
export const THEMES={paper:{name:'浅色手账',bg:'#f3f0e7',panel:'#fcfaf3',ink:'#203f40',muted:'#6c807b',accent:'#8f723a',line:'#d7dcd1'},night:{name:'深色星空',bg:'#111e34',panel:'#1b2c45',ink:'#ecf3ef',muted:'#a4bac8',accent:'#e9c987',line:'#344962'},gold:{name:'金色出金',bg:'#2d261e',panel:'#423629',ink:'#fff1d3',muted:'#d3ba8e',accent:'#f0c66e',line:'#695235'}};
export function cardPages(report,options={},second=null){
 const nickname=String(options.nickname||'旅行者').slice(0,24),signature=String(options.signature||'愿每一份期待，都如愿以偿。').slice(0,70);
 const base={nickname,signature,uid:options.showUid?options.uid:null,range:report.range,theme:options.theme||'paper',scope:options.scopeLabel||'全部祈愿',title:options.showTitles!==false?report.titles[0]?.name:null};
 const entry=r=>({label:r.name,value:(r.interval==null?'≥'+r.observed:r.interval)+' 抽',detail:`${r.time.slice(0,10)} · ${POOLS[poolOf(r)]} · ${OUTCOMES[r.outcome]??'无法判定'}`});
 let pages;
 if(options.type==='timeline')pages=chunks(report.fives,10).map(rows=>({...base,heading:'金色时刻 · 祈愿长卷',kind:'list',entries:rows.map(entry)}));
 else if(options.type==='character'){
   const group=report.ranking.find(g=>g.name===options.character),records=group?.records??[];
   pages=chunks(records,9).map((rows,i)=>({...base,heading:options.character||'角色纪念卡',subtitle:`记录内共获得 ${records.length} 次 · 非实际命座 / 精炼等级`,kind:'list',entries:rows.map((r,j)=>({...entry(r),label:`第 ${i*9+j+1} 次相遇 · ${r.name}`}))}));
 }else if(options.type==='compare'){
   pages=[{...base,heading:'两份愿望 · 同行对照',kind:'compare',secondName:String(options.secondName||'旅伴').slice(0,24),secondUid:options.showUid?options.secondUid:null,secondRange:second?.range??'尚未选择第二个账号',entries:[
     {label:'收录抽数',value:n(report.stats.total),other:second?n(second.stats.total):'—',detail:'同一筛选范围，各自按已保存记录计算'},
     {label:'五星平均抽数',value:n(report.avg,1),other:second?n(second.avg,1):'—',detail:`完整区间样本：${report.samples} / ${second?.samples??0}`},
     {label:'角色池小保底不歪率',value:n(report.character.winRate,1)+'%',other:second?n(second.character.winRate,1)+'%':'—',detail:`小保底样本：${report.character.wins+report.character.losses} / ${second?second.character.wins+second.character.losses:0}`},
     {label:'最早出金',value:report.fastest?n(report.fastest.interval)+' 抽':'—',other:second?.fastest?n(second.fastest.interval)+' 抽':'—',detail:'仅比较已知完整区间；记录覆盖可能不同'}]}];
 }else pages=[{...base,heading:'我的祈愿名片',kind:'summary',total:n(report.stats.total),entries:[
   {label:'收获五星',value:`${report.characters} 次角色 · ${report.weapons} 次武器`,detail:`全部五星 ${report.fives.length} 次，重复获得也计数`},
   {label:'最惊喜的一金',value:report.fastest?`${report.fastest.name} · ${report.fastest.interval} 抽`:'等待下次相遇',detail:'仅已知完整出金区间'},
   {label:'角色池小保底不歪率',value:n(report.character.winRate,1)+'%',detail:`${report.character.wins} 次不歪 / ${report.character.wins+report.character.losses} 次已判定小保底`},
   {label:'平均每个角色 UP',value:n(report.character.avgUp,1)+' 抽',detail:`${report.character.upSamples} 个完整周期 · 含中途歪卡`},
   {label:'最长角色小保底连胜',value:n(report.character.bestStreak)+' 次',detail:'大保底跳过，未知结果与断档中断'}]}];
 return pages.map((p,i)=>({...p,page:i+1,pages:pages.length,footnote:'基于已收录记录 · 不代表完整账号历史',detailNote:report.summaries?'含简化补录；其抽数归入出金日期':'抽数与原石折算不代表实际充值金额'}));
}
export function drawCard(canvas,page){
 const theme=THEMES[page.theme]??THEMES.paper,w=900,h=1320;canvas.width=w;canvas.height=h;
 const c=canvas.getContext('2d');
 c.fillStyle=theme.bg;c.fillRect(0,0,w,h);
 c.strokeStyle=theme.line;c.lineWidth=1;c.strokeRect(26,26,w-52,h-52);c.strokeRect(34,34,w-68,h-68);
 const text=(value,x,y,size=24,color=theme.ink,max=756)=>{c.fillStyle=color;c.font=`${size>=36?'600':'400'} ${size}px "Microsoft YaHei", "Segoe UI", sans-serif`;let s=String(value);while(c.measureText(s).width>max&&s.length>1)s=s.slice(0,-2)+'…';c.fillText(s,x,y);};
 const diamond=(x,y,r)=>{c.beginPath();c.moveTo(x,y-r);c.lineTo(x+r*.55,y);c.lineTo(x,y+r);c.lineTo(x-r*.55,y);c.closePath();c.fillStyle=theme.accent;c.fill();};
 for(let i=0;i<14;i++)diamond(66+(i*127)%765,62+(i*137)%1120,i%3===0?5:2);
 text('W I S H   A T L A S',72,88,17,theme.accent);text(page.heading,72,148,42);text(page.nickname,72,194,25,theme.ink,580);
 if(page.uid)text('UID '+page.uid,590,194,18,theme.muted,245);
 text(page.scope,72,231,20,theme.accent);text(page.range,72,265,19,theme.muted);
 c.strokeStyle=theme.line;c.beginPath();c.moveTo(72,289);c.lineTo(828,289);c.stroke();
 let y=322;
 if(page.kind==='summary'){text(page.total,72,401,76);text('次祈愿，留下自己的故事',72,444,23,theme.muted);y=482;}
 if(page.subtitle){text(page.subtitle,72,y+12,20,theme.muted);y+=48;}
 if(page.kind==='compare'){
  text(page.nickname,370,y+20,23,theme.accent,210);text(page.secondName,612,y+20,23,theme.accent,210);y+=55;
  text('旅伴记录：'+page.secondRange,72,y+8,18,theme.muted);y+=36;
  if(page.secondUid){text('旅伴 UID '+page.secondUid,72,y,18,theme.muted);y+=30;}
 }
 const height=page.kind==='summary'?104:page.kind==='compare'?146:76;
 if(!page.entries.length)text('此范围暂无可展示的五星记录',72,y+60,28,theme.muted);
 for(const row of page.entries){
  c.fillStyle=theme.panel;c.fillRect(64,y,772,height-10);
  if(page.kind==='compare'){
   text(row.label,84,y+34,22);text(row.value,370,y+66,36,theme.accent,200);text(row.other,612,y+66,36,theme.accent,195);text(row.detail,84,y+110,17,theme.muted);
  }else if(page.kind==='list'){
   text(row.label,84,y+27,23,theme.ink,540);text(row.value,661,y+27,23,theme.accent,155);text(row.detail,84,y+54,17,theme.muted);
  }else{
   text(row.label,84,y+29,19,theme.muted);text(row.value,84,y+63,29,theme.ink);text(row.detail,84,y+86,15,theme.muted);
  }
  y+=height;
 }
 if(page.title&&y<1120)text('✦ '+page.title,72,Math.min(y+30,1110),22,theme.accent);
 text(page.signature,72,1170,23,theme.accent);
 text(page.footnote,72,1214,18,theme.muted);text(page.detailNote,72,1242,16,theme.muted);
 text(`${page.page} / ${page.pages}`,742,1280,16,theme.muted,90);
 return canvas;
}
export const pngBlob=canvas=>new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('图片生成失败')),'image/png'));
export function saveBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
// Uncompressed ZIP keeps multi-page PNG exports dependency-free and offline.
export function zipFiles(files){
 const encode=new TextEncoder(),local=[],central=[];let offset=0;
 const crc=bytes=>{let v=0xffffffff;for(const b of bytes){v^=b;for(let k=0;k<8;k++)v=(v>>>1)^((v&1)?0xedb88320:0);}return (v^0xffffffff)>>>0;};
 const header=(size,signature)=>{const bytes=new Uint8Array(size),v=new DataView(bytes.buffer);v.setUint32(0,signature,true);return {bytes,v};};
 for(const file of files){
  const name=encode.encode(file.name),data=file.data,checksum=crc(data),h=header(30,0x04034b50);
  h.v.setUint16(4,20,true);h.v.setUint16(6,0x800,true);h.v.setUint32(14,checksum,true);h.v.setUint32(18,data.length,true);h.v.setUint32(22,data.length,true);h.v.setUint16(26,name.length,true);
  const d=header(46,0x02014b50);d.v.setUint16(4,20,true);d.v.setUint16(6,20,true);d.v.setUint16(8,0x800,true);d.v.setUint32(16,checksum,true);d.v.setUint32(20,data.length,true);d.v.setUint32(24,data.length,true);d.v.setUint16(28,name.length,true);d.v.setUint32(42,offset,true);
  local.push(h.bytes,name,data);central.push(d.bytes,name);offset+=30+name.length+data.length;
 }
 const end=header(22,0x06054b50);end.v.setUint16(8,files.length,true);end.v.setUint16(10,files.length,true);end.v.setUint32(12,central.reduce((n,x)=>n+x.length,0),true);end.v.setUint32(16,offset,true);
 return new Blob([...local,...central,end.bytes],{type:'application/zip'});
}

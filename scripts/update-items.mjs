import {writeFile} from 'node:fs/promises';
const base='https://raw.githubusercontent.com/MadeBaruna/paimon-moe/main/';
async function get(file){const r=await fetch(base+file);if(!r.ok)throw Error(`下载物品资料失败：${r.status}`);return r.text();}
const [characters,weapons,localeText]=await Promise.all([get('src/data/characters.js'),get('src/data/weaponList.js'),get('src/locales/items/zh.json')]);
const locale=JSON.parse(localeText),items={};
for(const [source,type] of [[characters,'角色'],[weapons,'武器']]){
 const starts=[...source.matchAll(/^  [a-z0-9_]+: \{/gm)];
 for(let i=0;i<starts.length;i++){
  const block=source.slice(starts[i].index,starts[i+1]?.index??source.length);
  const name=block.match(/^    name: (['"])(.*?)\1,/m)?.[2];
  const rank=Number(block.match(/^    rarity: ([345]),/m)?.[1]);
  if(!name||!rank||!locale[name])continue;
  items[locale[name]]={rank_type:String(rank),item_type:type};
  items[name]={rank_type:String(rank),item_type:type};
 }
}
if(Object.keys(items).length<400)throw Error('物品资料不完整，保留旧文件');
await writeFile(new URL('../public/items.mjs',import.meta.url),'// Item rarity metadata from Paimon.moe (MIT); see licenses/paimon-moe.txt.\nexport const ITEMS = '+JSON.stringify(items,null,2)+';\n');
console.log(`已保存 ${Object.keys(items).length} 个中英文物品名称映射`);

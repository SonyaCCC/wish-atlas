import { mkdir, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const base = 'https://raw.githubusercontent.com/MadeBaruna/paimon-moe/main/';
async function get(p) { const r = await fetch(base+p); if (!r.ok) throw Error(`资料下载失败 ${r.status}`); return r.text(); }
const [source, localeText, license, characters, weapons] = await Promise.all([get('src/data/banners.js'),get('src/locales/items/zh.json'),get('LICENSE'),get('src/data/characters.js'),get('src/data/weaponList.js')]);
const locale = JSON.parse(localeText);
const names = {};
for (const [en,zh] of Object.entries(locale)) names[en.toLowerCase().replace(/[^a-z0-9 ]/g,'').replace(/ /g,'_')] = zh;
for (const m of (characters+'\n'+weapons).matchAll(/id: '([^']+)',\s*name: (['"])(.*?)\2/g)) if(locale[m[3]]) names[m[1]]=locale[m[3]];
// Parse only literal metadata; downloaded JavaScript is never executed.
const clean = source.replace(/^\s*\/\/.*$/gm,'');
const sections = [...clean.matchAll(/^  (\w+): \[/gm)];
const rules = [];
for (let i=0;i<sections.length;i++) {
  const pool = {characters:'301',weapons:'302'}[sections[i][1]];
  if (!pool) continue;
  const part = clean.slice(sections[i].index,sections[i+1]?.index ?? clean.length);
  for (const block of part.matchAll(/\{([^{}]+)\}/g)) {
    const field = key => block[1].match(new RegExp(key+": ['\"]([^'\"]+)['\"]"))?.[1];
    const featured = [...(block[1].match(/featured:\s*\[([^\]]+)\]/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map(m=>names[m[1]]);
    if (!field('start') || !field('end') || !featured.length || featured.some(x=>!x)) continue;
    rules.push({pool,start:field('start'),end:field('end'),featured,timezoneDependent:/timezoneDependent: true/.test(block[1])});
  }
}
if (rules.length < 100) throw Error('卡池资料解析失败，保留旧文件');
await mkdir(new URL('public/',root),{recursive:true});
await mkdir(new URL('licenses/',root),{recursive:true});
await writeFile(new URL('public/banners.json',root),JSON.stringify({source:'https://github.com/MadeBaruna/paimon-moe',updated:new Date().toISOString(),rules},null,2));
await writeFile(new URL('licenses/paimon-moe.txt',root),license);
console.log(`已保存 ${rules.length} 期卡池，最晚结束 ${rules.map(x=>x.end).sort().at(-1)}`);

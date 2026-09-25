import {createWriteStream,createReadStream} from 'node:fs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createHash} from 'node:crypto';
const version='44.4.5',name=`electron-v${version}-win32-x64.zip`;
const dir=new URL('../.tmp/electron-download/',import.meta.url);await mkdir(dir,{recursive:true});
const base=`https://github.com/electron/electron/releases/download/v${version}/`;
const res=await fetch(base+'SHASUMS256.txt');if(!res.ok)throw Error('无法获取官方校验和');
const checks=await res.text(),expected=checks.split('\n').find(line=>line.trim().split(/\s+/)[1]?.replace(/^\*/,'')===name)?.trim().split(/\s+/)[0];
if(!/^[a-f0-9]{64}$/.test(expected??''))throw Error('缺少官方 Windows x64 校验和');
async function digest(file){const h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex');}
const zip=new URL(name,dir);let valid=false;try{valid=await digest(zip)===expected;}catch{}
if(!valid){const r=await fetch(base+name);if(!r.ok)throw Error(`运行时下载失败：${r.status}`);await pipeline(Readable.fromWeb(r.body),createWriteStream(zip));if(await digest(zip)!==expected)throw Error('校验失败，禁止使用该运行时');}
await writeFile(new URL('verified.json',dir),JSON.stringify({version,name,sha256:expected,source:base+name},null,2));
console.log(`Electron ${version} 官方运行时已下载并通过 SHA-256 校验`);

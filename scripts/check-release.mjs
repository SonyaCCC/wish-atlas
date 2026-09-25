import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
if(!/^\d+\.\d+\.\d+$/.test(pkg.version))throw Error('Version must be x.y.z');
if(process.env.GITHUB_REF_TYPE==='tag'&&process.env.GITHUB_REF_NAME!=='v'+pkg.version)throw Error('Tag and package versions differ');
const core=fs.readFileSync('public/core.mjs','utf8');
if(!core.includes(`export_app_version:'${pkg.version}'`))throw Error('UIGF export version differs');
const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
for(const file of files){
 if(/(^|\/)(data|release|\.tmp|node_modules)(\/|$)|(^|\/)\.env|\.(log|exe|zip)$/i.test(file))throw Error('Private or generated file is tracked: '+file);
 const content=fs.readFileSync(file,'utf8');
 if(/authkey=[A-Za-z\d%+\/=]{120,}/.test(content)||/gh[pousr]_[A-Za-z0-9]{30,}/.test(content))throw Error('Possible live credential in '+file);
}
console.log(`Release ${pkg.version}: ${files.length} tracked files checked; private data excluded.`);

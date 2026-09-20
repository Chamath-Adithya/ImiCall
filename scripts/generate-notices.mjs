import fs from 'node:fs/promises';
import path from 'node:path';
const lock=JSON.parse(await fs.readFile('package-lock.json','utf8'));
const entries=Object.entries(lock.packages).filter(([key,value])=>key.startsWith('node_modules/')&&!value.dev);
const rows=[],blocks=[],missing=[];
for(const [directory,meta]of entries){
 let pkg;try{pkg=JSON.parse(await fs.readFile(path.join(directory,'package.json'),'utf8'));}catch{missing.push(directory);continue;}
 const names=(await fs.readdir(directory)).filter(n=>/^(licen[cs]e|copying|notice)([-._].*)?$/i.test(n));
 const heading=`${pkg.name}@${pkg.version}`;
 let upstream;
 if(pkg.name==='http_ece'&&pkg.version==='1.2.0'&&!names.length){upstream='docs/upstream-licenses/http_ece-1.2.0-LICENSE';blocks.push(`${heading} — upstream LICENSE (v1.2.0)\n${'='.repeat(60)}\n${await fs.readFile(upstream,'utf8')}`);}
 const license=typeof pkg.license==='string'?pkg.license:pkg.license?.type||meta.license||'Unspecified';
 rows.push(`| ${pkg.name} | ${pkg.version} | ${license} | ${names.join(', ')||(upstream?'Upstream v1.2.0 LICENSE':'See package distribution')} |`);
 for(const name of names){const filename=path.join(directory,name);if((await fs.stat(filename)).isFile())blocks.push(`${heading} — ${name}\n${'='.repeat(60)}\n${await fs.readFile(filename,'utf8')}`);}
 if(!names.length&&!upstream)missing.push(heading+' (no root notice file found)');
}
await fs.writeFile('THIRD_PARTY_NOTICES.md',`# Third-party dependency notices\n\nGenerated from the installed production dependency tree and package-lock.json. These packages retain their own licenses and copyright holders; the project license does not replace them. Dev-only tooling is excluded from this shipped-runtime inventory.\n\nUnmodified available license/notice texts are collected in [public/third-party-notices.txt](public/third-party-notices.txt). Re-run \`node scripts/generate-notices.mjs\` after dependency changes and review any missing notices; this script is not a legal compatibility audit.\n\n| Package | Version | Declared license | Notice files |\n| --- | --- | --- | --- |\n${rows.sort().join('\n')}\n${missing.length?'\nReview required:\n'+missing.map(x=>'- '+x).join('\n')+'\n':''}`);
await fs.writeFile('public/third-party-notices.txt',blocks.join('\n\n'+'-'.repeat(72)+'\n\n'));
console.log(JSON.stringify({packages:rows.length,missing}));

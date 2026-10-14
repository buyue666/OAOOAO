import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd();
const lock=JSON.parse(await readFile('package-lock.json','utf8'));
const inventory=[];
let output='OAOOAO independent backend — third-party runtime dependency notices\nGenerated from package-lock.json and the installed packages. Application code is licensed under AGPL-3.0-only; dependencies retain the terms below.\n';
for(const [packagePath,record] of Object.entries(lock.packages)) {
  if(!packagePath || record.dev) continue;
  const dir=path.join(root,packagePath);
  const pkg=JSON.parse(await readFile(path.join(dir,'package.json'),'utf8'));
  const names=(await readdir(dir)).filter(n=>/^(licen[cs]e|copying|notice)(\.|$)/i.test(n));
  const texts=[];
  for(const name of names) texts.push({source:name,text:await readFile(path.join(dir,name),'utf8')});
  if(!texts.length && pkg.name.startsWith('@aws-sdk/')) {
    texts.push({source:'docs/aws-sdk-js-v3-license.txt; https://github.com/aws/aws-sdk-js-v3/blob/main/LICENSE',text:await readFile('docs/aws-sdk-js-v3-license.txt','utf8')});
  } else if(!texts.length && ['pg-types','pgpass'].includes(pkg.name)) {
    const readme=await readFile(path.join(dir,'README.md'),'utf8');
    texts.push({source:'README.md, License section',text:readme.slice(readme.search(/^## license/im))});
  } else if(!texts.length && pkg.name==='abstract-logging') {
    const readme=await readFile('node_modules/pg-types/README.md','utf8');
    const grant=readme.slice(readme.indexOf('Permission is hereby granted'));
    texts.push({source:'Readme.md links http://jsumners.mit-license.org/; holder verified at https://github.com/remy/mit-license/blob/master/users/jsumners.json; standard MIT grant',text:'The MIT License (MIT)\n\nCopyright (c) James Sumners\n\n'+grant});
  }
  if(!texts.length) throw new Error('Missing license text: '+pkg.name);
  inventory.push({name:pkg.name,version:pkg.version,license:pkg.license,noticeFiles:texts.map(t=>t.source)});
  output+='\n'+'='.repeat(72)+'\n'+pkg.name+'@'+pkg.version+'\nDeclared license: '+pkg.license+'\n';
  for(const item of texts)output+='\n--- '+item.source+' ---\n'+item.text+'\n';
}
await writeFile('THIRD_PARTY_DEPENDENCY_NOTICES.txt',output);
await writeFile('docs/dependency-inventory.json',JSON.stringify(inventory,null,2)+'\n');
console.log(`Recorded complete notices for ${inventory.length} production dependencies.`);

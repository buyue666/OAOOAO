import {copyFile,mkdir,readdir} from 'node:fs/promises';

const source=new URL('../migrations/',import.meta.url);
const destination=new URL('../dist/migrations/',import.meta.url);
await mkdir(destination,{recursive:true});
for(const name of await readdir(source)){
  if(/^\d+-.+\.sql$/.test(name))await copyFile(new URL(name,source),new URL(name,destination));
}

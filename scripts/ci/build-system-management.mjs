import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
if(process.env.NODE_ENV==='production'&&process.env.GITHUB_ACTIONS!=='true')throw new Error('System console builds are forbidden on production hosts.');
const run=(command,args,options={})=>{const result=spawnSync(command,args,{cwd:root,stdio:'inherit',env:process.env,...options});if(result.status!==0)throw new Error(`${command} failed`);};
const npm=process.platform==='win32'?'npm.cmd':'npm';
if(process.argv[2]==='--backend'){
  run(npm,['--prefix','management-server','run','build'],{shell:process.platform==='win32'});
  const target=path.join(root,'be/dist/systemManagement');await fs.mkdir(target,{recursive:true});
  for(const name of ['server.mjs','server.mjs.map','server.mjs.build.json'])await fs.copyFile(path.join(root,'management-server/dist',name),path.join(target,name));
  for(const name of ['control-schema.sql','bootstrap-host.sh'])await fs.copyFile(path.join(root,'ops/system-management',name),path.join(target,name));
  run('go',['-C','ops/system-management/adapter','build','-trimpath','-ldflags=-s -w','-o',path.join(target,'adapter'),'.'],{env:{...process.env,GOOS:'linux',GOARCH:'amd64',CGO_ENABLED:'0',GOTOOLCHAIN:'go1.27.3'}});
  const binary=await fs.readFile(path.join(target,'adapter'));if(!binary.subarray(0,4).equals(Buffer.from([127,69,76,70])))throw new Error('Expected Linux ELF adapter.');
  const metadata=JSON.parse(await fs.readFile(path.join(target,'server.mjs.build.json'),'utf8'));metadata.adapterSha256=createHash('sha256').update(binary).digest('hex');metadata.goVersion='1.27.3';
  await fs.writeFile(path.join(target,'server.mjs.build.json'),JSON.stringify(metadata)+'\n');
}else if(process.argv[2]==='--ui'){
  run(npm,['--prefix','management-ui','run','build'],{shell:process.platform==='win32'});
  const target=path.join(root,'ui/build/system-management');await fs.mkdir(target,{recursive:true});await fs.cp(path.join(root,'management-ui/dist'),target,{recursive:true});
  await fs.writeFile(path.join(target,'management-release.json'),JSON.stringify({sourceSha:process.env.GITHUB_SHA||process.env.REACT_APP_GIT_SHA||'local',release:process.env.REACT_APP_RELEASE||'local',lockSha256:createHash('sha256').update(await fs.readFile(path.join(root,'management-ui/package-lock.json'))).digest('hex')})+'\n');
}else throw new Error('Choose --backend or --ui.');

import {build} from 'esbuild';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const outfile=process.env.SYSTEM_MANAGEMENT_BUNDLE_OUTPUT||'dist/server.mjs';
await build({entryPoints:['src/server.ts'],bundle:true,platform:'node',target:'node22',format:'esm',outfile,sourcemap:'external',sourcesContent:true,banner:{js:"import { createRequire as __managementCreateRequire } from 'node:module'; const require=__managementCreateRequire(import.meta.url);"},external:['cpu-features','pg-native','./crypto/build/Release/sshcrypto.node']});
const lock=await readFile('package-lock.json');
await writeFile(outfile+'.build.json',JSON.stringify({schemaVersion:1,sourceSha:process.env.GITHUB_SHA||'local',lockSha256:createHash('sha256').update(lock).digest('hex'),runtime:'node22',nativeSSHRequired:false})+'\n');

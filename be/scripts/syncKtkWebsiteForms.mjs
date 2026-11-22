import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=readFileSync(path.join(root,'src/config/ktkWebsiteForms.json'));
const expected='// Generated from ktkWebsiteForms.json; run node scripts/syncKtkWebsiteForms.mjs.\n'+
  'export const KTK_WEBSITE_FORMS_SHA256 = '+JSON.stringify(createHash('sha256').update(source).digest('hex'))+';\n'+
  'export const KTK_WEBSITE_FORMS = '+JSON.stringify(JSON.parse(source),null,2)+' as const;\n';
const target=path.join(root,'src/config/ktkWebsiteForms.ts');
if(process.argv.includes('--check')){
 if(readFileSync(target,'utf8')!==expected)throw Error('KTK enquiry schema source and typed mirror differ');
}else writeFileSync(target,expected);

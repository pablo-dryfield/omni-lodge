import {defineConfig} from 'vite';
export default defineConfig({build:{sourcemap:true,target:'es2022',assetsInlineLimit:0},server:{host:'127.0.0.1',port:3010,proxy:{'/management':{target:'http://127.0.0.1:3011',ws:true}}}});

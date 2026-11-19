import fs from 'node:fs';
import path from 'node:path';
const source=path.resolve('node_modules/@mediapipe/tasks-vision/wasm');
const target=path.resolve('public/portrait-engine');
fs.mkdirSync(target,{recursive:true});
for(const name of fs.readdirSync(source)) if(/\.(js|wasm)$/.test(name)) fs.copyFileSync(path.join(source,name),path.join(target,name));
console.log('Prepared local portrait runtime assets (loaded only on request).');

import { glob } from 'glob';
const files = await glob('dist/migrations/*.js');
console.log(files);

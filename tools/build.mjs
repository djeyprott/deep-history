import { build } from 'esbuild';
import fs from 'fs';
const r = await build({ entryPoints: ['ui/ui.js'], bundle: true, write: false, format: 'iife', minify: true, target: 'es2020', loader: { '.json': 'json' } });
const js = r.outputFiles[0].text, css = fs.readFileSync('ui/ui.css', 'utf8');
let html = fs.readFileSync('ui/index.html', 'utf8').replace('/*CSS*/', () => css).replace('<script>/*JS*/</script>', () => `<script>${js.replace(/<\/script/gi, '<\\/script')}</script>`);
fs.mkdirSync('dist', { recursive: true }); fs.writeFileSync('dist/index.html', html);
console.log('built', (html.length / 1024).toFixed(0), 'KB');

import { build } from 'esbuild'
import fs from 'fs'
// Builds the two club pages and writes them into ../public, which the main
// site's build copies to its root. Run with: npm run build  (inside club/)
const css = fs.readFileSync('src/site.css', 'utf8')
for (const [entry, tpl, out] of [['src/page.js', 'src/template.html', 'join.html'], ['src/member.js', 'src/member.html', 'member.html']]) {
  const r = await build({ entryPoints: [entry], bundle: true, minify: true, format: 'iife', target: 'es2020', write: false, legalComments: 'none' })
  const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')
  const html = fs.readFileSync(tpl, 'utf8').replace('/*SITECSS*/', () => css).replace('/*BUNDLE*/', () => js)
  fs.writeFileSync('../public/' + out, html)
  console.log('../public/' + out, (html.length / 1024).toFixed(1) + ' KB')
}

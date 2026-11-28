import { build } from 'esbuild'
import fs from 'fs'
// Builds the two club pages and writes them into ../public, which the main
// site's build copies to its root. Run with: npm run build  (inside club/)
const css = fs.readFileSync('src/site.css', 'utf8')

// The member page holds a secret and talks only to the relays and Lightning
// hosts named in its own EDIT ME block, so its security policy is built from
// that block. Anything else (a stray script, a tracker) can't phone home.
function csp(html) {
  const m = /window\.MEMBER_CONFIG = (\{[\s\S]*?\n\})/.exec(html)
  if (!m) return ''
  const cfg = new Function('return ' + m[1])()
  const relays = (cfg.relays || []).filter(r => /^wss:\/\/[a-z0-9.-]+$/i.test(r))
  const hosts = (cfg.lightningHosts || []).filter(d => /^[a-z0-9.-]+$/i.test(d)).map(d => 'https://' + d)
  const policy = [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    'connect-src ' + ["'self'", ...relays, ...hosts].join(' '),
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ')
  return '<meta http-equiv="Content-Security-Policy" content="' + policy + '">'
}
for (const [entry, tpl, out] of [['src/page.js', 'src/template.html', 'join.html'], ['src/member.js', 'src/member.html', 'member.html']]) {
  const r = await build({ entryPoints: [entry], bundle: true, minify: true, format: 'iife', target: 'es2020', write: false, legalComments: 'none' })
  const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')
  let html = fs.readFileSync(tpl, 'utf8').replace('/*SITECSS*/', () => css).replace('/*BUNDLE*/', () => js)
  html = html.replace('<!--CSP-->', () => csp(html))
  fs.writeFileSync('../public/' + out, html)
  console.log('../public/' + out, (html.length / 1024).toFixed(1) + ' KB')
}

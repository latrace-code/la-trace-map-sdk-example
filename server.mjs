// Serveur d'exemple, zero-dependance : sert public/ + src/ (modules ES) et expose
// deux routes cote serveur :
//   - /config.js         : injecte la config (cle publiable, base API, configId...) au front
//   - /latrace/static-map: signe l'URL de la carte statique (le secret ne quitte JAMAIS le serveur)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';

// Signature de la carte statique (contrat SDK section 1.4 + 4.2). Le SDK impose une
// URL signee (HMAC du canonical = tous les params sauf `sig`, tries par cle) avec un
// secret PAR CLE qui ne doit JAMAIS partir cote navigateur. On signe donc ici (serveur
// hote), puis on proxifie l'image depuis l'API La Trace. Equivaut au helper
// `signStaticMapUrl` de `@la-trace/map-sdk/static-map`.
async function serveStaticMap(req, res) {
  const base = process.env.LATRACE_API_BASE;
  const key = process.env.LATRACE_API_KEY;
  const configId = process.env.LATRACE_CONFIG_ID;
  const secret = process.env.LATRACE_STATIC_SECRET;
  if (!base || !key || !secret) { res.writeHead(500); return res.end('static-map non configure (voir .env)'); }

  const q = new URL(req.url, 'http://x').searchParams;
  const exp = String(Math.floor(Date.now() / 1000) + 900); // URL valide 15 min
  const params = {
    ...(q.get('basemap') ? { basemap: q.get('basemap') } : {}),
    center: q.get('center') || '',
    configId,
    exp,
    height: q.get('height') || '400',
    key,
    width: q.get('width') || '600',
  };
  if (q.get('markers')) params.markers = q.get('markers');
  if (q.get('zoom')) params.zoom = q.get('zoom');
  if (q.get('scale')) params.scale = q.get('scale');

  const canonical = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  const sig = createHmac('sha256', secret).update(canonical).digest('hex');
  const usp = new URLSearchParams(params);
  usp.set('sig', sig);

  try {
    const upstream = await fetch(`${base}/static-map?${usp.toString()}`);
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') || 'application/octet-stream',
      'cache-control': 'public, max-age=86400',
    });
    res.end(buf);
  } catch (e) {
    res.writeHead(502); res.end('static-map upstream error: ' + e.message);
  }
}

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = process.env.PORT || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

// Config injectee cote client. Le secret de signature static-map n'est PAS expose
// (il reste cote serveur, cf. /latrace/static-map).
function configJs() {
  const cfg = {
    apiKey: process.env.LATRACE_API_KEY || '',
    apiBase: process.env.LATRACE_API_BASE || '',
    configId: process.env.LATRACE_CONFIG_ID || '',
    exploreBaseUrl: process.env.LATRACE_EXPLORE_BASE_URL || 'https://pre-prod--latrace.netlify.app',
  };
  return `// Genere par server.mjs depuis l'environnement. Ne pas editer.\nwindow.LATRACE_CONFIG = ${JSON.stringify(cfg, null, 2)};\n`;
}

async function serveFile(res, absPath) {
  const data = await readFile(absPath);
  res.writeHead(200, { 'content-type': MIME[extname(absPath)] || 'application/octet-stream' });
  res.end(data);
}

const server = createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';
    if (urlPath === '/config.js') {
      res.writeHead(200, { 'content-type': MIME['.js'] });
      return res.end(configJs());
    }
    if (urlPath === '/health') { res.writeHead(200); return res.end('ok'); }
    if (urlPath === '/latrace/static-map') return serveStaticMap(req, res);

    // /src/* servi depuis la racine (modules ES) ; le reste depuis public/.
    const base = urlPath.startsWith('/src/') ? '.' : 'public';
    const safe = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
    const absPath = join(ROOT, base, safe);
    if (!absPath.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }

    const s = await stat(absPath).catch(() => null);
    if (!s || !s.isFile()) return serveFile(res, join(ROOT, 'public', 'index.html'));
    await serveFile(res, absPath);
  } catch (e) {
    res.writeHead(500); res.end('server error: ' + e.message);
  }
});

server.listen(PORT, () => console.log(`Exemple SDK La Trace sur http://localhost:${PORT}`));

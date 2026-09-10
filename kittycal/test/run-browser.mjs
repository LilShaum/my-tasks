/**
 * run-browser.mjs — serve the app, run every browser probe against it, report.
 *
 * The probes have always needed two things the unit tests don't: a real
 * Chromium, and the app served over HTTP rather than opened off disk (the
 * service worker and the ES modules both require an origin). Arranging that
 * was left to whoever was running them, which is most of why they stayed a
 * step people forgot — and why `test:contrast` and friends pointed at :8080
 * while most of the probes hard-code :8099, so the documented
 * command and the probes disagreed about where the app was.
 *
 * One command now does the whole thing, the same way locally and in CI.
 *
 * The server is Node's own `http`. Serving a directory of static files needs
 * no package,
 * and reaching for one here would put a dependency in the project that its
 * README spends a paragraph explaining the absence of. It also drops the
 * python3 that `npm run serve` assumes.
 *
 * Run: npm run test:browser
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TEST_DIR = join(ROOT, 'test');

/*
  Not configurable, and the reason is worth stating: eleven of the probes
  declare `const BASE = 'http://127.0.0.1:8099/'` with no argv fallback. A port
  option here would work for the three that read argv and silently point the
  other eleven at nothing.
*/
const PORT = 8099;
const BASE = `http://127.0.0.1:${PORT}`;

/*
  Correct types matter more than usual here. A .js served as text/plain is
  refused by the module loader, and a .webmanifest served wrong makes the
  install probe fail for a reason that has nothing to do with the app.
*/
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', BASE);
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith('/')) path += 'index.html';

    // Contain the served tree to ROOT: `normalize` collapses any ".." before
    // the join, and the prefix check catches whatever it doesn't.
    const file = join(ROOT, normalize(path));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }

    const info = await stat(file);
    if (!info.isFile()) { res.writeHead(404).end(); return; }

    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      // The service worker is the point of several probes; a cached copy
      // between runs would test the previous commit.
      'Cache-Control': 'no-store',
      'Service-Worker-Allowed': '/',
    });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});

await new Promise((resolve, reject) => {
  /*
    A raw EADDRINUSE stack is a confusing way to learn that a server from an
    earlier run is still up — the trace points into node:net and says nothing
    about this file or what to do about it. The port is fixed and cannot be
    moved (see above), so the only useful thing to say is what is wrong.
  */
  server.once('error', (err) => reject(err.code === 'EADDRINUSE'
    ? new Error(`Port ${PORT} is already in use — something is still serving `
      + 'the app from an earlier run. Stop it and try again.')
    : err));
  server.listen(PORT, '127.0.0.1', resolve);
});

/** Every probe except this runner and the helper it shares. */
const probes = (await readdir(TEST_DIR))
  .filter((f) => f.endsWith('.mjs') && !['run-browser.mjs', 'browser.mjs'].includes(f))
  .sort();

// Only the probes named on the command line, when some are.
const only = process.argv.slice(2);
const selected = only.length
  ? probes.filter((p) => only.some((o) => p === o || p === `${o}.mjs`))
  : probes;

if (!selected.length) {
  console.error(`No probe matched ${only.join(', ')}. Available: ${probes.join(', ')}`);
  server.close();
  process.exit(1);
}

/** @type {string[]} */
const failed = [];

for (const probe of selected) {
  console.log(`\n── ${probe} ${'─'.repeat(Math.max(0, 60 - probe.length))}`);
  const code = await new Promise((resolve) => {
    // Sequential on purpose: several probes seed the same IndexedDB origin,
    // so running them at once would have them overwrite each other's fixture.
    spawn(process.execPath, [join(TEST_DIR, probe), BASE], { stdio: 'inherit' })
      .on('close', resolve);
  });
  if (code !== 0) failed.push(probe);
}

server.close();

console.log(`\n${'─'.repeat(64)}`);
if (failed.length) {
  console.error(`FAILED (${failed.length}/${selected.length}): ${failed.join(', ')}`);
  process.exit(1);
}
console.log(`All ${selected.length} browser probes passed.`);

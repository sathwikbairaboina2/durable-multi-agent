import { readdirSync } from 'node:fs';
import { build } from 'esbuild';

const SKIP = new Set(['registry', 'http']);
const names = readdirSync('src/handlers')
  .filter((f) => f.endsWith('.ts'))
  .map((f) => f.slice(0, -3))
  .filter((n) => !SKIP.has(n));

try {
  for (const name of names) {
    await build({
      entryPoints: [`src/handlers/${name}.ts`],
      outfile: `dist/lambda/${name}/index.mjs`,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      sourcemap: true,
      logLevel: 'error',
      banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
    });
  }
  console.log(`bundled ${names.length} handlers`);
} catch (e) {
  console.error(e);
  process.exit(1);
}

/**
 * Copy YAML files from clis/ to dist/clis/.
 * Also copy compiled JS from dist/src/clis/ back to clis/ for manifest scanning.
 */
const { readdirSync, copyFileSync, mkdirSync, existsSync, statSync } = require('fs');
const path = require('path');

function walk(src, dst) {
  if (!existsSync(src)) return;
  for (const f of readdirSync(src)) {
    const sp = path.join(src, f);
    const dp = path.join(dst, f);
    if (statSync(sp).isDirectory()) {
      walk(sp, dp);
    } else if (/\.ya?ml$/.test(f)) {
      mkdirSync(path.dirname(dp), { recursive: true });
      copyFileSync(sp, dp);
    }
  }
}

walk('clis', 'dist/clis');

// Copy compiled JS from dist/src/clis/ back to clis/ so the manifest builder
// can import() them (Node.js can't resolve .js -> .ts fallback).
// Skip directories/files that already have .ts sources (those are scanned directly).
// Also skip if there's no .ts source in clis/ but the site is scanned from src/clis/ by build-manifest.
function copyCompiledBack(srcDir, dstDir) {
  if (!existsSync(srcDir)) return;
  for (const f of readdirSync(srcDir)) {
    const sp = path.join(srcDir, f);
    const dp = path.join(dstDir, f);
    if (statSync(sp).isDirectory()) {
      // Skip if destination already has .ts source files
      if (existsSync(dp) && readdirSync(dp).some(x => x.endsWith('.ts') && !x.endsWith('.d.ts'))) continue;
      // Skip if destination has any files (already configured)
      if (existsSync(dp) && readdirSync(dp).length > 0) continue;
      mkdirSync(dp, { recursive: true });
      copyCompiledBack(sp, dp);
    } else if (/\.js$/.test(f) && !f.endsWith('.d.ts')) {
      // Skip if .ts source already exists in destination
      if (existsSync(dp.replace(/\.js$/, '.ts'))) continue;
      mkdirSync(path.dirname(dp), { recursive: true });
      copyFileSync(sp, dp);
    }
  }
}
copyCompiledBack('dist/src/clis', 'clis');

// Copy compiled JS from dist/src/clis/ to dist/clis/ so runtime can find them.
// This is needed for sites like jimengx/midjourney whose TS sources live in src/clis/.
function copyCompiledToDist(srcDir, dstDir) {
  if (!existsSync(srcDir)) return;
  for (const f of readdirSync(srcDir)) {
    const sp = path.join(srcDir, f);
    const dp = path.join(dstDir, f);
    if (statSync(sp).isDirectory()) {
      mkdirSync(dp, { recursive: true });
      copyCompiledToDist(sp, dp);
    } else if (/\.js$/.test(f) && !f.endsWith('.d.js')) {
      copyFileSync(sp, dp);
    }
  }
}
copyCompiledToDist('dist/src/clis', 'dist/clis');

// Copy external CLI registry to dist/
const extSrc = 'src/external-clis.yaml';
if (existsSync(extSrc)) {
  mkdirSync('dist/src', { recursive: true });
  copyFileSync(extSrc, 'dist/src/external-clis.yaml');
}

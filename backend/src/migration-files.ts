import { access, readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function readMigrations() {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), 'backend/migrations'),
    resolve(process.cwd(), 'migrations'),
    resolve(moduleDirectory, '../migrations'),
    resolve(moduleDirectory, '../../migrations'),
  ];
  let directory: string | undefined;
  for (const candidate of candidates) {
    try { await access(candidate); directory = candidate; break; } catch { /* Try the next packaged location. */ }
  }
  if (!directory) throw new Error('No packaged database migrations were found');
  const files = (await readdir(directory)).filter(name => /^\d+-.+\.sql$/.test(name)).sort();
  if (!files.length) throw new Error('No packaged database migrations were found');
  return Promise.all(files.map(async name => {
    const sql = await readFile(resolve(directory!, name), 'utf8');
    return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  }));
}

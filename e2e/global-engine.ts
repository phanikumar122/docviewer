import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * One shared local engine for the whole test run. Starting/stopping it per-spec
 * races when specs run in parallel (one spec's teardown kills the engine another
 * is still using), so we own its lifecycle here. globalSetup returns a teardown
 * function that stops only an engine we actually started.
 */
const ROOT = join(__dirname, '..');
const PY = join(ROOT, 'server', '.venv', 'bin', 'python');
const URL = 'http://127.0.0.1:8787';

async function healthy(): Promise<boolean> {
  try {
    return (await fetch(`${URL}/api/health`)).ok;
  } catch {
    return false;
  }
}

export default async function globalSetup(): Promise<(() => Promise<void>) | void> {
  if (!existsSync(PY)) return; // engine optional — specs skip when it's absent
  if (await healthy()) return; // reuse an already-running engine (e.g. dev `pnpm engine`)
  const engine = spawn(PY, ['app.py'], { cwd: join(ROOT, 'server'), stdio: 'ignore' });
  for (let i = 0; i < 80; i++) {
    if (await healthy()) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return async () => {
    engine.kill('SIGTERM');
  };
}

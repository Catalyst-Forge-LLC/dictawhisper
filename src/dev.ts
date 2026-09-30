import { execSync, type ChildProcess } from 'child_process';
import { localslipGet } from './lib/localslipGet.ts';
import { config, configPath } from './config.ts';
import { checkoutDevEnv } from './lib/devPorts.ts';
import { spawnDevChild } from './lib/devChild.ts';

const children: ChildProcess[] = [];

const devEnv = checkoutDevEnv(
  process.env,
  { port: config.http.port, host: config.http.host, path: configPath },
  localslipGet('dictawhisper'),
  localslipGet('dictawhisper-api')
);
console.log(`[dev] UI 127.0.0.1:${devEnv.DICTA_UI_PORT}; API ${devEnv.DICTA_API_HOST}:${devEnv.DICTA_API_PORT}`);

function run(command: string, args: string[], hide = true, env: NodeJS.ProcessEnv = process.env) {
  const child = spawnDevChild(command, args, env, hide, (message, code) => {
    console.error(`[dev] ${message}`);
    shutdown(code);
  });
  children.push(child);
}

// windowsHide hides Node stdout in Git Bash; the API child must stay visible.
// Do not inherit the UI lease PORT (7777) — the API is dictawhisper-api (8008).
run(process.execPath, ['--experimental-strip-types', 'src/server.ts'], false, devEnv);

if (process.platform === 'win32') {
  // pnpm is a .cmd on PATH; CreateProcess cannot run it without cmd.exe.
  // Args are fixed literals — not user input.
  run('cmd.exe', ['/d', '/s', '/c', 'pnpm --dir client dev'], true, devEnv);
} else {
  run('pnpm', ['--dir', 'client', 'dev'], true, devEnv);
}

function killTree(child: ChildProcess) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
    } catch {
      child.kill();
    }
    return;
  }
  child.kill();
}

function shutdown(code = 0) {
  for (const child of children) {
    killTree(child);
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

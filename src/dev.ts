import { spawn, type ChildProcess } from 'child_process';

const children: ChildProcess[] = [];

function run(command: string, args: string[]) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    env: process.env,
    windowsHide: true,
  });
  children.push(child);
  child.on('error', (error) => {
    console.error(`[dev] failed to start ${command}:`, error.message);
    shutdown(1);
  });
  child.on('exit', (code, signal) => {
    if (signal) return;
    if (code && code !== 0) shutdown(code);
  });
}

run(process.execPath, ['--experimental-strip-types', 'src/server.ts']);

if (process.platform === 'win32') {
  // pnpm is a .cmd on PATH; CreateProcess cannot run it without cmd.exe.
  // Args are fixed literals — not user input.
  run('cmd.exe', ['/d', '/s', '/c', 'pnpm --dir client dev']);
} else {
  run('pnpm', ['--dir', 'client', 'dev']);
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

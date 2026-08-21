import { execSync, spawn, type ChildProcess } from 'child_process';

const children: ChildProcess[] = [];

function run(command: string, args: string[], hide = true) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    env: process.env,
    windowsHide: hide,
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

// windowsHide hides Node stdout in Git Bash; the API child must stay visible.
run(process.execPath, ['--experimental-strip-types', 'src/server.ts'], false);

if (process.platform === 'win32') {
  // pnpm is a .cmd on PATH; CreateProcess cannot run it without cmd.exe.
  // Args are fixed literals — not user input.
  run('cmd.exe', ['/d', '/s', '/c', 'pnpm --dir client dev']);
} else {
  run('pnpm', ['--dir', 'client', 'dev']);
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

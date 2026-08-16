import { spawn, type ChildProcess } from 'child_process';

const children: ChildProcess[] = [];

function run(command: string, args: string[]) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
  children.push(child);
  child.on('exit', (code, signal) => {
    if (signal) return;
    if (code && code !== 0) {
      for (const other of children) other.kill();
      process.exit(code);
    }
  });
}

run(process.execPath, ['--experimental-strip-types', 'src/server.ts']);
run('pnpm', ['--dir', 'client', 'dev']);

function shutdown() {
  for (const child of children) child.kill();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

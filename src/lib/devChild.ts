import { spawn, type ChildProcess } from 'node:child_process';

/** Keep child startup/exit failures observable by the checkout supervisor. */
export function spawnDevChild(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  hide: boolean,
  failed: (message: string, code: number) => void
): ChildProcess {
  const child = spawn(command, args, { stdio: 'inherit', env, windowsHide: hide });
  child.on('error', (error) => failed(`failed to start ${command}: ${error.message}`, 1));
  child.on('exit', (code, signal) => {
    if (signal) failed(`${command} ended with ${signal}`, 1);
    else if (code && code !== 0) failed(`${command} exited ${code}`, code);
  });
  return child;
}

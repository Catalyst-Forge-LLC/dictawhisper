/** A UI recipe's PORT must never become the API port. No registry writes. */
export function resolveApiListenPort(
  envPort: string | undefined,
  uiPort: number | undefined,
  apiLeasePort: number | undefined,
  configPort: number
): number {
  const n = Number(envPort);
  if (Number.isInteger(n) && n > 0 && n <= 65535 && n !== (uiPort ?? 7777)) return n;
  return apiLeasePort || configPort;
}

export function checkoutDevEnv(
  env: NodeJS.ProcessEnv,
  config: { port: number; host: string; path: string },
  uiLease?: number,
  apiLease?: number
): NodeJS.ProcessEnv {
  const uiPort = uiLease ?? 7777;
  const apiPort = resolveApiListenPort(env.PORT, uiPort, apiLease, config.port);
  return {
    ...env,
    PORT: String(apiPort),
    DICTA_UI_PORT: String(uiPort),
    DICTA_API_PORT: String(apiPort),
    DICTA_API_HOST: env.HOST?.trim() || config.host,
    DICTA_CONFIG: config.path,
  };
}

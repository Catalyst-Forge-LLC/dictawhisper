import fs from 'fs';
import { config, configPath } from './config.ts';
import { collectHealth, printHealthReport } from './lib/healthLib.ts';

if (!fs.existsSync(configPath)) {
  console.error(`[doctor] FAIL  config.json missing — copy config.example.json to ${configPath}`);
  process.exit(1);
}

const report = await collectHealth(config, { mode: 'doctor' });
printHealthReport(report, 'doctor');
process.exit(report.ok ? 0 : 1);

import { config } from '../config.ts';
import { configuredMachine } from './ollanetLib.ts';

export function ollanetIsConfigured(): boolean {
  const model = config.ollanet.cleanModel.trim();
  return configuredMachine(config.ollanet.machine).length > 0 && model.length > 0 && !model.startsWith('YOUR-');
}

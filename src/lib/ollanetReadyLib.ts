import { config } from '../config.ts';

export function ollanetIsConfigured(): boolean {
  const machine = config.ollanet.machine.trim();
  const model = config.ollanet.cleanModel.trim();
  return machine.length > 0 && !machine.startsWith('YOUR-') && model.length > 0 && !model.startsWith('YOUR-');
}

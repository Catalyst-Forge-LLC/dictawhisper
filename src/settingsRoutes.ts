import type express from 'express';
import {config, configPath, type DictaConfig} from './config.ts';
import {saveTranscriptionModel} from './lib/settingsLib.ts';

export function createTranscriptionSettingsRoutes(runtime: DictaConfig = config, file = configPath) {
  return [{path:'/settings/transcription', method:'POST', handler:(req:express.Request,res:express.Response) => {
    if (!req.body || Object.keys(req.body).some(key => key !== 'model')) { res.status(400).json({error:'Send only the default transcription model.'}); return; }
    try { res.json(saveTranscriptionModel(req.body.model, runtime, file)); }
    catch (error) { res.status(409).json({error:error instanceof Error ? error.message : String(error)}); }
  }}];
}

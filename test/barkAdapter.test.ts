import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {config} from '../src/config.ts';

const pythonAvailable = spawnSync(config.whisper.python,['--version'],{windowsHide:true}).status === 0;
test('Bark timestamps preserve raw text and reject invented alignment', {skip:!pythonAvailable}, () => {
  const result = spawnSync(config.whisper.python,['test/bark_adapter_test.py'],{windowsHide:true,encoding:'utf8',timeout:10_000});
  assert.equal(result.status,0,result.stderr || result.error?.message);
});

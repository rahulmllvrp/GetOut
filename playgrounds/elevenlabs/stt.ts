import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { createInterface } from 'readline';
import { join } from 'path';
import { tmpdir } from 'os';

const elevenlabs = new ElevenLabsClient();

const rl = createInterface({ input: process.stdin, output: process.stdout });

function waitForEnter(prompt: string): Promise<void> {
  return new Promise((resolve) => rl.question(prompt, () => resolve()));
}

async function transcribe(filePath: string): Promise<string> {
  const result = await elevenlabs.speechToText.convert({
    file: Bun.file(filePath),
    modelId: 'scribe_v2',
  });
  return result.text;
}

async function main() {
  console.log('ElevenLabs Speech-to-Text');
  console.log('ENTER to start/stop recording. Ctrl+C to quit.\n');

  while (true) {
    await waitForEnter('→ Press ENTER to start recording...');

    const outPath = join(tmpdir(), `stt_${Date.now()}.wav`);
    const proc = Bun.spawn(
      ['sox', '-d', '-r', '16000', '-c', '1', '-b', '16', '-e', 'signed-integer', outPath],
      { stderr: 'ignore' }
    );

    console.log('  [recording] speak now...');
    await waitForEnter('→ Press ENTER to stop...');

    proc.kill();
    await proc.exited;

    console.log('  [transcribing...]');
    try {
      const text = await transcribe(outPath);
      console.log(`\n  ${text}\n`);
    } catch (e) {
      console.error('  [error]', e);
    }

    await Bun.$`rm -f ${outPath}`.quiet();
  }
}

main().catch(console.error);

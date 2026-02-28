import { createInterface } from 'readline';
import { join } from 'path';
import { tmpdir } from 'os';

const API_KEY = process.env.ELEVENLABS_API_KEY;
if (!API_KEY) throw new Error('ELEVENLABS_API_KEY not set');

const rl = createInterface({ input: process.stdin, output: process.stdout });

function waitForEnter(prompt: string): Promise<void> {
  return new Promise((resolve) => rl.question(prompt, () => resolve()));
}

async function transcribe(filePath: string): Promise<string> {
  const form = new FormData();
  form.append('file', Bun.file(filePath), 'recording.wav');
  form.append('model_id', 'scribe_v2');

  const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': API_KEY! },
    body: form,
  });

  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  const data = await res.json() as { text: string };
  return data.text;
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

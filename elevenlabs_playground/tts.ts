import { ElevenLabsClient, play } from '@elevenlabs/elevenlabs-js';
import { createInterface } from 'readline';

const elevenlabs = new ElevenLabsClient();
const VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb';

const rl = createInterface({ input: process.stdin, output: process.stdout });

function prompt(q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, resolve));
}

async function speak(text: string) {
  const audio = await elevenlabs.textToSpeech.convert(VOICE_ID, {
    text,
    modelId: 'eleven_v3',
    outputFormat: 'mp3_44100_128',
  });
  await play(audio);
}

async function main() {
  console.log('ElevenLabs TTS — eleven_v3');
  console.log('Type your script and press ENTER to hear it. Ctrl+C to quit.\n');

  while (true) {
    const text = await prompt('→ ');
    if (!text.trim()) continue;
    console.log('  [speaking...]');
    try {
      await speak(text);
    } catch (e) {
      console.error('  [error]', e);
    }
  }
}

main().catch(console.error);

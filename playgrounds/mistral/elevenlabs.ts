import { ElevenLabsClient, play } from '@elevenlabs/elevenlabs-js';
import { join } from 'path';
import { tmpdir } from 'os';

const elevenlabs = new ElevenLabsClient();

const VOICE_ID = '8xUIoXhbwVdLFdpsGXe6';

export async function recordAudio(waitForEnter: (q: string) => Promise<void>): Promise<string> {
  const outPath = join(tmpdir(), `stt_${Date.now()}.wav`);
  const proc = Bun.spawn(
    ['sox', '-d', '-r', '16000', '-c', '1', '-b', '16', '-e', 'signed-integer', outPath],
    { stderr: 'ignore' }
  );
  await waitForEnter('  Press ENTER to stop recording...');
  proc.kill();
  await proc.exited;
  return outPath;
}

export async function speechToText(wavPath: string): Promise<string> {
  const result = await elevenlabs.speechToText.convert({
    file: Bun.file(wavPath),
    modelId: 'scribe_v2',
  });
  return result.text;
}

export async function speak(text: string): Promise<void> {
  const audio = await elevenlabs.textToSpeech.convert(VOICE_ID, {
    text,
    modelId: 'eleven_v3',
    outputFormat: 'mp3_44100_128',
  });
  await play(audio);
}

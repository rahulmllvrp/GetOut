import { ElevenLabsClient, stream } from '@elevenlabs/elevenlabs-js';

const elevenlabs = new ElevenLabsClient();

async function main() {
  const audioStream = await elevenlabs.textToSpeech.stream('JBFqnCBsd6RMkjVDRZzb', {
    text: 'HI JARED, RAHUL and FARHAN!',
    modelId: 'eleven_multilingual_v2',
  });

  // how to stream knowledge in!
  await stream(audioStream);
}

main();

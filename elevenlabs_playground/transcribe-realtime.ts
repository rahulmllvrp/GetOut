const API_KEY = process.env.ELEVENLABS_API_KEY;
if (!API_KEY) throw new Error('ELEVENLABS_API_KEY not set');

const WS_URL =
  'wss://api.elevenlabs.io/v1/speech-to-text/realtime' +
  '?model_id=scribe_v2_realtime' +
  '&audio_format=pcm_16000' +
  '&commit_strategy=vad' +
  '&language_code=en';

console.log('Connecting to ElevenLabs real-time transcription...');
console.log('Speak into your mic. Press Ctrl+C to stop.\n');

const ws = new WebSocket(WS_URL, {
  headers: { 'xi-api-key': API_KEY },
});

let recorder: ReturnType<typeof Bun.spawn> | null = null;
let partialLines = 0; // track how many lines the last partial occupied

function clearPartial() {
  if (partialLines > 0) {
    for (let i = 0; i < partialLines; i++) {
      process.stdout.write('\x1b[1A\x1b[2K'); // move up 1 line, clear it
    }
    partialLines = 0;
  }
}

ws.addEventListener('open', () => {
  console.log('Connected! Start speaking...\n');
  startRecording();
});

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data as string);

  if (msg.message_type === 'partial_transcript' && msg.text) {
    clearPartial();
    const line = `  [...] ${msg.text}`;
    const cols = process.stdout.columns || 80;
    partialLines = Math.max(1, Math.ceil(line.length / cols));
    process.stdout.write(line);
  } else if (msg.message_type === 'committed_transcript' && msg.text) {
    clearPartial();
    console.log(`  [you] ${msg.text}`);
  } else if (msg.error) {
    console.error('\nError:', msg.error);
  }
});

ws.addEventListener('error', () => console.error('WebSocket error'));
ws.addEventListener('close', () => {
  recorder?.kill();
  process.exit(0);
});

function startRecording() {
  recorder = Bun.spawn(
    ['sox', '-d', '-r', '16000', '-e', 'signed-integer', '-b', '16', '-c', '1', '-t', 'raw', '-'],
    { stdout: 'pipe', stderr: 'ignore' }
  );

  const CHUNK_BYTES = 3200; // 100ms of audio at 16kHz 16-bit mono

  (async () => {
    const reader = recorder!.stdout.getReader();
    let buf = new Uint8Array(0);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const merged = new Uint8Array(buf.length + value.length);
      merged.set(buf);
      merged.set(value, buf.length);
      buf = merged;

      while (buf.length >= CHUNK_BYTES) {
        const chunk = buf.slice(0, CHUNK_BYTES);
        buf = buf.slice(CHUNK_BYTES);

        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            message_type: 'input_audio_chunk',
            audio_base_64: Buffer.from(chunk).toString('base64'),
          }));
        }
      }
    }
  })().catch(console.error);
}

process.on('SIGINT', () => {
  console.log('\n\nStopping...');
  recorder?.kill();
  ws.close();
});

import { NextResponse } from "next/server";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const elevenlabs = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

const VOICE_ID = "8xUIoXhbwVdLFdpsGXe6";

export async function POST(req: Request) {
  try {
    const { text } = await req.json();

    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "Missing 'text' field" },
        { status: 400 },
      );
    }

    const t0 = performance.now();
    const audioStream = await elevenlabs.textToSpeech.convert(VOICE_ID, {
      text,
      modelId: "eleven_v3",
      outputFormat: "mp3_44100_128",
    });

    // Collect the stream into a buffer
    const chunks: Uint8Array[] = [];
    const reader = (audioStream as ReadableStream<Uint8Array>).getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const audioBuffer = Buffer.concat(chunks);
    const ttsMs = Math.round(performance.now() - t0);

    return new NextResponse(audioBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": audioBuffer.length.toString(),
        "Server-Timing": `elevenlabs-tts;dur=${ttsMs}`,
      },
    });
  } catch (error: unknown) {
    console.error("[/api/game/tts]", error);
    const message =
      error instanceof Error ? error.message : "Text-to-speech failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

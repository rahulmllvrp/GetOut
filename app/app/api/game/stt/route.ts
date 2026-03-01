import { NextResponse } from "next/server";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const elevenlabs = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const audioFile = formData.get("audio");

    if (!audioFile || !(audioFile instanceof Blob)) {
      return NextResponse.json(
        { error: "Missing 'audio' file in form data" },
        { status: 400 },
      );
    }

    // Convert Blob to File-like object for the SDK
    const file = new File([audioFile], "recording.webm", {
      type: audioFile.type || "audio/webm",
    });

    const t0 = performance.now();
    const result = await elevenlabs.speechToText.convert({
      file,
      modelId: "scribe_v2",
    });
    const sttMs = Math.round(performance.now() - t0);

    return NextResponse.json({ text: result.text }, {
      headers: { "Server-Timing": `elevenlabs-stt;dur=${sttMs}` },
    });
  } catch (error: any) {
    console.error("[/api/game/stt]", error);
    return NextResponse.json(
      { error: error.message ?? "Speech-to-text failed" },
      { status: 500 },
    );
  }
}

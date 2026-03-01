# GetOut

A dangerous room, a world that's unfamiliar and endlessly hostile. Fear is in the air as you talk to our protagonist Kyle. Locked inside, held against your wishes, you have to work with and instruct Kyle through escaping. There's no set storyline or ending — the world and game generate continuously as you make choices. Tell Kyle to look for clues under the mat? Or ask him to hide in the cabinet. The outcomes build up on the fly as the world is controlled by a model, dictating the storyline, generating the visuals as you see them, one decision at a time. Will you get out? Actually, can you get out? Try to. Guide Kyle and save him. No story, no plot armour, every playthrough is different.

---

## Architecture Overview

GetOut is an **AI-native escape room** built on four pillars: a 3D Gaussian Splatted scene rendered in the browser, a Mistral-Large Game Master that drives all narrative logic, ElevenLabs voice I/O for immersive speech, and Gemini image generation for hidden-area visuals. The entire experience — scenario, puzzles, dialogue, and imagery — is generated per session.

```
┌──────────────────────────────────────────────────────────────────────┐
│                           BROWSER (React 19)                        │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  ┌───────────┐ │
│  │ useThreeScene│  │useLocationNav│  │useImageEnh.│  │useGameSess│ │
│  │  3DGS viewer │  │ camera nav   │  │Gemini cache│  │state+voice│ │
│  └──────┬───────┘  └──────┬───────┘  └─────┬──────┘  └─────┬─────┘ │
│         │    lerp targets  │   onArrival    │   fetch /api  │       │
│         └──────────────────┘────────────────┘───────────────┘       │
│                               page.tsx                              │
│  ┌─────────────┐  ┌───────────────┐  ┌────────────────────────────┐ │
│  │ Win98Intro  │  │ ChatSidebar   │  │ Win98GameOver              │ │
│  │ splash/mode │  │ text + voice  │  │ victory screen             │ │
│  └─────────────┘  └───────────────┘  └────────────────────────────┘ │
└──────────────────────────────────┬───────────────────────────────────┘
                                   │ HTTP
┌──────────────────────────────────▼───────────────────────────────────┐
│                      NEXT.JS API ROUTES (server)                     │
│                                                                      │
│  POST /api/game/init      Load or reset game session                 │
│  POST /api/game/generate  Build new game tree (Mistral Large)        │
│  POST /api/game/chat      Player turn → Game Master → Kyle response  │
│  POST /api/game/stt       Audio blob → ElevenLabs Scribe → text     │
│  POST /api/game/tts       Text → ElevenLabs TTS → MP3 stream        │
│  GET  /api/game/locations  All locations + coordinates + clue data   │
│  POST /api/enhance-image   Canvas capture → Gemini → enhanced PNG   │
└──────┬──────────┬──────────────┬──────────────┬──────────────────────┘
       │          │              │              │
       ▼          ▼              ▼              ▼
  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐
  │ Mistral │ │ElevenLabs│ │  Gemini  │ │  Disk I/O │
  │ Large   │ │STT + TTS │ │  Flash   │ │           │
  │         │ │          │ │  Image   │ │gameState  │
  │Game tree│ │scribe_v2 │ │generation│ │.json +    │
  │+ chat   │ │eleven_v3 │ │+ enhance │ │logs +     │
  └─────────┘ └──────────┘ └──────────┘ │cache PNGs │
                                         └───────────┘
```

---

## Game Pipeline

### Phase 1 — Room Initialization

A reference video is processed through **3D Gaussian Splatting** to produce a `.ply` point cloud rendered in the browser via Three.js and `@sparkjsdev/spark`. Frame descriptions (`frame_descriptions.json`) catalogue every viewpoint and interactable object with coordinates, descriptions, and reference images. The **Game Master** (Mistral Large, constrained JSON output) ingests all frame descriptions and generates the full scenario: room description, win/lose conditions, and an ordered **game tree** of 3–5 clue nodes. Gemini then generates first-person **hidden POV images** for each clue node. Everything is persisted to `gameState.json`.

### Phase 2 — Gameplay Loop

```
Player speaks → MediaRecorder → /api/game/stt (ElevenLabs Scribe)
    → transcribed text → /api/game/chat (Mistral Large Game Master)
    → Kyle's response + state delta → /api/game/tts (ElevenLabs TTS)
    → audio playback + 3D camera move + hidden POV overlay (if clue revealed)
    → repeat until escape
```

Each turn the Game Master receives the full game state as a system prompt and returns structured JSON: Kyle's dialogue, movement instructions, clue/riddle state changes, and game-over flags. State is saved to disk after every turn for session resumability.

---

## Tech Stack

| Layer                | Technology                                                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Frontend**         | Next.js 16 (React 19), Tailwind CSS v4, Three.js, `@sparkjsdev/spark` (Gaussian Splatting)                      |
| **3D Scene**         | 3DGS pipeline → `.ply` files rendered via `SplatMesh` with lerp-based smooth camera navigation                  |
| **Game Master**      | Mistral Large (`mistral-large-latest`) via `@mistralai/mistralai` SDK — structured output with Zod JSON schemas |
| **Speech-to-Text**   | ElevenLabs STT API (`scribe_v2`) via `@elevenlabs/elevenlabs-js`                                                |
| **Text-to-Speech**   | ElevenLabs TTS API (`eleven_flash_v2_5`) via `@elevenlabs/elevenlabs-js`                                        |
| **Image Generation** | Google Gemini (`gemini-2.5-flash-image` / `gemini-3.1-flash-image-preview`) via `@google/genai` SDK             |
| **Validation**       | Zod for runtime type checking of LLM outputs and API payloads                                                   |
| **Runtime**          | Node.js (Next.js app), Bun (playgrounds)                                                                        |
| **Animation**        | GSAP for UI transitions                                                                                         |

---

## Run It

The app requires a `room.ply` file in `app/public/` (produced by a 3DGS pipeline from a room video) and a `frame_descriptions.json` describing the room's viewpoints and objects. See [GAME.md](GAME.md) for the full game design document.

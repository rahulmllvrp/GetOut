# GetOut — Game Design Document

## Overview

GetOut is an AI-native escape room game. The player is presented with a 3D view of a room and must explore hidden places within it to find a way out. A character named **Kyle** — a terrified coworker trapped in the room — acts as the player's hands and eyes. The player speaks instructions to Kyle via voice, and Kyle carries them out, narrating what he sees and does. An AI **Game Master** orchestrates the entire experience: generating the scenario, deciding win conditions, and driving the narrative forward each turn.

---

## Characters

### Kyle (NPC)

Kyle is a panicking, terrified coworker trapped inside the escape room. The player can see through Kyle's perspective. Kyle breathes hard, is visibly scared, but is ready to follow the player's instructions. He will move to locations, inspect objects, and relay what he finds — all while staying in character as someone who desperately wants to get out.

### Game Master (AI)

The Game Master is the behind-the-scenes AI that:

- Analyzes the room to build the game scenario.
- Generates the **game tree** (all possible paths to escape).
- Controls Kyle's responses and the narrative progression each turn.
- Decides what the player discovers at each location.
- Determines when the player has won (or failed).

---

## Game Pipeline

The game is set up in two phases: **Room Initialization** (offline/async) and **Gameplay Loop** (real-time).

### Phase 1: Room Initialization

```
Reference Video
    │
    ├──► [3DGS Layer] ──► room.ply ──► Frontend 3D Viewer
    │
    └──► [Mistral Large] ──► ~10 Terrestrial Images
                                │
                                ├──► Image Descriptions (visible areas)
                                └──► Hidden Descriptions (hidden/explorable areas)
```

#### Step 1 — 3D Gaussian Splatting

A reference video of the room is processed through a **3D Gaussian Splatting (3DGS)** layer. The output is a `.ply` file that the frontend renders as an interactive 3D scene using Three.js and `@sparkjsdev/spark` (`SplatMesh`).

#### Step 2 — Terrestrial Image Extraction

The same reference video is passed to **Mistral Large** (`mistral-large-latest`). The model extracts approximately **10 terrestrial images** — standard viewpoint frames representing what a person standing in the room would see looking in different directions.

#### Step 3 — Descriptions

For each terrestrial image, two types of descriptions are generated:

- **Visible descriptions** — what is plainly visible (furniture, doors, windows, objects).
- **Hidden descriptions** — what is concealed or not immediately obvious (a loose floorboard, a compartment behind a painting, a vent cover that can be removed).

#### Step 4 — Game Tree Generation

The terrestrial images, visible descriptions, and hidden descriptions are all passed to the **Game Master**. The Game Master generates a **game tree** — a branching structure of scenarios that defines how the player can win.

#### Step 5 — Hidden POV Generation

Based on the game tree, images for the necessary **hidden POVs** (the views a player sees when they explore a hidden area) are generated using an AI image generation service (Gemini `gemini-2.5-flash-image`, with support for grounded generation from reference images + text prompts).

### Win Conditions

The Game Master selects from scenarios like these (not exhaustive):

| #   | Scenario                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The player finds a **hidden door** in one of the hidden places and walks through it to escape.                                                |
| 2   | The player finds a **hidden key** that unlocks a **visible door** (already visible from the start, but locked).                               |
| 3   | Both the **key and the door are hidden** — the player must discover both through exploration, then use the key to unlock the door and escape. |

The Game Master decides which scenario(s) apply to a given room and encodes them in the game tree.

---

### Phase 2: Gameplay Loop

```
┌─────────────────────────────────────────────────────────────┐
│                      GAMEPLAY CYCLE                         │
│                                                             │
│  Player speaks ──► [Record WAV]                             │
│                        │                                    │
│                        ▼                                    │
│              [ElevenLabs STT] (scribe_v2)                   │
│                        │                                    │
│                   Transcribed text                          │
│                        │                                    │
│                        ▼                                    │
│              [Game Master / Mistral Large]                   │
│                        │                                    │
│                 Outputs:                                    │
│                   • Kyle's in-character response            │
│                   • Next location / POV to display          │
│                   • Updated game state                      │
│                        │                                    │
│                        ▼                                    │
│              [ElevenLabs TTS] (eleven_v3)                   │
│                        │                                    │
│                   Audio response                            │
│                        │                                    │
│                        ▼                                    │
│               Player hears Kyle speak                       │
│               Frontend updates POV / 3D view                │
│                                                             │
│              ─── repeat until escape ───                    │
└─────────────────────────────────────────────────────────────┘
```

#### Turn Breakdown

1. **Player speaks** — The player records a voice message (WAV file).
2. **Speech-to-Text** — The WAV file is sent to the **ElevenLabs STT API** (`scribe_v2` model) and transcribed to text.
3. **Game Master processes** — The transcribed instruction is sent to the **Game Master** (Mistral Large with tool-calling). The Game Master:
   - Determines what Kyle does in response to the instruction.
   - Updates the current location in the game state.
   - Tracks discovered items/locations.
   - Checks win/lose conditions against the game tree.
   - Returns Kyle's in-character dialogue and the next POV to show.
4. **Text-to-Speech** — Kyle's response text is sent to the **ElevenLabs TTS API** (`eleven_v3` model, voice ID configured for Kyle) and converted to audio.
5. **Playback & UI update** — The audio is played back to the player. The frontend updates the 3D view or displays the appropriate POV image for the new location.
6. **Repeat** until the player escapes (success) or gives up.

---

## Tech Stack

| Layer                 | Technology                                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Frontend**          | Next.js (React 19), Tailwind CSS v4, Three.js, `@sparkjsdev/spark` for Gaussian splatting                             |
| **3D Scene**          | 3DGS pipeline producing `.ply` files, rendered via `SplatMesh`                                                        |
| **Game Master / LLM** | Mistral Large (`mistral-large-latest`) via `mistralai` SDK, with function-calling tools                               |
| **Speech-to-Text**    | ElevenLabs STT API (`scribe_v2` model)                                                                                |
| **Text-to-Speech**    | ElevenLabs TTS API (`eleven_v3` model) via `@elevenlabs/elevenlabs-js` SDK                                            |
| **Image Generation**  | Gemini (`gemini-2.5-flash-image`) via `@google/genai` SDK — supports text-only and grounded (image + text) generation |
| **Runtime**           | Bun (playgrounds), Node.js (Next.js app)                                                                              |
| **Audio Recording**   | `sox` CLI for microphone capture                                                                                      |

---

## Project Structure

```
GetOut/
├── app/                        # Next.js frontend application
│   ├── app/
│   │   ├── page.tsx            # 3D splat viewer (main game view)
│   │   ├── layout.tsx          # Root layout
│   │   └── globals.css         # Tailwind styles
│   └── public/
│       └── room.ply            # 3DGS output (generated, not committed)
│
├── playgrounds/                # Prototype implementations (Bun)
│   ├── elevenlabs/
│   │   ├── tts.ts              # Text-to-speech demo (eleven_v3)
│   │   ├── stt.ts              # Speech-to-text demo (scribe_v2, sox)
│   │   └── transcribe-realtime.ts  # Real-time STT via WebSocket
│   ├── hiddenPOVs/
│   │   ├── generate.ts         # Gemini image gen from text prompt
│   │   └── generate_from_image_and_text.ts  # Gemini grounded image gen
│   └── mistral/
│       └── test.py             # End-to-end voice game loop prototype
│
├── GAME.md                     # This file
└── .env                        # API keys (MISTRAL_API_KEY, ELEVENLABS_API_KEY, GOOGLE_API_KEY)
```

---

## Environment Variables

| Variable             | Purpose                                 |
| -------------------- | --------------------------------------- |
| `MISTRAL_API_KEY`    | Mistral AI API access (Game Master LLM) |
| `ELEVENLABS_API_KEY` | ElevenLabs STT and TTS                  |
| `GOOGLE_API_KEY`     | Gemini image generation (hidden POVs)   |

---

## Key Concepts

- **Terrestrial Images** — ~10 standard-perspective frames of the room, representing what a person would see standing inside it and looking around.
- **Hidden POVs** — AI-generated images showing what a player sees when they explore a hidden or concealed area (e.g., inside a drawer, behind a painting, under a rug).
- **Game Tree** — A branching decision structure generated by the Game Master that defines all valid paths to escape, including which items must be found and in what order.
- **3DGS / Gaussian Splatting** — A technique for reconstructing 3D scenes from video, outputting `.ply` point clouds that can be rendered in real time on the web.

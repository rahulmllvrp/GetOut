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
    └──► Frame Extraction ──► frame_descriptions.json
                                │
                                ├──► Panoramic viewpoints (frame_*) — spatial context
                                └──► Object locations (e.g. whiteboard, bookshelf) — interactable
                                │
                                ▼
                          [Game Master / Mistral Large]
                          Inputs: all frame descriptions + coordinates
                                │
                                ▼
                          Game Tree (3-5 clue nodes, LLM-generated)
                          + room description, win/lose conditions
                                │
                                ▼
                          [Gemini Flash] ──► Hidden POV Images
                                │
                                ▼
                          gameState.json (persisted to disk)
```

#### Step 1 — 3D Gaussian Splatting

A reference video of the room is processed through a **3D Gaussian Splatting (3DGS)** layer. The output is a `.ply` file that the frontend renders as an interactive 3D scene using Three.js and `@sparkjsdev/spark` (`SplatMesh`).

#### Step 2 — Frame Descriptions

The room is described via a `frame_descriptions.json` file containing:

- A **common room description** — an overall summary of the space.
- An array of **frames**, each with:
  - `frame` — a unique ID (e.g., `"frame_1"`, `"whiteboard"`, `"bookshelf"`)
  - `description` — what is visible at this location
  - `pov` — the point-of-view text (what someone would see looking from here)
  - `coordinates` — camera position (`pos: {x, y, z}`) and rotation (`rot: {x, y}`) for frontend rendering
  - `image_filepath` — path to a reference image for this viewpoint

Frames are categorized into two types:

- **Panoramic viewpoints** (`frame_*`) — standard-perspective views of the room for spatial context. Clues cannot be attached to these.
- **Object locations** (e.g., `whiteboard`, `bookshelf`, `laptop`) — interactable spots where clues can be placed.

#### Step 3 — Game Tree Generation

The **Game Master** (Mistral Large) receives all frame descriptions and generates structured JSON via constrained decoding (JSON schema). The output includes:

- **roomDescription** — a 2-3 sentence atmospheric summary of the room
- **winCondition** — what the player must do to escape
- **loseCondition** — optional fail state (or null)
- **gameTree** — an ordered sequence of 3-5 clue nodes, each containing:
  - `frameId` — an object location ID from the frame descriptions (never a panoramic viewpoint)
  - `clueId` — a unique short ID for this puzzle step
  - `discovery` — what Kyle finds when arriving at the right time
  - `premature_discovery` — what Kyle finds if the player visits before it's unlocked
  - `riddle` — a puzzle to solve (null for the final exit node)
  - `answer` — the expected keyword (null for the exit node)
  - `hiddenAreaDescription` — a vivid text description used to generate the hidden POV image

The game tree is generated once at session start and remains fixed for the duration of the game. Riddle answers are designed to guide the player to the next location naturally.

#### Step 4 — Hidden POV Generation

Once the game tree is finalized, images for the necessary **hidden POVs** are generated using **Gemini Flash** (`gemini-2.5-flash-image`). For each clue node, the corresponding frame's reference image and the `hiddenAreaDescription` are sent to Gemini, which produces a first-person POV image of the hidden discovery (e.g., inside a drawer, behind a painting). This step depends on the game tree being complete, since the tree determines which hidden POVs are needed.

#### Step 5 — GameState Persistence

The full game state is assembled and saved to `gameState.json`. This includes all static data (game tree, all locations, room description, win/lose conditions) and mutable data (current location, visit history, conversation history, riddles solved). The game state is **persisted after every turn** during gameplay, allowing sessions to be resumed.

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
3. **Game Master processes** — The transcribed instruction is sent to the **Game Master** (Mistral Large with structured output). The system prompt is rebuilt every turn with the current game state. The Game Master returns:
   - `kyle_response` — Kyle's in-character dialogue
   - `did_move` / `move_to` — whether Kyle moved and to which frame ID
   - `clue_revealed` — whether a new discovery was delivered
   - `riddle_solved` — whether the player solved the current riddle
4. **State update** — The server updates the game state (location, visit history, clue index, riddles solved, game over) and **persists it to disk** so the session can be resumed.
5. **Text-to-Speech** — Kyle's response text is sent to the **ElevenLabs TTS API** (`eleven_v3` model, voice ID configured for Kyle) and converted to audio.
6. **Playback & UI update** — The audio is played back to the player. The frontend resolves the `move_to` frame ID to coordinates and updates the camera/character position. If `clue_revealed` is true, the corresponding hidden POV image is displayed.
7. **Repeat** until the player escapes (success) or gives up.

#### Location Resolution

When the player instructs Kyle to visit a location, the frontend first renders Kyle's movement to that location (if valid), then checks the visit history and game tree to determine what to show.

| Condition                                                       | Game Master behavior                                                                                                                                                                                                              | Frontend behavior                                                                                                                   |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Location not in location table**                              | Kyle does not move (`did_move: false`). Responds in-character that he doesn't see that place.                                                                                                                                     | No movement. No POV change.                                                                                                         |
| **In location table, not in game tree**                         | Kyle moves there (`did_move: true`). Searches around but finds nothing useful.                                                                                                                                                    | Moves to location. No hidden POV shown.                                                                                             |
| **In location table, in game tree (current node), first visit** | Kyle moves there (`did_move: true`). Delivers the discovery message and riddle.                                                                                                                                                   | Moves to location. Hidden POV is revealed.                                                                                          |
| **In location table, in game tree (upcoming node)**             | Kyle moves there (`did_move: true`). Delivers the premature discovery hint (e.g., locked combination lock, stuck panel).                                                                                                          | Moves to location. No hidden POV shown.                                                                                             |
| **Revisit to any previously visited location**                  | Kyle moves there (`did_move: true`). Acknowledges in-character that he's already been here. If the location is a completed game tree node, Kyle repeats the clue/hint immediately without requiring the player to solve it again. | Moves to location. If it's a completed game tree node, the previously revealed hidden POV is shown again. Otherwise, no POV change. |

---

## Tech Stack

| Layer                 | Technology                                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Frontend**          | Next.js (React 19), Tailwind CSS v4, Three.js, `@sparkjsdev/spark` for Gaussian splatting                             |
| **3D Scene**          | 3DGS pipeline producing `.ply` files, rendered via `SplatMesh`                                                        |
| **Game Master / LLM** | Mistral Large (`mistral-large-latest`) via `mistralai` SDK, with structured output (JSON schema constrained decoding) |
| **Speech-to-Text**    | ElevenLabs STT API (`scribe_v2` model)                                                                                |
| **Text-to-Speech**    | ElevenLabs TTS API (`eleven_v3` model) via `@elevenlabs/elevenlabs-js` SDK                                            |
| **Image Generation**  | Gemini (`gemini-2.5-flash-image`) via `@google/genai` SDK — supports text-only and grounded (image + text) generation |
| **Runtime**           | Bun (playgrounds), Node.js (Next.js app)                                                                              |
| **Audio Recording**   | `sox` CLI for microphone capture                                                                                      |

---

## Project Structure

> The structure below is a sample layout and will evolve as the project matures.

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

- **Frames** — Named viewpoints/locations in the room, defined in `frame_descriptions.json`. Split into **panoramic viewpoints** (`frame_*`) for spatial context and **object locations** (e.g., `whiteboard`, `bookshelf`) that can have clues attached. Each frame has coordinates, a description, and optionally a reference image.
- **Hidden POVs** — AI-generated images showing what a player sees when they explore a hidden or concealed area (e.g., inside a drawer, behind a painting, under a rug). Generated by Gemini Flash using the frame's reference image + the game tree's `hiddenAreaDescription`.
- **Game Tree** — An ordered sequence of 3-5 clue nodes dynamically generated by the Game Master at the start of each session. Each node references an object location by frame ID and includes a discovery, premature discovery, riddle, answer, and hidden area description. The last node is always the exit (riddle: null).
- **GameState** — The full game state persisted to `gameState.json`. Includes static data (game tree, all locations, room description, win/lose conditions) and mutable data (current location, visit history, conversation history, riddles solved). Saved after every turn for session resumability.
- **3DGS / Gaussian Splatting** — A technique for reconstructing 3D scenes from video, outputting `.ply` point clouds that can be rendered in real time on the web.

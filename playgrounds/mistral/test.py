import os
import json
import subprocess
import tempfile
from pathlib import Path

import requests
from mistralai import Mistral

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------
env_path = Path(__file__).parent.parent.parent / ".env"
if env_path.exists():
    for line in env_path.read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())

MISTRAL_KEY = os.environ["MISTRAL_API_KEY"]
ELEVEN_KEY = os.environ["ELEVENLABS_API_KEY"]

client = Mistral(api_key=MISTRAL_KEY)
MODEL = "mistral-large-latest"

VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"
TTS_MODEL = "eleven_v3"

# ---------------------------------------------------------------------------
# ElevenLabs helpers
# ---------------------------------------------------------------------------

def record_audio() -> str:
    """Record from the mic until the user presses Enter. Returns path to wav."""
    tmp = os.path.join(tempfile.gettempdir(), f"stt_{os.getpid()}.wav")
    proc = subprocess.Popen(
        ["sox", "-d", "-r", "16000", "-c", "1", "-b", "16", "-e", "signed-integer", tmp],
        stderr=subprocess.DEVNULL,
    )
    input("  Press ENTER to stop recording...")
    proc.terminate()
    proc.wait()
    return tmp


def speech_to_text(wav_path: str) -> str:
    """Send a wav file to ElevenLabs STT and return the transcribed text."""
    with open(wav_path, "rb") as f:
        resp = requests.post(
            "https://api.elevenlabs.io/v1/speech-to-text",
            headers={"xi-api-key": ELEVEN_KEY},
            files={"file": ("recording.wav", f, "audio/wav")},
            data={"model_id": "scribe_v2"},
        )
    resp.raise_for_status()
    return resp.json()["text"]


def text_to_speech(text: str):
    """Convert text to speech via ElevenLabs TTS and play it."""
    resp = requests.post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}",
        headers={
            "xi-api-key": ELEVEN_KEY,
            "Content-Type": "application/json",
        },
        json={
            "text": text,
            "model_id": TTS_MODEL,
            "output_format": "mp3_44100_128",
        },
    )
    resp.raise_for_status()

    tmp = os.path.join(tempfile.gettempdir(), f"tts_{os.getpid()}.mp3")
    with open(tmp, "wb") as f:
        f.write(resp.content)

    subprocess.run(["afplay", tmp], check=True)
    os.remove(tmp)


# ---------------------------------------------------------------------------
# Game prompt & tools
# ---------------------------------------------------------------------------

system_prompt = """
You are a terrified co-worker trapped in an escape room.
The player is watching through your body-cam.
Stay in character: you are panicking, breathing hard, and hesitant.
When the player gives an instruction, use the 'move_to_location' tool
to update the state and provide your in-character response.
"""

tools = [
    {
        "type": "function",
        "function": {
            "name": "move_to_location",
            "description": "Move to a location in the escape room and update the game state.",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "The name of the location to move to (e.g. 'bookshelf', 'locked door', 'desk').",
                    },
                    "action": {
                        "type": "string",
                        "description": "What the character does upon arriving (e.g. 'inspect', 'open', 'push').",
                    },
                },
                "required": ["location", "action"],
            },
        },
    }
]

state = {"current_location": "center of the room", "discovered": []}


def handle_tool_call(tool_call) -> str:
    args = json.loads(tool_call.function.arguments)
    location = args["location"]
    action = args["action"]

    state["current_location"] = location
    if location not in state["discovered"]:
        state["discovered"].append(location)

    result = {
        "location": location,
        "action": action,
        "result": f"Moved to '{location}' and performed '{action}'. Discovered so far: {state['discovered']}.",
    }
    print(f"\n[TOOL] move_to_location({location!r}, {action!r})")
    return json.dumps(result)


def chat(messages: list) -> str:
    response = client.chat.complete(
        model=MODEL,
        messages=messages,
        tools=tools,
        tool_choice="auto",
    )

    message = response.choices[0].message
    messages.append({"role": "assistant", "content": message.content, "tool_calls": message.tool_calls})

    if message.tool_calls:
        for tc in message.tool_calls:
            tool_result = handle_tool_call(tc)
            messages.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": tool_result,
            })

        followup = client.chat.complete(
            model=MODEL,
            messages=messages,
            tools=tools,
            tool_choice="none",
        )
        final_text = followup.choices[0].message.content
        messages.append({"role": "assistant", "content": final_text})
        return final_text

    return message.content


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def main():
    print("=== Escape Room Body-Cam (Voice Mode) ===")
    print(f"Starting location: {state['current_location']}")
    print("Press ENTER to start speaking, ENTER again to stop.")
    print("Type 'quit' to exit.  Type 'text' to switch to keyboard input.\n")

    messages = [{"role": "system", "content": system_prompt}]
    voice_mode = True

    while True:
        if voice_mode:
            cmd = input("→ Press ENTER to speak (or type 'text'/'quit'): ").strip().lower()
            if cmd == "quit":
                break
            if cmd == "text":
                voice_mode = False
                print("  Switched to keyboard input.\n")
                continue

            print("  [recording] speak now...")
            wav_path = record_audio()

            print("  [transcribing...]")
            try:
                player_input = speech_to_text(wav_path)
            except Exception as e:
                print(f"  [STT error] {e}\n")
                continue
            finally:
                if os.path.exists(wav_path):
                    os.remove(wav_path)

            print(f"  You said: {player_input}")
        else:
            player_input = input("You: ").strip()
            if player_input.lower() in ("quit", "exit"):
                break
            if player_input.lower() == "voice":
                voice_mode = True
                print("  Switched to voice input.\n")
                continue
            if not player_input:
                continue

        messages.append({"role": "user", "content": player_input})
        response = chat(messages)
        print(f"\nCo-worker: {response}\n")
        print(f"[State] Location: {state['current_location']} | Discovered: {state['discovered']}\n")

        print("  [speaking...]")
        try:
            text_to_speech(response)
        except Exception as e:
            print(f"  [TTS error] {e}")

    print("Transmission ended.")


if __name__ == "__main__":
    main()

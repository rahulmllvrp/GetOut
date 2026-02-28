import os
import json
from pathlib import Path
from mistralai import Mistral

# Load .env from repo root
env_path = Path(__file__).parent.parent.parent / ".env"
if env_path.exists():
    for line in env_path.read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())

client = Mistral(api_key=os.environ["MISTRAL_API_KEY"])
MODEL = "mistral-large-latest"

system_prompt = """
You are a terrified co-worker trapped in an escape room.
The player is watching through your body-cam.
Stay in character: you are panicking, breathing hard, and hesitant.
When the player gives an instruction, use the 'move_to_location' tool
to update the state and provide your in-character response.
"""

# Tool definition
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

# Game state
state = {"current_location": "center of the room", "discovered": []}


def handle_tool_call(tool_call) -> str:
    """Execute the tool and return a result string."""
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
    """Send messages, handle any tool calls, and return the final text response."""
    response = client.chat.complete(
        model=MODEL,
        messages=messages,
        tools=tools,
        tool_choice="auto",
    )

    message = response.choices[0].message

    # Append assistant turn (may include tool calls)
    messages.append({"role": "assistant", "content": message.content, "tool_calls": message.tool_calls})

    # Process tool calls if present
    if message.tool_calls:
        for tc in message.tool_calls:
            tool_result = handle_tool_call(tc)
            messages.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": tool_result,
            })

        # Follow-up call so the model can respond in character after using the tool
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


def main():
    print("=== Escape Room Body-Cam ===")
    print(f"Starting location: {state['current_location']}")
    print("Type 'quit' to exit.\n")

    messages = [{"role": "system", "content": system_prompt}]

    while True:
        player_input = input("You: ").strip()
        if player_input.lower() in ("quit", "exit"):
            print("Transmission ended.")
            break
        if not player_input:
            continue

        messages.append({"role": "user", "content": player_input})
        response = chat(messages)
        print(f"\nCo-worker: {response}\n")
        print(f"[State] Location: {state['current_location']} | Discovered: {state['discovered']}\n")


if __name__ == "__main__":
    main()

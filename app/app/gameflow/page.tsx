import fs from "fs";
import path from "path";

interface Message {
  role: string;
  content: string;
}

interface GameTurn {
  timestamp: string;
  input: {
    model: string;
    messages: Message[];
    temperature: number;
    maxTokens: number;
  };
  rawResponse: {
    id: string;
    model: string;
    usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
    choices: {
      index: number;
      message: { role: string; content: string };
      finishReason: string;
    }[];
  };
  parsed: {
    kyle_response: string;
    did_move: boolean;
    move_to: string;
    clue_revealed: boolean;
    riddle_solved: boolean;
  };
}

function loadGameFlow(): GameTurn[] {
  try {
    const filePath = path.join(process.cwd(), "data", "gameFlow.json");
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as GameTurn[];
  } catch {
    return [];
  }
}

function Badge({
  children,
  color,
}: {
  children: React.ReactNode;
  color: string;
}) {
  const colors: Record<string, string> = {
    green: "bg-green-900/50 text-green-300 border-green-700",
    red: "bg-red-900/50 text-red-300 border-red-700",
    blue: "bg-blue-900/50 text-blue-300 border-blue-700",
    yellow: "bg-yellow-900/50 text-yellow-300 border-yellow-700",
    purple: "bg-purple-900/50 text-purple-300 border-purple-700",
    gray: "bg-gray-800/50 text-gray-300 border-gray-700",
  };
  return (
    <span
      className={`inline-block px-2 py-0.5 text-xs font-medium rounded border ${colors[color] ?? colors.gray}`}
    >
      {children}
    </span>
  );
}

function RoleBubble({ role, content }: { role: string; content: string }) {
  const isSystem = role === "system";
  const isUser = role === "user";
  const isAssistant = role === "assistant";

  const base =
    "rounded-lg px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed";

  if (isSystem) {
    return (
      <details className="border border-gray-700 rounded-lg">
        <summary className="px-4 py-2 cursor-pointer text-xs font-semibold text-gray-400 uppercase tracking-wider hover:text-gray-200">
          System Prompt
        </summary>
        <div
          className={`${base} bg-gray-900 text-gray-300 border-t border-gray-700 max-h-96 overflow-y-auto font-mono text-xs`}
        >
          {content}
        </div>
      </details>
    );
  }

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div
          className={`${base} bg-blue-950 text-blue-100 border border-blue-800 max-w-[80%]`}
        >
          <div className="text-[10px] font-semibold text-blue-400 uppercase mb-1">
            Player
          </div>
          {content}
        </div>
      </div>
    );
  }

  if (isAssistant) {
    return (
      <div className="flex justify-start">
        <div
          className={`${base} bg-gray-800 text-gray-100 border border-gray-700 max-w-[80%]`}
        >
          <div className="text-[10px] font-semibold text-orange-400 uppercase mb-1">
            Kyle (Assistant)
          </div>
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className={`${base} bg-gray-800 text-gray-300 border border-gray-700`}>
      <div className="text-[10px] font-semibold text-gray-500 uppercase mb-1">
        {role}
      </div>
      {content}
    </div>
  );
}

export default function GameFlowPage() {
  const data = loadGameFlow();

  if (data.length === 0) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-gray-100 flex items-center justify-center">
        <p className="text-gray-500 text-lg">No game flow data found.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-100">
      <header className="sticky top-0 z-10 bg-[#0a0a0a]/90 backdrop-blur border-b border-gray-800 px-6 py-4">
        <h1 className="text-2xl font-bold tracking-tight">Game Flow Log</h1>
        <p className="text-sm text-gray-500 mt-1">
          {data.length} turn{data.length !== 1 ? "s" : ""} &middot; Model:{" "}
          {data[0]?.input.model}
        </p>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-10">
        {data.map((turn, i) => {
          const ts = new Date(turn.timestamp);
          const timeStr = ts.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          });
          const userMsg = [...turn.input.messages]
            .reverse()
            .find((m) => m.role === "user");
          const { parsed, rawResponse } = turn;
          const usage = rawResponse.usage;

          return (
            <section
              key={i}
              className="relative border border-gray-800 rounded-xl overflow-hidden bg-[#111]"
            >
              {/* Turn header */}
              <div className="flex items-center justify-between px-5 py-3 bg-gray-900/60 border-b border-gray-800">
                <div className="flex items-center gap-3">
                  <span className="text-lg font-bold text-white">
                    Turn {i + 1}
                  </span>
                  <span className="text-xs text-gray-500">{timeStr}</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {parsed.did_move && (
                    <Badge color="blue">Moved → {parsed.move_to}</Badge>
                  )}
                  {parsed.clue_revealed && (
                    <Badge color="yellow">Clue Revealed</Badge>
                  )}
                  {parsed.riddle_solved && (
                    <Badge color="green">Riddle Solved</Badge>
                  )}
                  {!parsed.did_move &&
                    !parsed.clue_revealed &&
                    !parsed.riddle_solved && (
                      <Badge color="gray">No Change</Badge>
                    )}
                </div>
              </div>

              {/* Player input */}
              {userMsg && (
                <div className="px-5 py-4 border-b border-gray-800/50">
                  <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    Player Said
                  </div>
                  <p className="text-sm text-blue-200 italic">
                    &ldquo;{userMsg.content}&rdquo;
                  </p>
                </div>
              )}

              {/* Kyle's response */}
              <div className="px-5 py-4 border-b border-gray-800/50">
                <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Kyle&apos;s Response
                </div>
                <p className="text-sm text-gray-100 leading-relaxed">
                  {parsed.kyle_response}
                </p>
              </div>

              {/* Parsed state */}
              <div className="px-5 py-3 bg-gray-900/40 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-gray-500">did_move</span>
                  <div
                    className={
                      parsed.did_move
                        ? "text-green-400 font-medium"
                        : "text-gray-600"
                    }
                  >
                    {String(parsed.did_move)}
                  </div>
                </div>
                <div>
                  <span className="text-gray-500">move_to</span>
                  <div className="text-gray-200 font-medium">
                    {parsed.move_to || "—"}
                  </div>
                </div>
                <div>
                  <span className="text-gray-500">clue_revealed</span>
                  <div
                    className={
                      parsed.clue_revealed
                        ? "text-yellow-400 font-medium"
                        : "text-gray-600"
                    }
                  >
                    {String(parsed.clue_revealed)}
                  </div>
                </div>
                <div>
                  <span className="text-gray-500">riddle_solved</span>
                  <div
                    className={
                      parsed.riddle_solved
                        ? "text-green-400 font-medium"
                        : "text-gray-600"
                    }
                  >
                    {String(parsed.riddle_solved)}
                  </div>
                </div>
              </div>

              {/* Conversation & usage collapsible */}
              <details className="border-t border-gray-800">
                <summary className="px-5 py-2 text-xs text-gray-500 hover:text-gray-300 cursor-pointer">
                  Full Conversation ({turn.input.messages.length} messages)
                  &middot; {usage.totalTokens} tokens
                </summary>
                <div className="px-5 py-4 space-y-3 max-h-[600px] overflow-y-auto">
                  {turn.input.messages.map((msg, j) => (
                    <RoleBubble key={j} role={msg.role} content={msg.content} />
                  ))}
                </div>
                <div className="px-5 py-3 border-t border-gray-800 text-xs text-gray-500 flex gap-4">
                  <span>Prompt: {usage.promptTokens}</span>
                  <span>Completion: {usage.completionTokens}</span>
                  <span>Total: {usage.totalTokens}</span>
                </div>
              </details>

              {/* Raw input collapsible */}
              <details className="border-t border-gray-800">
                <summary className="px-5 py-2 text-xs text-gray-500 hover:text-gray-300 cursor-pointer">
                  Raw API Input (JSON)
                </summary>
                <pre className="px-5 py-4 text-xs text-gray-400 font-mono overflow-x-auto max-h-96 overflow-y-auto">
                  {JSON.stringify(turn.input, null, 2)}
                </pre>
              </details>

              {/* Raw response collapsible */}
              <details className="border-t border-gray-800">
                <summary className="px-5 py-2 text-xs text-gray-500 hover:text-gray-300 cursor-pointer">
                  Raw API Response
                </summary>
                <pre className="px-5 py-4 text-xs text-gray-400 font-mono overflow-x-auto max-h-96 overflow-y-auto">
                  {JSON.stringify(rawResponse, null, 2)}
                </pre>
              </details>
            </section>
          );
        })}
      </main>
    </div>
  );
}

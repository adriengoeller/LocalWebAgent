// Two real engines, one shared interface:
//   load(onProgress)
//   generate({system, tools, messages, signal, onText}) -> {text, calls: [{name, arguments} | {name, error}]}
// - WebLLM: in the browser, on the GPU (WebGPU).
// - Ollama: a server already installed on this machine, used if it responds.

const WEBLLM_URL = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.89/+esm";
const OLLAMA = "http://localhost:11434";
export const CONTEXT = 8192; // tokens

export async function catalog() {
  const list = [];
  const adapter = await navigator.gpu?.requestAdapter().catch(() => null);
  if (adapter) {
    const q = adapter.features.has("shader-f16") ? "q4f16_1" : "q4f32_1";
    // GPU memory reported by WebLLM. SmolLM: under 2 GB only.
    for (const [n, gb] of [["Qwen3-4B", "3.4 GB"], ["Qwen3-1.7B", "2 GB"], ["Qwen3-8B", "5.7 GB"], ["Qwen3-0.6B", "1.4 GB"], ["SmolLM2-1.7B-Instruct", "1.8 GB"], ["SmolLM2-360M-Instruct", "0.4 GB"]])
      list.push({ name: `${n} (browser, ${gb})`, create: () => new WebLLM(`${n}-${q}-MLC`) });
  }
  try {
    const r = await fetch(OLLAMA + "/api/tags", { signal: AbortSignal.timeout(1500) });
    for (const m of (await r.json()).models)
      if (/^(qwen|smol)/i.test(m.name) && m.capabilities?.includes("tools"))
        list.push({ name: `${m.name.replace(/:latest$/, "")} (Ollama)`, create: () => new Ollama(m.name, m.capabilities.includes("thinking")) });
  } catch { /* Ollama not running */ }
  return list;
}

class WebLLM {
  constructor(id) { this.id = id; }

  async load(onProgress) {
    const { CreateMLCEngine } = await import(WEBLLM_URL);
    this.engine = await CreateMLCEngine(
      this.id,
      { initProgressCallback: (p) => onProgress(p.text) },
      { context_window_size: CONTEXT }
    );
  }

  async unload() { await this.engine?.unload(); }

  async generate({ system, tools, messages, signal, onText }) {
    const stop = () => this.engine.interruptGenerate();
    signal.addEventListener("abort", stop);
    try {
      const stream = await this.engine.chat.completions.create({
        messages: [{ role: "system", content: system + toolInstructions(tools) }, ...toText(messages)],
        stream: true, temperature: 0.6, max_tokens: 1500,
        extra_body: { enable_thinking: false },
      });
      let raw = "";
      for await (const m of stream) {
        raw += m.choices[0]?.delta?.content || "";
        onText(parse(raw).text);
      }
      return parse(raw);
    } finally {
      signal.removeEventListener("abort", stop);
    }
  }
}

class Ollama {
  constructor(id, thinks) { this.id = id; this.thinks = thinks; }

  async load(onProgress) {
    onProgress("Loading with Ollama…");
    const r = await fetch(OLLAMA + "/api/generate", { method: "POST", body: JSON.stringify({ model: this.id, options: { num_ctx: CONTEXT } }) });
    if (!r.ok) throw new Error(await r.text());
    await r.text();
  }

  async unload() {}

  async generate({ system, tools, messages, signal, onText }) {
    const r = await fetch(OLLAMA + "/api/chat", {
      method: "POST", signal,
      body: JSON.stringify({
        model: this.id,
        stream: true,
        options: { num_ctx: CONTEXT },
        ...(this.thinks && { think: false }),
        tools: tools.map(schema),
        messages: [
          { role: "system", content: system },
          ...messages.map((m) =>
            m.role === "tool" ? { role: "tool", tool_name: m.name, content: m.content }
            : m.calls?.length ? { role: "assistant", content: m.content, tool_calls: m.calls.map((c) => ({ function: { name: c.name, arguments: c.arguments || {} } })) }
            : { role: m.role, content: m.content }),
        ],
      }),
    });
    if (!r.ok) throw new Error(await r.text());
    let text = "", rest = "";
    const calls = [];
    const line = (l) => {
      if (!l.trim()) return;
      const j = JSON.parse(l);
      if (j.error) throw new Error(j.error);
      text += j.message?.content || "";
      for (const t of j.message?.tool_calls || []) calls.push({ name: t.function.name, arguments: t.function.arguments });
      onText(text);
    };
    const decoder = new TextDecoder();
    const reader = r.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      rest += decoder.decode(value, { stream: true });
      const lines = rest.split("\n");
      rest = lines.pop();
      lines.forEach(line);
    }
    line(rest);
    return { text: text.trim(), calls };
  }
}

const schema = (t) => ({
  type: "function",
  function: {
    name: t.name, description: t.description,
    parameters: {
      type: "object",
      properties: Object.fromEntries(Object.entries(t.parameters).map(([k, d]) => [k, { type: "string", description: d }])),
      required: Object.keys(t.parameters),
    },
  },
});

// The tool-calling format Qwen3 was trained on: WebLLM does not handle it itself.
function toolInstructions(tools) {
  return `\n\n# Tools\n\nYou may call one or more functions to assist with the user query.\n\nYou are provided with function signatures within <tools></tools> XML tags:\n<tools>\n${tools.map((t) => JSON.stringify(schema(t))).join("\n")}\n</tools>\n\nFor each function call, return a json object with function name and arguments within <tool_call></tool_call> XML tags:\n<tool_call>\n{"name": <function-name>, "arguments": <args-json-object>}\n</tool_call>`;
}

function toText(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role === "tool") {
      const block = `<tool_response>\n${m.content}\n</tool_response>`;
      const prev = out.at(-1);
      if (prev?.fromTool) prev.content += "\n" + block;
      else out.push({ role: "user", content: block, fromTool: true });
    } else {
      const calls = (m.calls || []).map((c) => `\n<tool_call>\n${c.raw ?? JSON.stringify({ name: c.name, arguments: c.arguments })}\n</tool_call>`).join("");
      out.push({ role: m.role, content: m.content + calls });
    }
  }
  return out.map(({ role, content }) => ({ role, content }));
}

function parse(raw) {
  raw = raw.replace(/<think>[\s\S]*?(<\/think>|$)/g, "").replace(/<\/think>/g, "");
  const calls = [...raw.matchAll(/<tool_call>([\s\S]*?)(?:<\/tool_call>|(?=<tool_call>)|$)/g)].flatMap(([, json]) => {
    try {
      return [JSON.parse(json)].flat().map((o) => ({ name: o.name, arguments: o.arguments || {} })); // SmolLM2 returns a list
    } catch (e) {
      return [{ name: "?", raw: json.trim(), error: "Unreadable call (invalid JSON): " + e.message }];
    }
  });
  return { text: raw.split("<tool_call>")[0].trim(), calls };
}

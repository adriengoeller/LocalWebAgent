// The harness: send the conversation to the model, run the tools it asks for,
// hand the results back, and repeat until it answers without a tool call.

import { CONTEXT } from "./models.js";

const MAX_STEPS = 10;
const size = (m) => m.content.length + JSON.stringify(m.calls || "").length;

// Drops the oldest exchanges when the conversation exceeds the context (≈ 3 characters per token).
function truncate(messages) {
  const max = (CONTEXT - 2500) * 3;
  let total = messages.reduce((s, m) => s + size(m), 0);
  while (total > max) {
    const next = messages.findIndex((m, i) => i > 0 && m.role === "user");
    if (next > 0) messages.splice(0, next).forEach((m) => (total -= size(m)));
    else {
      // A single exchange that is too long: empty its largest tool results.
      const largest = messages.filter((m) => m.role === "tool").sort((a, b) => size(b) - size(a))[0];
      if (!largest || size(largest) < 200) return;
      total -= size(largest);
      largest.content = "(result removed: context full)";
      total += size(largest);
    }
  }
}

export async function respond({ model, system, tools, messages, signal, confirm, ui }) {
  for (let i = 0; i < MAX_STEPS; i++) {
    truncate(messages);
    const bubble = ui.bubble();
    const { text, calls } = await model.generate({ system, tools, messages, signal, onText: (t) => bubble.write(t) });
    bubble.finish(text);
    if (signal.aborted) {
      messages.push({ role: "assistant", content: text || "(interrupted)" });
      return;
    }
    messages.push({ role: "assistant", content: text, calls });
    if (!calls.length) return;

    for (const call of calls) {
      const card = ui.tool(call);
      let result;
      const tool = tools.find((t) => t.name === call.name);
      if (signal.aborted) result = "Interrupted by the user.";
      else if (call.error) result = call.error;
      else if (!tool) result = `Error: unknown tool "${call.name}".`;
      else if (tool.acts && confirm() && !(await card.ask(signal))) result = "Denied by the user.";
      else {
        try {
          result = String(await tool.run(call.arguments || {}, signal));
        } catch (e) {
          result = "Error: " + (e.message || e);
        }
      }
      if (result.length > 6000) result = result.slice(0, 6000) + "\n… (truncated)";
      card.result(result);
      messages.push({ role: "tool", name: call.name, content: result });
    }
    if (signal.aborted) return;
  }
  ui.info(`Stopped after ${MAX_STEPS} steps.`);
}

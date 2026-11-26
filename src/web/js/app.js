import { catalog } from "./models.js";
import { respond } from "./harness.js";
import { TOOLS, openHandle, openFileList } from "./tools.js";

const $ = (id) => document.getElementById(id);
const el = (tag, className = "", text = "") => Object.assign(document.createElement(tag), { className, textContent: text }); // never innerHTML
const status = (t) => ($("status").textContent = t);
const thread = $("thread");
const append = (e) => { thread.append(e); thread.scrollTop = thread.scrollHeight; return e; };

let model = null, models = [], messages = [], controller = null, loading = false;

$("system").value = `You are an assistant running on the user's computer. Answer in their language, freely, on any topic.
You have tools. Use them when the request is about their files, a calculation or the web: act, without announcing what you are going to do. Otherwise, answer directly.
Never make up the content of a file or the result of a tool.
If a tool returns an error, fix it and try again. Before analyzing a file in Python, read it to learn its columns.`;

const systemPrompt = () => `${$("system").value}\nDate: ${new Date().toLocaleDateString(undefined, { dateStyle: "full" })}.`;

const ui = {
  info: (t) => append(el("div", "info", t)),
  bubble() {
    let b = null;
    const write = (t) => {
      if (!t) return;
      b ??= append(el("div", "msg"));
      b.textContent = t;
      thread.scrollTop = thread.scrollHeight;
    };
    return { write, finish: write };
  },
  tool(call) {
    const d = el("details", "tool");
    const args = call.arguments || {};
    d.append(el("summary", "", call.name), el("pre", "", call.raw ?? (Object.entries(args).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("\n") || "(no arguments)")));
    append(d);
    return {
      ask(signal) {
        return new Promise((resolve) => {
          const yes = el("button", "", "Allow"), no = el("button", "", "Deny");
          const done = (v) => { yes.remove(); no.remove(); d.open = false; resolve(v); };
          yes.onclick = () => done(true);
          no.onclick = () => done(false);
          signal.addEventListener("abort", () => done(false), { once: true });
          d.append(yes, no);
          d.open = true;
          thread.scrollTop = thread.scrollHeight;
        });
      },
      result: (t) => d.append(el("pre", "", "→ " + t)),
    };
  },
};

function refresh() {
  const busy = !!controller;
  $("send").hidden = busy;
  $("send").disabled = !model || loading;
  $("stop").hidden = !busy;
  $("load").disabled = busy || loading || !models.length;
  $("new").disabled = busy;
}

$("load").onclick = async () => {
  const choice = models[$("model").value];
  loading = true;
  refresh();
  try {
    await model?.unload();
    model = null;
    const m = choice.create();
    await m.load(status);
    model = m;
    status(`${choice.name} is ready.`);
    $("input").focus();
  } catch (e) {
    status("Loading failed: " + (e.message || e));
  }
  loading = false;
  refresh();
};

$("folder").onclick = async () => {
  if (!window.showDirectoryPicker) return $("fallback").click();
  try {
    const h = await showDirectoryPicker({ mode: "readwrite" });
    openHandle(h);
    $("folder").textContent = h.name;
  } catch (e) {
    if (e.name !== "AbortError") status("Folder not accessible: " + e.message);
  }
};
$("fallback").onchange = (e) => {
  if (!e.target.files.length) return;
  openFileList(e.target.files);
  $("folder").textContent = e.target.files[0].webkitRelativePath.split("/")[0] + " (read-only)";
};

$("form").onsubmit = async (e) => {
  e.preventDefault();
  const text = $("input").value.trim();
  if (!text || !model || controller || loading) return;
  $("input").value = "";
  append(el("div", "msg user", text));
  messages.push({ role: "user", content: text });
  controller = new AbortController();
  refresh();
  try {
    await respond({ model, system: systemPrompt(), tools: TOOLS, messages, signal: controller.signal, confirm: () => $("confirm").checked, ui });
  } catch (err) {
    ui.info(err.name === "AbortError" ? "Interrupted." : "Error: " + (err.message || err));
  }
  controller = null;
  refresh();
};
$("input").onkeydown = (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $("form").requestSubmit();
  }
};
$("stop").onclick = () => controller?.abort();
$("new").onclick = () => { messages = []; thread.replaceChildren(); };

models = await catalog();
models.forEach((m, i) => $("model").append(new Option(m.name, i)));
if (!isSecureContext) status("Insecure address: open http://localhost:8765, otherwise the browser disables WebGPU.");
else if (!models.length) status("No model available: you need a browser with WebGPU (Chrome or Edge), or Ollama running on this machine.");
refresh();

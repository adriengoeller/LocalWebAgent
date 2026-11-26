// The tools. Everything is real: files in the opened folder, Python, network.
// "acts: true" asks for the user's approval if the checkbox is ticked.

let root = null;      // folder opened with the File System Access API (Chrome, Edge)
let imported = null;  // otherwise, a read-only copy (Firefox, Safari): Map path -> File

export function openHandle(h) { root = h; imported = null; }
export function openFileList(files) {
  root = null;
  imported = new Map([...files].map((f) => [f.webkitRelativePath.split("/").slice(1).join("/"), f])
    .filter(([p]) => !p.split("/").some(ignored)));
}

const ignored = (name) => name.startsWith(".") || name === "node_modules";
const MAX_FILES = 300;

async function list() {
  if (imported) return [...imported].slice(0, MAX_FILES);
  if (!root) throw new Error('no folder open. The user must click "Open a folder".');
  const out = [];
  async function walk(dir, prefix) {
    for await (const [name, h] of dir.entries()) {
      if (out.length >= MAX_FILES) return;
      if (ignored(name)) continue;
      if (h.kind === "directory") await walk(h, prefix + name + "/");
      else out.push([prefix + name, h]);
    }
  }
  await walk(root, "");
  return out;
}

const toFile = (x) => (x instanceof File ? x : x.getFile());
const clean = (path) => String(path || "").replace(/^(\.?\/|data\/)+/, "");

async function runPython(code, signal) {
  const files = [];
  if (root || imported)
    for (const [path, x] of await list()) {
      const f = await toFile(x);
      if (f.size < 20e6) files.push([path, new Uint8Array(await f.arrayBuffer())]);
    }
  const worker = new Worker(new URL("./python-worker.js", import.meta.url), { type: "module" });
  return new Promise((resolve, reject) => {
    const done = (f, v) => { clearTimeout(timer); worker.terminate(); f(v); };
    const timer = setTimeout(() => done(reject, new Error("90 s timeout exceeded.")), 90000);
    signal.addEventListener("abort", () => done(reject, new Error("interrupted.")), { once: true });
    worker.onmessage = (e) => done(resolve, e.data);
    worker.onerror = (e) => done(reject, new Error(e.message || "Python could not start."));
    worker.postMessage({ code, files });
  });
}

export const TOOLS = [
  {
    name: "list_files",
    description: "Lists the files in the folder opened by the user.",
    parameters: {},
    run: async () => (await list()).map(([p]) => p).join("\n") || "(empty folder)",
  },
  {
    name: "read_file",
    description: "Returns the content of a text file in the opened folder.",
    parameters: { path: "relative path, for example notes/list.txt" },
    async run({ path }) {
      const found = (await list()).find(([p]) => p === clean(path));
      if (!found) throw new Error(`file not found "${path}".`);
      const text = await (await toFile(found[1])).text();
      if (text.includes("\0")) throw new Error("binary file, not readable as text.");
      return text || "(empty file)";
    },
  },
  {
    name: "write_file",
    acts: true,
    description: "Creates or replaces a text file in the opened folder.",
    parameters: { path: "relative path", content: "full content of the file" },
    async run({ path, content }) {
      if (imported) throw new Error("this browser can only open the folder read-only. Use Chrome or Edge.");
      if (!root) throw new Error('no folder open. The user must click "Open a folder".');
      const parts = clean(path).split("/");
      const name = parts.pop();
      let dir = root;
      for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: true });
      const stream = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await stream.write(String(content ?? ""));
      await stream.close();
      return `File ${clean(path)} written.`;
    },
  },
  {
    name: "run_python",
    acts: true,
    description: "Runs Python (with numpy and pandas if imported) to compute or analyze. A copy of the folder's files is in /data. Print results with print(). Nothing is kept between two calls.",
    parameters: { code: "Python code" },
    run: ({ code }, signal) => runPython(String(code || ""), signal),
  },
  {
    name: "web_request",
    acts: true,
    description: "Downloads a web page or API (GET request) and returns its text. No search engine: give an exact URL. Weather: https://api.open-meteo.com/v1/forecast?latitude=…&longitude=…&current=temperature_2m",
    parameters: { url: "full URL" },
    async run({ url }, signal) {
      // The local server makes the request: the browser would block reading the response (CORS).
      const r = await fetch("/web?url=" + encodeURIComponent(url), { signal, headers: { "X-Assistant": "1" } });
      if (!r.ok) throw new Error("web relay missing: start the demo with start.command (or python3 src/server.py).");
      return r.text();
    },
  },
];

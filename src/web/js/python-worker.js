// Worker: Python in the browser (Pyodide). Isolated from the page, but not from the network.
const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.29.4/full/";

onmessage = async ({ data: { code, files } }) => {
  const output = [];
  try {
    const { loadPyodide } = await import(PYODIDE_URL + "pyodide.mjs");
    const py = await loadPyodide({ indexURL: PYODIDE_URL });
    py.FS.mkdirTree("/data");
    for (const [path, bytes] of files) {
      const full = "/data/" + path;
      py.FS.mkdirTree(full.slice(0, full.lastIndexOf("/")));
      py.FS.writeFile(full, bytes);
    }
    py.FS.chdir("/data");
    await py.loadPackagesFromImports(code, { messageCallback() {} });
    py.setStdout({ batched: (s) => output.push(s) });
    py.setStderr({ batched: (s) => output.push(s) });
    const r = await py.runPythonAsync(code);
    if (r !== undefined && r !== null) output.push(String(r));
  } catch (e) {
    output.push("Python error: " + String(e.message || e).split("\n").slice(-4).join("\n").trim());
  }
  postMessage(output.join("\n") || "(no output: use print)");
};

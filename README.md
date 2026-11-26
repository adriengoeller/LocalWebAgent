# LocalWebAgent

A real open-weights LLM running on your own GPU inside Chrome, with a real agent harness: files, Python, web. No response is scripted.

## Run

Double-click `start.command` (macOS), or:

```bash
python3 src/server.py
```

Then open **http://localhost:8765** in Chrome or Edge. Keep the `localhost` address: on `http://[::]:…` or `http://0.0.0.0:…`, Chrome disables WebGPU.

1. Pick a model and click **Load**. The weights are downloaded once, then cached.
2. Chat freely.
3. **Open a folder** gives the assistant access to a real folder, for example `examples/` (fictional data).

Requirements: Python 3 (standard library only) and a browser with WebGPU (Chrome or Edge).

## Models

Qwen3 and SmolLM, via [WebLLM](https://github.com/mlc-ai/web-llm). Qwen and SmolLM models from [Ollama](https://ollama.com) are added to the list if Ollama is running. Qwen3-4B is the default. The smaller models often get tool calls wrong, which is instructive in itself.

## Tools

| Tool | Real effect | Asks for approval |
|---|---|---|
| `list_files`, `read_file` | Reads the opened folder (text only, no PDFs) | No |
| `write_file` | Creates or replaces a file on disk | Yes |
| `run_python` | Runs Python ([Pyodide](https://pyodide.org)) on a copy of the files | Yes |
| `web_request` | Downloads a page, via `src/server.py` | Yes |

Unticking **Ask before acting** removes the approvals. **Actions are real: preferably open a copy of a folder.**

## Indirect prompt injection demo

Open `examples/`, then ask “Summarize invoice_injected.txt”. The file instructs the assistant to send the clients' email addresses to `http://localhost:8765/collect`. If the attack succeeds, the request shows up in the server window. Nothing leaves the machine. The outcome varies by model and attempt: count the successes over ten tries. The system prompt can be edited at the bottom of the page, to test a prompt-based defense.

No inference server doesn't mean no network: the weights, WebLLM and Pyodide come from public CDNs, and both `web_request` and Python can send data out.

## Project layout

```
start.command            macOS launcher
src/
  server.py              local server: serves the page and relays web requests
  web/
    index.html, style.css
    js/
      app.js             the UI
      harness.js         the agent loop
      tools.js           the tools
      python-worker.js   Pyodide worker for run_python
      models.js          WebLLM and Ollama engines
examples/                fictional sample data
```

## License

[MIT](LICENSE)

"""Serves the web page, and fetches web pages for the web_request tool.

Browsers block reading most third-party sites (CORS), so this local server
makes the request instead. Standard library only. Listens on this machine only.
"""
import html.parser
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = 8765
HOSTS = {f"localhost:{PORT}", f"127.0.0.1:{PORT}"}
WEB_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")


class TextExtractor(html.parser.HTMLParser):
    """Keeps the readable text of an HTML page."""

    def __init__(self):
        super().__init__()
        self.chunks, self.skip = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript", "svg"):
            self.skip += 1

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript", "svg") and self.skip:
            self.skip -= 1

    def handle_data(self, data):
        if not self.skip and data.strip():
            self.chunks.append(data.strip())


def download(url):
    if urllib.parse.urlsplit(url).scheme not in ("http", "https"):
        return "Error: only http and https URLs are accepted."
    # Accents or spaces the model may have written in the URL
    url = urllib.parse.quote(url, safe=":/?#[]@!$&'()*+,;=%~")
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (local-web-agent)", "Accept-Language": "en"})
    try:
        response = urllib.request.urlopen(request, timeout=20)
    except urllib.error.HTTPError as e:
        response = e
    with response:
        body = response.read(2_000_000)
        mime_type = response.headers.get_content_type()
        encoding = response.headers.get_content_charset() or "utf-8"
    try:
        text = body.decode(encoding, "replace")
    except LookupError:
        text = body.decode("utf-8", "replace")
    if "html" in mime_type:
        main = re.search(r"<main\b.*?</main>", text, re.S | re.I)
        if main:  # leave out the menus
            text = main.group()
        extractor = TextExtractor()
        extractor.feed(text)
        text = re.sub(r"\n{2,}", "\n", "\n".join(extractor.chunks))
    elif not re.search(r"text|json|xml|csv|javascript", mime_type):
        text = f"({mime_type} content, not readable as text)"
    return f"HTTP {response.status if hasattr(response, 'status') else response.code}\n{text[:20000]}"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_ROOT, **kwargs)

    def do_GET(self):
        if not self.path.startswith("/web?"):
            return super().do_GET()
        # The header and host checks stop another site open in the browser from using the relay.
        if self.headers.get("X-Assistant") != "1" or self.headers.get("Host") not in HOSTS:
            return self.send_error(403)
        url = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).get("url", [""])[0]
        try:
            text = download(url)
        except Exception as e:
            text = f"Error: {e}"
        data = text.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    print(f"Open http://localhost:{PORT} in Chrome. Ctrl+C to stop.", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()

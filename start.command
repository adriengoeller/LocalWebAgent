#!/bin/zsh
# Double-click to start the demo. Close this window to stop it.
cd "${0:A:h}"
(sleep 1; open -a "Google Chrome" http://localhost:8765 || open http://localhost:8765) &
python3 src/server.py

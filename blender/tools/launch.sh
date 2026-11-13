#!/bin/sh
# Opens a second Blender for this project, with the MCP addon's socket on port 9877.
here="$(cd "$(dirname "$0")" && pwd)"
open -n -a Blender --args --python "$here/start_server.py"

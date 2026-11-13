# Run inside a fresh Blender at start-up (see launch.sh): the MCP addon's own server cannot
# take port 9876, which another Blender already holds, so start one for this project on 9877.
import sys
import bpy

PORT = 9877


def start():
    addon = sys.modules.get("blender_mcp_addon") or sys.modules.get("blender_mcp")
    if addon is None:
        print("Blender MCP addon is not loaded")
        return None
    old = getattr(bpy.types, "blendermcp_server", None)
    if old is not None and getattr(old, "running", False):
        if getattr(old, "port", None) == PORT:
            return None
        # The addon started itself on its default port (free because the user's main Blender
        # was not running). This Blender must only ever answer on PORT: on the default port,
        # other sessions' Blender tools would land in this scene by mistake.
        old.stop()
    server = addon.BlenderMCPServer(port=PORT)
    server.start()
    bpy.types.blendermcp_server = server
    try:
        bpy.context.scene.blendermcp_port = PORT
        bpy.context.scene.blendermcp_server_running = server.running
    except Exception:
        pass
    print("Blender MCP server for ar_rifle_demo on port", PORT, "running:", server.running)
    return None


bpy.app.timers.register(start, first_interval=1.5)

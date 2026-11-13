#!/usr/bin/env python3
"""Client for the Blender MCP addon's socket.

This project uses its OWN Blender, listening on port 9877. Port 9876 is another Blender with
other work open in it: never send anything there.

  python3 bl.py wait                 wait until the socket answers
  python3 bl.py code "print(1)"      run Python inside Blender, print what it printed
  python3 bl.py run script.py        run a script file inside Blender
  python3 bl.py <command> '{json}'   any other addon command (get_scene_info, ...)

Set BLENDER_MCP_PORT to use a different port.
"""
import json, os, socket, sys, time

PORT = int(os.environ.get("BLENDER_MCP_PORT", "9877"))
if PORT == 9876:
    sys.exit("port 9876 belongs to another Blender session; this project uses 9877")


def send(cmd_type, params=None, timeout=900):
    s = socket.create_connection(("127.0.0.1", PORT), timeout=10)
    s.settimeout(timeout)
    s.sendall(json.dumps({"type": cmd_type, "params": params or {}}).encode())
    buf = b""
    while True:
        chunk = s.recv(65536)
        if not chunk:
            break
        buf += chunk
        try:
            return json.loads(buf.decode())
        except Exception:
            continue
    return json.loads(buf.decode())


def run(code):
    r = send("execute_code", {"code": code})
    if r.get("status") == "error":
        print("ERROR:", r.get("message"))
        sys.exit(1)
    print(r.get("result", {}).get("result", ""), end="")


if __name__ == "__main__":
    mode = sys.argv[1]
    if mode == "wait":
        t0 = time.time()
        while time.time() - t0 < 90:
            try:
                print(send("ping", timeout=5))
                sys.exit(0)
            except Exception:
                time.sleep(1)
        print("timeout waiting for the Blender MCP socket on port", PORT)
        sys.exit(1)
    elif mode == "run":
        # (__file__ is set so a script can find the modules beside it)
        path = os.path.abspath(sys.argv[2])
        run(f"__file__ = {path!r}\n" + open(path).read())
    elif mode == "code":
        run(sys.argv[2])
    else:
        print(json.dumps(send(mode, json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}), indent=1)[:4000])

import sys, json, subprocess, os
# thin wrapper: line-delimited JSON {in, out, scale, noise} -> spawns ncnn binary
BIN = os.path.join(os.path.dirname(__file__), "realcugan-ncnn-vulkan")
for line in sys.stdin:
    try:
        req = json.loads(line)
        r = subprocess.run([BIN, "-i", req["in"], "-o", req["out"],
                            "-s", str(req.get("scale",4)), "-n", str(req.get("noise",0))],
                           capture_output=True)
        print(json.dumps({"ok": r.returncode==0}), flush=True)
    except Exception as e:
        print(json.dumps({"ok": False, "err": str(e)}), flush=True)

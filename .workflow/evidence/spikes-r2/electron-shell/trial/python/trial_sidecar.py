import sys
for line in sys.stdin:
    line = line.strip()
    if line.startswith("PING:"):
        sys.stdout.write("PONG:" + line[5:] + "\n")
        sys.stdout.flush()

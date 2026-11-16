import socket
import time

s = socket.socket()
s.connect(('192.168.1.199', 23))
time.sleep(0.3)
s.recv(4096)
remote_cmd = """python -c '
with open("/media/developer/apps/usr/palm/applications/vkvideo/app.js", "r") as f:
    text = f.read()
import re
for m in re.finditer(r"method/video\.[A-Za-z0-9_]+", text):
    print("METHOD:", m.group(0))
for m in re.finditer(r"method/newsfeed\.[A-Za-z0-9_]+", text):
    print("NEWSFEED:", m.group(0))
for m in re.finditer(r"method/groups\.[A-Za-z0-9_]+", text):
    print("GROUPS:", m.group(0))
'
"""
s.sendall(remote_cmd.encode('ascii') + b"\n")
time.sleep(1.2)
print(s.recv(16384).decode('utf-8', errors='ignore'))
s.close()

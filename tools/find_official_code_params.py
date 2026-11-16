import socket
import time

s = socket.socket()
s.connect(('192.168.1.199', 23))
time.sleep(0.3)
s.recv(4096)
remote_cmd = """python -c '
with open("/media/developer/apps/usr/palm/applications/vkvideo/app.js", "r") as f:
    text = f.read()
idx = text.find("lc:new Ll(i.u")
print("BEFORE:")
print(text[max(0, idx - 600):idx])
'
"""
s.sendall(remote_cmd.encode('ascii') + b"\n")
time.sleep(1.2)
print(s.recv(16384).decode('utf-8', errors='ignore'))
s.close()

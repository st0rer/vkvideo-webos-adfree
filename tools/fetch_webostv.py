import socket
import base64
import time

s = socket.socket()
s.connect(('192.168.1.199', 23))
s.recv(1024)
s.sendall(b"base64 /media/developer/apps/usr/palm/applications/bylampa.tv/webOSTVjs-1.2.4/webOSTV.js\n")
time.sleep(1.0)
buf = b""
while True:
    chunk = s.recv(4096)
    if not chunk: break
    buf += chunk
    if b"~ #" in chunk:
        break
s.close()

lines = buf.decode('utf-8', errors='ignore').splitlines()
b64_lines = []
capturing = False
for l in lines:
    if "base64" in l:
        capturing = True
        continue
    if "~ #" in l:
        break
    if capturing:
        b64_lines.append(l.strip())

b64_data = "".join(b64_lines)
raw_js = base64.b64decode(b64_data).decode('utf-8')
with open('src/js/webOSTV.js', 'w', encoding='utf-8') as f:
    f.write(raw_js)

print("Saved src/js/webOSTV.js, length:", len(raw_js))

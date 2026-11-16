import socket
import time

s = socket.socket()
s.connect(('192.168.1.199', 23))
time.sleep(0.3)
s.recv(1024)
s.sendall(b"cat /media/developer/apps/usr/palm/applications/org.webosbrew.vkvideo.adfree/js/webOSTV.js\n")

buf = b""
s.settimeout(2.0)
while True:
    try:
        chunk = s.recv(4096)
        if not chunk: break
        buf += chunk
        if b"~ #" in buf:
            break
    except:
        break
s.close()

lines = buf.decode('utf-8', errors='ignore').splitlines()
code_lines = [l for l in lines if not l.startswith('~ #') and not 'cat /media' in l and not 'webOS TV' in l]
content = "\n".join(code_lines).strip()
with open('C:/Users/Storer/.gemini/antigravity/scratch/vkvideo-adfree/src/js/webOSTV.js', 'w', encoding='utf-8') as f:
    f.write(content)
print("Saved src/js/webOSTV.js, length:", len(content))

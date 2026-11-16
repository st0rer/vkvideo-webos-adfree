import socket
import time
import os
import sys

TV_IP = "192.168.1.199"

def push_file(local_path, remote_path):
    with open(local_path, "rb") as f:
        data = f.read()
    size = len(data)
    
    # 1. Start receiver on TV
    tn = socket.socket()
    tn.connect((TV_IP, 23))
    time.sleep(0.2)
    tn.recv(1024)
    
    cmd = f"""python -c "
import socket
s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(('0.0.0.0', 9999))
s.listen(1)
conn, addr = s.accept()
f = open('{remote_path}', 'wb')
rem = {size}
while rem > 0:
    buf = conn.recv(min(rem, 65536))
    if not buf: break
    f.write(buf)
    rem -= len(buf)
f.close()
conn.close()
s.close()
" &
"""
    tn.sendall(cmd.encode('utf-8'))
    time.sleep(0.5)
    
    # 2. Connect to data socket and send
    sock = socket.socket()
    sock.connect((TV_IP, 9999))
    sock.sendall(data)
    sock.close()
    
    time.sleep(0.5)
    # Check size on TV
    tn.sendall(f"ls -la {remote_path}\n".encode('utf-8'))
    time.sleep(0.3)
    out = tn.recv(4096).decode('utf-8', errors='ignore')
    print(out.strip())
    tn.close()

if __name__ == '__main__':
    base = os.path.dirname(os.path.abspath(__file__))
    push_file(os.path.join(base, "src", "index.html"), "/media/developer/apps/usr/palm/applications/org.webosbrew.vkvideo.adfree/index.html")
    push_file(os.path.join(base, "src", "css", "style.css"), "/media/developer/apps/usr/palm/applications/org.webosbrew.vkvideo.adfree/css/style.css")
    push_file(os.path.join(base, "src", "js", "api.js"), "/media/developer/apps/usr/palm/applications/org.webosbrew.vkvideo.adfree/js/api.js")
    push_file(os.path.join(base, "src", "js", "navigation.js"), "/media/developer/apps/usr/palm/applications/org.webosbrew.vkvideo.adfree/js/navigation.js")
    push_file(os.path.join(base, "src", "js", "app.js"), "/media/developer/apps/usr/palm/applications/org.webosbrew.vkvideo.adfree/js/app.js")


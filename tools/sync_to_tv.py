import socket
import time
import os

files_to_sync = [
    ('src/js/webOSTV.js', '/media/developer/apps/usr/palm/applications/org.webosbrew.vkvideo.adfree/js/webOSTV.js'),
    ('src/js/api.js', '/media/developer/apps/usr/palm/applications/org.webosbrew.vkvideo.adfree/js/api.js'),
    ('src/js/app.js', '/media/developer/apps/usr/palm/applications/org.webosbrew.vkvideo.adfree/js/app.js'),
    ('src/index.html', '/media/developer/apps/usr/palm/applications/org.webosbrew.vkvideo.adfree/index.html'),
    ('src/appinfo.json', '/media/developer/apps/usr/palm/applications/org.webosbrew.vkvideo.adfree/appinfo.json'),
]

s = socket.socket()
s.connect(('192.168.1.199', 23))
time.sleep(0.3)
s.recv(4096)

base_dir = os.path.dirname(os.path.abspath(__file__))
for rel_path, remote_path in files_to_sync:
    local_path = os.path.join(base_dir, rel_path)
    with open(local_path, 'rb') as f:
        data = f.read()
    print(f"Syncing {local_path} ({len(data)} bytes) -> {remote_path}...")
    import base64
    b64 = base64.b64encode(data).decode('ascii')
    # write in chunks of 4000
    s.sendall(f"cat /dev/null > {remote_path}.b64\n".encode('ascii'))
    time.sleep(0.2)
    s.recv(4096)
    
    chunk_size = 4000
    for i in range(0, len(b64), chunk_size):
        chunk = b64[i:i+chunk_size]
        s.sendall(f"echo -n '{chunk}' >> {remote_path}.b64\n".encode('ascii'))
        time.sleep(0.05)
    
    s.sendall(f"base64 -d {remote_path}.b64 > {remote_path} && rm -f {remote_path}.b64\n".encode('ascii'))
    time.sleep(0.3)
    s.recv(4096)

print("Sync completed!")
s.close()

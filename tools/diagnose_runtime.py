import socket
import base64
import os
import json
import time
import urllib.request

pages = json.loads(urllib.request.urlopen('http://192.168.1.199:9998/json').read().decode('utf-8'))
ws_url = None
for p in pages:
    if 'vkvideo' in p.get('url', ''):
        ws_url = p.get('webSocketDebuggerUrl')
        break

if not ws_url:
    print("Could not find vkvideo page in devtools")
    exit(1)

path = ws_url.split(':9998')[-1]
s = socket.socket()
s.connect(('192.168.1.199', 9998))
key = base64.b64encode(os.urandom(16)).decode('ascii')
req = (
    f'GET {path} HTTP/1.1\r\n'
    'Host: 192.168.1.199:9998\r\n'
    'Upgrade: websocket\r\n'
    'Connection: Upgrade\r\n'
    f'Sec-WebSocket-Key: {key}\r\n'
    f'Sec-WebSocket-Version: 13\r\n\r\n'
)
s.sendall(req.encode('ascii'))
s.recv(4096)

def send_ws(msg):
    raw = json.dumps(msg).encode('utf-8')
    length = len(raw)
    header = bytearray([0x81])
    if length <= 125:
        header.append(0x80 | length)
    elif length <= 65535:
        header.append(0x80 | 126)
        header.extend(length.to_bytes(2, 'big'))
    mask = os.urandom(4)
    header.extend(mask)
    masked = bytearray([b ^ mask[i % 4] for i, b in enumerate(raw)])
    s.sendall(header + masked)

def read_frames(timeout=2.0):
    s.settimeout(timeout)
    data = b""
    try:
        while True:
            chunk = s.recv(65536)
            if not chunk: break
            data += chunk
    except socket.timeout:
        pass
    
    msgs = []
    idx = 0
    while idx < len(data):
        if idx + 2 > len(data): break
        b2 = data[idx+1]
        plen = b2 & 0x7F
        hlen = 2
        if plen == 126:
            if idx + 4 > len(data): break
            plen = int.from_bytes(data[idx+2:idx+4], 'big')
            hlen = 4
        elif plen == 127:
            if idx + 10 > len(data): break
            plen = int.from_bytes(data[idx+2:idx+10], 'big')
            hlen = 10
        payload = data[idx+hlen : idx+hlen+plen]
        try:
            msgs.append(json.loads(payload.decode('utf-8', errors='ignore')))
        except:
            pass
        idx += hlen + plen
    return msgs

# Enable Runtime and Console
send_ws({'id': 1, 'method': 'Runtime.enable'})
send_ws({'id': 2, 'method': 'Page.enable'})
time.sleep(0.5)

# Check document and scripts
check_code = """
(() => {
    return {
        readyState: document.readyState,
        hasVkApp: typeof window.vkApp !== 'undefined',
        hasVKApi: typeof window.VKApi !== 'undefined',
        hasCatalog: typeof window.VK_CURATED_CATALOG !== 'undefined',
        scripts: Array.from(document.querySelectorAll('script')).map(s => s.src),
        bodyHtml: document.body.innerHTML.substring(0, 300)
    };
})()
"""
send_ws({'id': 10, 'method': 'Runtime.evaluate', 'params': {'expression': check_code, 'returnByValue': True}})
time.sleep(1.0)
frames = read_frames()
for f in frames:
    if f.get('id') == 10:
        print("Script check result:")
        print(json.dumps(f.get('result', {}).get('result', {}).get('value'), indent=2, ensure_ascii=False))

# Now test reloading the page and listening for console messages
send_ws({'id': 20, 'method': 'Page.reload'})
time.sleep(2.0)
frames2 = read_frames(3.0)
print("\nEvents after reload:")
for f in frames2:
    method = f.get('method', '')
    if 'Console' in method or 'Runtime' in method:
        print(f"  [{method}]", json.dumps(f.get('params'), ensure_ascii=False))

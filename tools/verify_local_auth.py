import socket
import base64
import os
import json
import time
import urllib.request

# 1. Get CDP target
pages = json.loads(urllib.request.urlopen('http://192.168.1.199:9998/json').read().decode('utf-8'))
ws_url = None
for p in pages:
    if 'vkvideo' in p.get('url', ''):
        ws_url = p.get('webSocketDebuggerUrl')
        break

if not ws_url:
    print("Could not find vkvideo target")
    exit(1)

# Connect to WS
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
    'Sec-WebSocket-Version: 13\r\n\r\n'
)
s.sendall(req.encode('ascii'))
resp = s.recv(4096)

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

def eval_js(expr, req_id):
    send_ws({'id': req_id, 'method': 'Runtime.evaluate', 'params': {'expression': expr, 'returnByValue': True, 'awaitPromise': True}})

send_ws({'id': 1, 'method': 'Runtime.enable'})
send_ws({'id': 2, 'method': 'Console.enable'})

print("--- Testing: Trigger window.vkApp.openQRModal() ---")
eval_js("window.vkApp.openQRModal()", 100)

time.sleep(2.0)

# Check console output
s.settimeout(0.5)
while True:
    try:
        chunk = s.recv(4096)
        if not chunk: break
        # search for console text
        text = chunk.decode('utf-8', errors='ignore')
        for line in text.split('\n'):
            if 'text' in line or 'CONSOLE' in line:
                print("TV Log:", line.strip())
    except:
        break

print("--- Checking port 8765 on TV ---")
try:
    auth_page = urllib.request.urlopen('http://192.168.1.199:8765/', timeout=3).read().decode('utf-8')
    print("SUCCESS! http://192.168.1.199:8765/ is responding.")
    print("Page Title/Preview:")
    print("\n".join(auth_page.splitlines()[:20]))
    if 'oauth.vk.com/authorize' in auth_page:
        print("PASS: Kate Mobile OAuth link is present in the web page!")
except Exception as e:
    print("Failed to reach http://192.168.1.199:8765/:", e)

print("--- Checking processes via Telnet ---")
tel = socket.socket()
tel.connect(('192.168.1.199', 23))
tel.recv(1024)
tel.sendall(b"ps aux | grep -v grep | grep auth_server\n")
time.sleep(0.5)
print("Running processes:\n", tel.recv(4096).decode('utf-8', errors='ignore'))

print("--- Testing Modal Close & Process Termination ---")
eval_js("window.vkApp.closeAllModals()", 200)
time.sleep(1.5)

tel.sendall(b"ps aux | grep -v grep | grep auth_server\n")
time.sleep(0.5)
after_ps = tel.recv(4096).decode('utf-8', errors='ignore')
print("Processes after modal close:\n", after_ps)
tel.close()
s.close()

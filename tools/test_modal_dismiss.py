import socket
import base64
import os
import json
import urllib.request
import time

pages = json.loads(urllib.request.urlopen('http://192.168.1.199:9998/json').read().decode('utf-8'))
ws_url = None
for p in pages:
    if 'vkvideo' in p.get('url', ''):
        ws_url = p.get('webSocketDebuggerUrl')
        break

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

print("1. Opening modal...")
send_ws({'id': 1, 'method': 'Runtime.evaluate', 'params': {'expression': 'window.vkApp.openQRModal()', 'returnByValue': True}})
time.sleep(2.0)

tel = socket.socket()
tel.connect(('192.168.1.199', 23))
tel.recv(1024)
tel.sendall(b"ps aux | grep -v grep | grep auth_server\n")
time.sleep(0.5)
out1 = tel.recv(4096).decode('utf-8', errors='ignore')
print("Server running while modal is open:")
print(out1.strip())

print("2. Closing modal (user presses Back or Close button)...")
send_ws({'id': 2, 'method': 'Runtime.evaluate', 'params': {'expression': 'window.vkApp.closeAllModals()', 'returnByValue': True}})
time.sleep(1.5)

tel.sendall(b"ps aux | grep -v grep | grep auth_server\n")
time.sleep(0.5)
out2 = tel.recv(4096).decode('utf-8', errors='ignore')
print("Server running after modal closed:")
print(out2.strip())
tel.close()
s.close()

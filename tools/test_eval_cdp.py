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

def eval_code(code):
    raw = json.dumps({'id': 1, 'method': 'Runtime.evaluate', 'params': {'expression': code, 'returnByValue': True, 'awaitPromise': True}}).encode('utf-8')
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
    time.sleep(0.3)
    data = s.recv(16384)
    idx = 0
    while idx < len(data):
        if idx + 2 > len(data): break
        b1 = data[idx]
        b2 = data[idx+1]
        payload_len = b2 & 0x7f
        idx += 2
        if payload_len == 126:
            payload_len = int.from_bytes(data[idx:idx+2], 'big')
            idx += 2
        elif payload_len == 127:
            payload_len = int.from_bytes(data[idx:idx+8], 'big')
            idx += 8
        payload = data[idx:idx+payload_len]
        idx += payload_len
        try:
            msg = json.loads(payload.decode('utf-8'))
            print("RECV MSG:", msg)
            if msg.get('id') == 1:
                return msg.get('result', {}).get('result', {}).get('value')
        except Exception as err:
            print("PARSE ERR:", err)
    return None

print("Testing native VK get_auth_code fetch on TV...")
test_fetch = """
fetch('https://oauth.vk.com/get_auth_code?client_id=4171611&scope=video,offline,wall,groups&device_name=LG%20webOS%20TV&need_qr_code=1&need_revoke=1')
  .then(r => r.json())
  .then(d => d)
"""
print("Result from TV:", eval_code(test_fetch))
s.close()

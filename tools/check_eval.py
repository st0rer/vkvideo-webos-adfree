import socket
import base64
import os
import json
import urllib.request
import time

def send_frame(s, text):
    raw = text.encode('utf-8')
    length = len(raw)
    header = bytearray([0x81])
    if length <= 125:
        header.append(0x80 | length)
    elif length <= 65535:
        header.append(0x80 | 126)
        header.extend(length.to_bytes(2, 'big'))
    else:
        header.append(0x80 | 127)
        header.extend(length.to_bytes(8, 'big'))
    mask = os.urandom(4)
    header.extend(mask)
    masked = bytearray([b ^ mask[i % 4] for i, b in enumerate(raw)])
    s.sendall(header + masked)

def recv_frame(s):
    data = s.recv(65536)
    if not data:
        return ""
    # frame decoding
    payload = b""
    idx = 0
    while idx < len(data):
        if idx + 2 > len(data): break
        b1 = data[idx]
        b2 = data[idx+1]
        payload_len = b2 & 0x7f
        header_len = 2
        if payload_len == 126:
            header_len = 4
            payload_len = int.from_bytes(data[idx+2:idx+4], 'big')
        elif payload_len == 127:
            header_len = 10
            payload_len = int.from_bytes(data[idx+2:idx+10], 'big')
        payload += data[idx+header_len:idx+header_len+payload_len]
        idx += header_len + payload_len
    return payload.decode('utf-8', errors='ignore')

pages = json.loads(urllib.request.urlopen('http://192.168.1.199:9998/json').read().decode('utf-8'))
ws_url = pages[0]['webSocketDebuggerUrl']
path = ws_url.split(':9998')[-1]
s = socket.socket()
s.connect(('192.168.1.199', 9998))
key = base64.b64encode(os.urandom(16)).decode('ascii')
s.sendall(f'GET {path} HTTP/1.1\r\nHost: 192.168.1.199:9998\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n'.encode('ascii'))
s.recv(4096)

def eval_code(code, req_id=1):
    payload = json.dumps({'id': req_id, 'method': 'Runtime.evaluate', 'params': {'expression': code, 'returnByValue': True, 'awaitPromise': True}})
    send_frame(s, payload)
    time.sleep(0.3)
    return recv_frame(s)

print('href:', eval_code('document.location.href', 1))
print('title:', eval_code('document.title', 2))
print('readyState:', eval_code('document.readyState', 3))
print('bodyLen:', eval_code('document.body ? document.body.innerHTML.length : -1', 4))
print('scripts:', eval_code('Array.from(document.scripts).map(s => s.src)', 5))
print('app exists:', eval_code('typeof window.vkApp', 6))

s.close()

import socket
import base64
import os
import json
import time
import urllib.request

# Get page ws url
pages = json.loads(urllib.request.urlopen('http://192.168.1.199:9998/json').read().decode('utf-8'))
ws_url = None
for p in pages:
    if 'vkvideo' in p.get('url', ''):
        ws_url = p.get('webSocketDebuggerUrl')
        break

if not ws_url:
    print("Could not find vkvideo page in devtools")
    exit(1)

# Connect
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
eval_js("document.querySelectorAll('.video-card').length", 110)
eval_js("window.vkApp && window.vkApp.nav && window.vkApp.nav.currentFocused ? window.vkApp.nav.currentFocused.outerHTML.slice(0, 150) : 'NO_FOCUS'", 111)
eval_js("document.querySelector('.video-card') ? document.querySelector('.video-card').outerHTML.slice(0, 200) : 'NO_CARD'", 112)

time.sleep(1.5)
data = b""
s.settimeout(1.0)
while True:
    try:
        c = s.recv(16384)
        if not c: break
        data += c
    except:
        break

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
        if 'result' in msg and 'result' in msg['result']:
            res_obj = msg['result']['result']
            print(f"[ID {msg.get('id')} RAW]:", res_obj)
            val = res_obj.get('value')
            print(f"[ID {msg.get('id')} RESULT]:", json.dumps(val, indent=2, ensure_ascii=False) if isinstance(val, dict) else val)
        elif msg.get('method') == 'Console.messageAdded':
            print("[CONSOLE]:", msg['params']['message']['text'])
    except Exception as e:
        pass

s.close()

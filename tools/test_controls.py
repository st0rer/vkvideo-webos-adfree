import urllib.request
import json
import time
import socket
import base64
import os

pages = json.loads(urllib.request.urlopen('http://192.168.1.199:9998/json').read().decode('utf-8'))
ws_url = [p['webSocketDebuggerUrl'] for p in pages if 'vkvideo' in p['url']][0]
path = ws_url.split(':9998')[-1]
s = socket.socket()
s.connect(('192.168.1.199', 9998))
key = base64.b64encode(os.urandom(16)).decode('ascii')
s.sendall(f'GET {path} HTTP/1.1\r\nHost: 192.168.1.199:9998\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n'.encode('ascii'))
s.recv(4096)

def send_ws(msg):
    raw = json.dumps(msg).encode('utf-8')
    header = bytearray([0x81, 0x80 | (126 if len(raw) > 125 else len(raw))])
    if len(raw) > 125: header.extend(len(raw).to_bytes(2, 'big'))
    mask = os.urandom(4)
    header.extend(mask)
    s.sendall(header + bytearray([b ^ mask[i % 4] for i, b in enumerate(raw)]))

# 1. Test Pause
send_ws({'id': 40, 'method': 'Runtime.evaluate', 'params': {'expression': 'window.vkApp.player.togglePlay(); document.getElementById("native-player").paused;', 'returnByValue': True}})
time.sleep(1)

# 2. Test Resume
send_ws({'id': 41, 'method': 'Runtime.evaluate', 'params': {'expression': 'window.vkApp.player.togglePlay(); document.getElementById("native-player").paused;', 'returnByValue': True}})
time.sleep(1)

# 3. Test Progressive Seek +10s
send_ws({'id': 42, 'method': 'Runtime.evaluate', 'params': {'expression': 'window.vkApp.player.seekProgressive(10); document.getElementById("seek-bubble").style.display;', 'returnByValue': True}})
time.sleep(1)

data = s.recv(16384)
idx = 0
while idx < len(data):
    if idx + 2 > len(data): break
    payload_len = data[idx+1] & 0x7f
    idx += 2
    if payload_len == 126:
        payload_len = int.from_bytes(data[idx:idx+2], 'big')
        idx += 2
    payload = data[idx:idx+payload_len]
    idx += payload_len
    try:
        msg = json.loads(payload.decode('utf-8'))
        mid = msg.get('id')
        val = msg.get('result', {}).get('result', {}).get('value')
        if mid == 40:
            print("1. Pause command executed -> video paused:", val)
        elif mid == 41:
            print("2. Play command executed -> video paused:", val)
        elif mid == 42:
            print("3. Progressive seek bubble display:", val)
    except:
        pass

s.close()

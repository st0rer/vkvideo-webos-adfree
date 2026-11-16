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

# Find line of error
test_script = """
(() => {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', 'js/player.js', false);
    xhr.send();
    var lines = xhr.responseText.split('\\n');
    var accum = '';
    for (var i = 0; i < lines.length; i++) {
        accum += lines[i] + '\\n';
        try {
            new Function(accum);
        } catch (e) {
            return 'Failed at line ' + (i + 1) + ': ' + lines[i] + ' | Error: ' + e.message;
        }
    }
    return 'ALL_LINES_OK';
})()
"""

send_ws({'id': 1, 'method': 'Runtime.evaluate', 'params': {'expression': test_script, 'returnByValue': True}})
time.sleep(1.0)
data = s.recv(16384)
# parse
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
        if 'result' in msg:
            print("Line search result:", msg['result']['result'].get('value'))
    except:
        pass
s.close()

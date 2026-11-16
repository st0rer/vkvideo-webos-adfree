import socket
import base64
import os
import json
import urllib.request
import time

pages = json.loads(urllib.request.urlopen('http://192.168.1.199:9998/json').read().decode('utf-8'))
ws_url = pages[0]['webSocketDebuggerUrl']
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
    time.sleep(1.2)
    data = s.recv(16384)
    
    # decode websocket frame
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

js = """
(async () => {
    await window.vkApp.openQRModal();
    return {
        modalDisplay: document.getElementById('qr-modal').style.display,
        authCode: document.getElementById('qr-auth-code').textContent,
        status: document.getElementById('qr-status').textContent,
        hasSvg: !!document.querySelector('#qr-canvas-container svg'),
        userName: document.getElementById('user-name').textContent,
        userStatus: document.getElementById('user-status').textContent
    };
})()
"""

print(eval_code(js))
s.close()

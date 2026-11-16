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
s.sendall(f'GET {path} HTTP/1.1\r\nHost: 192.168.1.199:9998\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n'.encode('ascii'))
s.recv(4096)

def eval_code(code, req_id=1):
    payload = json.dumps({'id': req_id, 'method': 'Runtime.evaluate', 'params': {'expression': code, 'returnByValue': True, 'awaitPromise': True}}).encode('utf-8')
    raw = payload
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
    time.sleep(1.0)
    data = s.recv(65536)
    # decode websocket frame
    payload = b''
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

# 1. Check if there are any console logs or errors stored or intercepted
test_js = """
(async () => {
    // Let's do a fresh getDeviceAuthCode and inspect everything
    const codeData = await window.vkApp.api.getDeviceAuthCode();
    const pollResult = await window.vkApp.api.pollDeviceToken(codeData.deviceId);
    
    // Also test raw fetch
    const rawResp = await fetch(`https://oauth.vk.com/code_auth_token?client_id=4171611&device_id=${codeData.deviceId}`);
    const rawText = await rawResp.text();
    
    return {
        codeData,
        pollResult,
        rawStatus: rawResp.status,
        rawText
    };
})()
"""

print(eval_code(test_js, 1))
s.close()

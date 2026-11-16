import socket
import base64
import os
import json
import urllib.request
import time

def evaluate(js, timeout=10.0):
    pages = json.loads(urllib.request.urlopen('http://192.168.1.199:9998/json').read().decode('utf-8'))
    vk_page = next((p for p in pages if 'vkvideo' in p.get('url', '') or 'VK Video' in p.get('title', '')), pages[0])
    ws_url = vk_page['webSocketDebuggerUrl']
    path = ws_url.split(':9998')[-1]
    s = socket.socket()
    s.settimeout(timeout)
    s.connect(('192.168.1.199', 9998))
    key = base64.b64encode(os.urandom(16)).decode('ascii')
    s.sendall(f'GET {path} HTTP/1.1\r\nHost: 192.168.1.199:9998\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n'.encode('ascii'))
    
    # Read upgrade response
    resp = b''
    while b'\r\n\r\n' not in resp:
        chunk = s.recv(1024)
        if not chunk: break
        resp += chunk

    payload = json.dumps({'id': 1, 'method': 'Runtime.evaluate', 'params': {'expression': js, 'returnByValue': True, 'awaitPromise': True}}).encode('utf-8')
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

    # Read websocket frame
    buf = b''
    target_len = None
    header_len = 0
    while True:
        try:
            chunk = s.recv(65536)
            if not chunk: break
            buf += chunk
            if target_len is None and len(buf) >= 2:
                b2 = buf[1]
                payload_len = b2 & 0x7f
                header_len = 2
                if payload_len == 126 and len(buf) >= 4:
                    header_len = 4
                    target_len = int.from_bytes(buf[2:4], 'big')
                elif payload_len == 127 and len(buf) >= 10:
                    header_len = 10
                    target_len = int.from_bytes(buf[2:10], 'big')
                elif payload_len < 126:
                    target_len = payload_len
            if target_len is not None and len(buf) >= header_len + target_len:
                break
        except socket.timeout:
            break
            
    s.close()
    
    if target_len is not None:
        payload_data = buf[header_len:header_len+target_len]
        res = json.loads(payload_data.decode('utf-8', errors='ignore'))
        if 'result' in res and 'result' in res['result']:
            val = res['result']['result'].get('value')
            if val is not None:
                return val
            if 'description' in res['result']['result']:
                return res['result']['result']['description']
        if 'exceptionDetails' in res.get('result', {}):
            print("CDP Exception:", res['result']['exceptionDetails'])
        return res
    return None

if __name__ == '__main__':
    import sys
    code = sys.argv[1] if len(sys.argv) > 1 else 'document.title'
    print(evaluate(code))

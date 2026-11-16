import socket, base64, os, json, time, urllib.request, sys

sys.stdout.reconfigure(encoding='utf-8')

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
    f'Sec-WebSocket-Version: 13\r\n\r\n'
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

def eval_js(expr, req_id):
    send_ws({'id': req_id, 'method': 'Runtime.evaluate', 'params': {'expression': expr, 'returnByValue': True}})
    s.settimeout(2.0)
    res = b""
    try:
        while True:
            chunk = s.recv(65536)
            if not chunk: break
            res += chunk
    except socket.timeout:
        pass
    
    idx = 0
    while idx < len(res):
        if idx + 2 > len(res): break
        b2 = res[idx+1]
        payload_len = b2 & 0x7F
        header_len = 2
        if payload_len == 126:
            if idx + 4 > len(res): break
            payload_len = int.from_bytes(res[idx+2:idx+4], 'big')
            header_len = 4
        elif payload_len == 127:
            if idx + 10 > len(res): break
            payload_len = int.from_bytes(res[idx+2:idx+10], 'big')
            header_len = 10
        payload = res[idx+header_len : idx+header_len+payload_len]
        try:
            msg = json.loads(payload.decode('utf-8', errors='ignore'))
            if msg.get('id') == req_id:
                return msg.get('result', {}).get('result', {}).get('value')
        except:
            pass
        idx += header_len + payload_len
    return None

test_codecs = """
(() => {
    const list = [
        'video/webm; codecs="av01.0.12M.08.0.110.01.01.01.0"',
        'video/webm; codecs="av01.0.08M.08.0.110.01.01.01.0"',
        'video/mp4; codecs="av01.0.12M.08"',
        'video/webm; codecs="vp09.00.50.08.01.01.01.02.00"',
        'video/webm; codecs="vp9"',
        'video/mp4; codecs="hev1.1.6.L153.B0"',
        'video/mp4; codecs="hvc1.1.6.L153.B0"',
        'video/mp4; codecs="avc1.640033"',
        'video/mp4; codecs="avc1.4d401f"'
    ];
    const res = {};
    for (const c of list) {
        res[c] = MediaSource.isTypeSupported(c);
    }
    return res;
})()
"""

results = eval_js(test_codecs, 999)
print("MediaSource Codec Support on LG C1 OLED TV:")
print(json.dumps(results, indent=2))
s.close()

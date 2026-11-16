import socket, base64, os, json, time, urllib.request, sys

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

def read_ws():
    s.settimeout(2.0)
    res = b""
    try:
        while True:
            chunk = s.recv(65536)
            if not chunk: break
            res += chunk
    except socket.timeout:
        pass
    msgs = []
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
            msgs.append(json.loads(payload.decode('utf-8', errors='ignore')))
        except:
            pass
        idx += header_len + payload_len
    return msgs

def eval_js(expr, req_id):
    send_ws({'id': req_id, 'method': 'Runtime.evaluate', 'params': {'expression': expr, 'returnByValue': True, 'awaitPromise': True}})
    time.sleep(0.5)
    msgs = read_ws()
    for m in msgs:
        if m.get('id') == req_id:
            return m.get('result', {}).get('result', {}).get('value')
    return None

test_native = """
(() => {
    const p = window.vkApp.player;
    const hlsUrl = p.currentVideo.streams.hls;
    if (p.hls) {
        p.hls.destroy();
        p.hls = null;
    }
    p.video.src = hlsUrl;
    p.video.currentTime = 50;
    p.video.play();
    return { hlsUrl: hlsUrl.substring(0, 80) };
})()
"""

res = eval_js(test_native, 1501)
print("Testing native webOS HLS pipeline:", json.dumps(res, indent=2))
time.sleep(4.0)

test_perf = """
(() => {
    const v = window.vkApp.player.video;
    return {
        currentTime: v.currentTime,
        paused: v.paused,
        videoWidth: v.videoWidth,
        videoHeight: v.videoHeight,
        decoded: v.webkitDecodedFrameCount,
        dropped: v.webkitDroppedFrameCount
    };
})()
"""
perf = eval_js(test_perf, 1502)
print("Native webOS HLS Performance:", json.dumps(perf, indent=2))
s.close()

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

def eval_js(expr, req_id, timeout=8.0):
    send_ws({'id': req_id, 'method': 'Runtime.evaluate', 'params': {'expression': expr, 'returnByValue': True, 'awaitPromise': True}})
    deadline = time.time() + timeout
    buffer = b""
    s.settimeout(0.5)
    while time.time() < deadline:
        try:
            chunk = s.recv(65536)
            if not chunk: break
            buffer += chunk
        except socket.timeout:
            pass

        idx = 0
        while idx < len(buffer):
            if idx + 2 > len(buffer): break
            b2 = buffer[idx+1]
            payload_len = b2 & 0x7F
            header_len = 2
            if payload_len == 126:
                if idx + 4 > len(buffer): break
                payload_len = int.from_bytes(buffer[idx+2:idx+4], 'big')
                header_len = 4
            elif payload_len == 127:
                if idx + 10 > len(buffer): break
                payload_len = int.from_bytes(buffer[idx+2:idx+10], 'big')
                header_len = 10
            
            if idx + header_len + payload_len > len(buffer):
                break
                
            payload = buffer[idx+header_len : idx+header_len+payload_len]
            idx += header_len + payload_len
            try:
                msg = json.loads(payload.decode('utf-8', errors='ignore'))
                if msg.get('id') == req_id:
                    return msg.get('result', {}).get('result', {}).get('value')
            except:
                pass
    return None

# Fetch real AV1 MPD URL for -108468_456257702
req = urllib.request.Request('https://proxy.vkvideo.ru/api/method/auth.getAnonymToken?client_id=2274003&v=5.199', headers={'User-Agent': 'VKVideoSmartTV/1.0'})
resp = urllib.request.urlopen(req)
token = json.loads(resp.read().decode())['response']['token']

url = f'https://proxy.vkvideo.ru/api/method/video.get?videos=-108468_456257702&extended=1&v=5.199&access_token={token}'
req2 = urllib.request.Request(url, headers={'User-Agent': 'VKVideoSmartTV/1.0'})
resp2 = urllib.request.urlopen(req2)
item = json.loads(resp2.read().decode())['response']['items'][0]
av1_url = item.get('files', {}).get('dash_webm_av1')
print("Fetched AV1 Manifest URL:", av1_url, flush=True)

test_play_av1 = f"""
(async () => {{
    const v = document.getElementById('native-player');
    const p = window.app.player;
    if (p.hls) {{
        p.hls.destroy();
        p.hls = null;
    }}
    if (window._shakaPlayer) {{
        await window._shakaPlayer.destroy();
    }}
    
    const shakaPlayer = new shaka.Player(v);
    window._shakaPlayer = shakaPlayer;
    
    // Configure Shaka for low memory TV
    shakaPlayer.configure({{
        streaming: {{
            bufferingGoal: 8,
            rebufferingGoal: 2,
            bufferBehind: 0
        }}
    }});
    
    try {{
        await shakaPlayer.load('{av1_url}');
        // Select 4K AV1 track
        const tracks = shakaPlayer.getVariantTracks();
        const tracks4K = tracks.filter(t => t.height >= 2160);
        if (tracks4K.length > 0) {{
            shakaPlayer.selectVariantTrack(tracks4K[0], true);
        }}
        await v.play();
        return {{
            status: 'playing',
            activeTrack: shakaPlayer.getVariantTracks().find(t => t.active),
            allTracks: tracks.map(t => ({{ h: t.height, codec: t.codecs, bw: t.bandwidth }}))
        }};
    }} catch (e) {{
        return {{ error: e.message || String(e), code: e.code }};
    }}
}})()
"""

print("Loading AV1 into Shaka Player on TV...", flush=True)
res = eval_js(test_play_av1, 888, timeout=10.0)
print("Playback result:", json.dumps(res, indent=2), flush=True)

# Wait 5 seconds to test dropped frames
time.sleep(5.0)

check_perf = """
(() => {
    const v = document.getElementById('native-player');
    const track = window._shakaPlayer ? window._shakaPlayer.getVariantTracks().find(t => t.active) : null;
    return {
        currentTime: v.currentTime,
        paused: v.paused,
        videoWidth: v.videoWidth,
        videoHeight: v.videoHeight,
        decoded: v.webkitDecodedFrameCount,
        dropped: v.webkitDroppedFrameCount,
        activeCodec: track ? track.videoCodec : null
    };
})()
"""
perf = eval_js(check_perf, 889)
print("AV1 Performance on LG C1 OLED TV:", json.dumps(perf, indent=2), flush=True)

s.close()

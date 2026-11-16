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

def read_ws(timeout=2.0):
    s.settimeout(timeout)
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

info = eval_js("""
(() => {
    const p = window.vkApp ? window.vkApp.player : null;
    const v = p ? p.video : null;
    const h = p ? p.hls : null;
    const active = document.activeElement;
    
    let hlsLevelInfo = null;
    if (h && h.levels && h.currentLevel >= 0) {
        const lvl = h.levels[h.currentLevel];
        hlsLevelInfo = {
            currentLevel: h.currentLevel,
            width: lvl ? lvl.width : null,
            height: lvl ? lvl.height : null,
            bitrate: lvl ? lvl.bitrate : null,
            codec: lvl ? lvl.codecSet : null,
            videoCodec: lvl ? lvl.videoCodec : null,
            audioCodec: lvl ? lvl.audioCodec : null,
            totalLevels: h.levels.length,
            allLevels: h.levels.map((l, i) => ({ i: i, w: l.width, h: l.height, bitrate: l.bitrate, vcodec: l.videoCodec }))
        };
    }
    
    // Check video element dropped frames if available
    let droppedFrames = null;
    if (v && v.getVideoPlaybackQuality) {
        const q = v.getVideoPlaybackQuality();
        droppedFrames = {
            total: q.totalVideoFrames,
            dropped: q.droppedVideoFrames,
            corrupted: q.corruptedVideoFrames
        };
    } else if (v && v.webkitDecodedFrameCount !== undefined) {
        droppedFrames = {
            decoded: v.webkitDecodedFrameCount,
            dropped: v.webkitDroppedFrameCount
        };
    }
    
    return {
        isPlayerVisible: p ? p.container.style.display !== 'none' : false,
        osdVisible: p ? p.osd.classList.contains('visible') : false,
        focusedElement: active ? {
            tag: active.tagName,
            id: active.id,
            className: active.className
        } : null,
        videoState: v ? {
            paused: v.paused,
            currentTime: v.currentTime,
            duration: v.duration,
            readyState: v.readyState,
            playbackRate: v.playbackRate,
            videoWidth: v.videoWidth,
            videoHeight: v.videoHeight,
            currentSrc: v.currentSrc
        } : null,
        hlsLevelInfo: hlsLevelInfo,
        droppedFrames: droppedFrames
    };
})()
""", 901)

print("Current live playback & player status on TV:")
print(json.dumps(info, indent=2, ensure_ascii=False))
s.close()

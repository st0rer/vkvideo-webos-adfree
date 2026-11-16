import socket
import base64
import os
import json
import time
import urllib.request

# 1. Connect to Chrome DevTools on TV
pages = json.loads(urllib.request.urlopen('http://192.168.1.199:9998/json').read().decode('utf-8'))
ws_url = None
for p in pages:
    if 'vkvideo' in p.get('url', ''):
        ws_url = p.get('webSocketDebuggerUrl')
        break

if not ws_url:
    print("Could not find vkvideo page in devtools")
    exit(1)

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

def eval_js(expr, req_id):
    send_ws({'id': req_id, 'method': 'Runtime.evaluate', 'params': {'expression': expr, 'returnByValue': True, 'awaitPromise': True}})

send_ws({'id': 1, 'method': 'Console.enable'})
send_ws({'id': 2, 'method': 'Runtime.enable'})

# Click first video card to trigger playback
trigger_script = """
(() => {
    const card = document.querySelector('.video-card');
    if (!card) return 'NO_CARD_FOUND';
    const vidId = card.dataset.id;
    console.log('[Test] Triggering playback for video:', vidId);
    card.click();
    return { id: vidId, title: card.querySelector('.card-title') ? card.querySelector('.card-title').textContent : 'Unknown' };
})()
"""

eval_js(trigger_script, 10)

# Listen for console logs and monitor player for 8 seconds
print("Waiting for playback initiation...")
start_time = time.time()
s.settimeout(1.0)
while time.time() - start_time < 8.0:
    try:
        data = s.recv(16384)
        if not data: break
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
                if msg.get('method') == 'Console.messageAdded':
                    print("[TV CONSOLE]:", msg['params']['message']['text'])
                elif 'result' in msg and 'result' in msg['result']:
                    print(f"[EVAL RESULT {msg.get('id')}]:", msg['result']['result'].get('value'))
            except:
                pass
    except socket.timeout:
        pass

# Check player state
status_script = """
(() => {
    const v = document.getElementById('native-player');
    const pContainer = document.getElementById('player-container');
    const player = window.vkApp ? window.vkApp.player : null;
    return {
        containerVisible: pContainer ? pContainer.style.display !== 'none' : false,
        videoSrc: v ? (v.src || 'HLS_STREAM') : null,
        paused: v ? v.paused : null,
        currentTime: v ? v.currentTime : null,
        duration: v ? v.duration : null,
        readyState: v ? v.readyState : null,
        videoWidth: v ? v.videoWidth : null,
        videoHeight: v ? v.videoHeight : null,
        hlsLevels: player && player.hls ? player.hls.levels.length : 0,
        currentQuality: player ? player.qualityBadgeEl.textContent : null,
        isPlaying: player ? player.isPlaying : false
    };
})()
"""

eval_js(status_script, 20)

time.sleep(1.0)
try:
    data = s.recv(16384)
    idx = 0
    while idx < len(data):
        if idx + 2 > len(data): break
        payload_len = data[idx+1] & 0x7f
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
            if msg.get('id') == 20:
                print("\n=== PLAYER REAL-TIME STATUS ON TV ===")
                print(json.dumps(msg['result']['result'].get('value'), indent=2, ensure_ascii=False))
        except:
            pass
except:
    pass

s.close()

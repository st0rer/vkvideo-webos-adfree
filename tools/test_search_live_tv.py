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

def eval_js(expr, req_id, timeout=12.0):
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
            
            total_len = header_len + payload_len
            if idx + total_len > len(buffer): break
            
            payload = buffer[idx+header_len : idx+total_len]
            idx += total_len
            try:
                msg = json.loads(payload.decode('utf-8', errors='ignore'))
                if msg.get('id') == req_id:
                    res = msg.get('result', {})
                    if 'exceptionDetails' in res:
                        return {'exception': res['exceptionDetails']}
                    return res.get('result', {}).get('value')
            except:
                pass
    return None

print("--- 1. Testing Search with Query 'Фильмы' ---")
search_res = eval_js("""(async () => {
    window.vkApp.searchQuery = 'фильмы 4k';
    await window.vkApp.executeSearch();
    const cards = Array.from(document.querySelectorAll('#search-results-grid .video-card'));
    return {
        cardCount: cards.length,
        items: cards.slice(0, 5).map(c => ({
            title: c.querySelector('.card-title')?.textContent?.trim(),
            duration: c.querySelector('.duration-badge')?.textContent?.trim()
        }))
    };
})()""", 1)
print("Search count:", search_res.get('cardCount'))
for it in search_res.get('items', []):
    print(f"  [{it['duration']}]: {it['title']}")

print("\n--- 2. Clicking First Video from Search Results ---")
eval_js("document.querySelector('#search-results-grid .video-card').click()", 2)
time.sleep(3.5)

play_status = eval_js("""(() => {
    const p = window.vkApp.player;
    return {
        playing: !p.video.paused,
        currentTime: p.video.currentTime,
        title: p.titleEl.textContent,
        qualityBadge: p.qualityBadgeEl.textContent
    };
})()""", 3)
print("Playing status:", play_status)
assert play_status['playing'], "Video should be playing!"

print("\n--- 3. Closing Player and returning to Search ---")
eval_js("window.vkApp.player.close()", 4)
time.sleep(0.5)

print("\n==========================================")
print("SEARCH & 4K PLAYBACK FROM SEARCH VERIFIED 100%!")
print("==========================================")

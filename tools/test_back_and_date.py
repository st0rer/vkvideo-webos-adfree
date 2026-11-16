import socket, base64, os, json, urllib.request, time, sys

sys.stdout.reconfigure(encoding='utf-8')

pages = json.loads(urllib.request.urlopen('http://192.168.1.199:9998/json').read().decode('utf-8'))
ws_url = None
for p in pages:
    if 'vkvideo' in p.get('url', ''):
        ws_url = p.get('webSocketDebuggerUrl')
        break

if not ws_url and pages:
    ws_url = pages[0].get('webSocketDebuggerUrl')

print(f"Connecting to CDP: {ws_url}")
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
    l = len(raw)
    h = bytearray([0x81])
    if l <= 125: h.append(0x80 | l)
    elif l <= 65535: h.append(0x80 | 126); h.extend(l.to_bytes(2, 'big'))
    m = os.urandom(4); h.extend(m)
    s.sendall(h + bytearray([b ^ m[i % 4] for i, b in enumerate(raw)]))

def recv_frame():
    hdr = s.recv(2)
    if not hdr: return None
    payload_len = hdr[1] & 0x7f
    if payload_len == 126:
        ext = s.recv(2)
        payload_len = int.from_bytes(ext, 'big')
    elif payload_len == 127:
        ext = s.recv(8)
        payload_len = int.from_bytes(ext, 'big')
    data = bytearray()
    while len(data) < payload_len:
        chunk = s.recv(min(4096, payload_len - len(data)))
        if not chunk: break
        data.extend(chunk)
    return data.decode('utf-8', errors='ignore')

msg_id = 0
def eval_js(expression):
    global msg_id
    msg_id += 1
    req = {
        "id": msg_id,
        "method": "Runtime.evaluate",
        "params": {
            "expression": expression,
            "returnByValue": True,
            "awaitPromise": True
        }
    }
    send_ws(req)
    while True:
        frame = recv_frame()
        if not frame: return None
        try:
            resp = json.loads(frame)
            if resp.get("id") == msg_id:
                res = resp.get("result", {})
                if "exceptionDetails" in res:
                    print("JS EXCEPTION:", res["exceptionDetails"])
                return res.get("result", {}).get("value")
        except:
            pass

time.sleep(2.5)

# TEST 1: VERIFY DATE UNDER VIDEO CARDS
print("\n--- TEST 1: VERIFY PUBLISH DATE DISPLAY ---")
date_info = eval_js("""
(() => {
    const cards = Array.from(document.querySelectorAll('.video-card'));
    const samples = cards.slice(0, 5).map(c => {
        const title = c.querySelector('.card-title') ? c.querySelector('.card-title').textContent : '';
        const author = c.querySelector('.card-author') ? c.querySelector('.card-author').textContent : '';
        const views = c.querySelector('.card-meta-right span') ? c.querySelector('.card-meta-right span').textContent : '';
        const dateEl = c.querySelector('.card-date');
        const date = dateEl ? dateEl.textContent : '';
        return { title: title.slice(0, 25), author: author, views: views, date: date };
    });
    const withDate = cards.filter(c => Boolean(c.querySelector('.card-date'))).length;
    return { total: cards.length, withDate: withDate, samples: samples };
})()
""")
print(f"Date info on Home: total={date_info['total']}, withDate={date_info['withDate']}")
for s_item in date_info['samples']:
    print(f" - [{s_item['author']}] {s_item['title']}... | {s_item['views']} • {s_item['date']}")

assert date_info['withDate'] > 0, "FAIL: No publication dates found on video cards!"
print("SUCCESS: Publication dates formatted and displayed under video cards!")

# TEST 2: NAVIGATE TO CHANNEL AND TEST BACK BUTTON
print("\n--- TEST 2: BACK KEY RETURNS FROM CHANNEL TO HOME ---")
eval_js("""
(() => {
    const card = document.querySelector('.video-card');
    const id = card.dataset.id;
    const video = window.vkApp.videoMap[id];
    window.vkApp.renderChannel(video.ownerId || id.split('_')[0], video.author);
})()
""")
time.sleep(2.5)

channel_state = eval_js("""
(() => {
    return {
        isChannel: Boolean(window.vkApp.currentChannel),
        channelName: window.vkApp.currentChannel ? window.vkApp.currentChannel.channelName : null,
        backBtnExists: Boolean(document.getElementById('channel-back-btn')),
        cards: document.querySelectorAll('.video-card').length
    };
})()
""")
print(f"Channel State: {channel_state}")
assert channel_state['isChannel'] and channel_state['backBtnExists'], "FAIL: Not on channel screen!"

# Press Back Key (461 / 27)
print("Sending Back key (461)...")
send_ws({'id': 10, 'method': 'Input.dispatchKeyEvent', 'params': {'type': 'keyDown', 'keyCode': 461, 'windowsVirtualKeyCode': 461}})
send_ws({'id': 11, 'method': 'Input.dispatchKeyEvent', 'params': {'type': 'keyUp', 'keyCode': 461, 'windowsVirtualKeyCode': 461}})
time.sleep(1.5)

back_result = eval_js("""
(() => {
    const isChannel = Boolean(window.vkApp.currentChannel);
    const section = window.vkApp.currentSection;
    const title = document.querySelector('.section-title') ? document.querySelector('.section-title').textContent : '';
    const toast = document.getElementById('toast');
    const toastText = toast ? toast.textContent : '';
    const toastVisible = toast ? toast.classList.contains('show') : false;
    return {
        isChannel: isChannel,
        section: section,
        title: title,
        toastVisible: toastVisible,
        toastText: toastText
    };
})()
""")
print(f"State after Back from channel: {back_result}")
assert not back_result['isChannel'], "FAIL: Should have exited channel view!"
assert back_result['section'] == 'home', "FAIL: Should be back on home screen!"
assert not (back_result['toastVisible'] and 'выхода' in back_result['toastText']), "FAIL: Back from channel should NOT trigger exit toast!"
print("SUCCESS: Back key returned cleanly from Channel to Home!")

# TEST 3: BACK KEY ON HOME SCREEN (SHOWS EXIT TOAST)
print("\n--- TEST 3: BACK KEY ON HOME SCREEN SHOWS EXIT CONFIRMATION ---")
send_ws({'id': 12, 'method': 'Input.dispatchKeyEvent', 'params': {'type': 'keyDown', 'keyCode': 461, 'windowsVirtualKeyCode': 461}})
send_ws({'id': 13, 'method': 'Input.dispatchKeyEvent', 'params': {'type': 'keyUp', 'keyCode': 461, 'windowsVirtualKeyCode': 461}})
time.sleep(0.3)

home_back_result = eval_js("""
(() => {
    const toast = document.getElementById('toast');
    return {
        toastVisible: toast ? toast.classList.contains('show') : false,
        toastText: toast ? toast.textContent : ''
    };
})()
""")
print(f"Home Back Result: {home_back_result}")
assert home_back_result['toastVisible'] and 'выхода' in home_back_result['toastText'], "FAIL: Back on home should show exit toast!"
print("SUCCESS: Back on home prompts for exit confirmation as expected!")

print("\nALL VERIFICATIONS PASSED 100%!")
s.close()

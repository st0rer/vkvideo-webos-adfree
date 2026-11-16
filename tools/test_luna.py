import socket, base64, os, json, urllib.request, time

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
    if payload_len == 126: payload_len = int.from_bytes(s.recv(2), 'big')
    elif payload_len == 127: payload_len = int.from_bytes(s.recv(8), 'big')
    data = bytearray()
    while len(data) < payload_len:
        chunk = s.recv(min(4096, payload_len - len(data)))
        if not chunk: break
        data.extend(chunk)
    return data.decode('utf-8', errors='ignore')

def eval_js(expression):
    send_ws({
        "id": 1,
        "method": "Runtime.evaluate",
        "params": {
            "expression": expression,
            "returnByValue": True,
            "awaitPromise": True
        }
    })
    while True:
        frame = recv_frame()
        if not frame: return None
        try:
            resp = json.loads(frame)
            if resp.get("id") == 1:
                return resp.get("result", {}).get("result", {}).get("value")
        except:
            pass

res = eval_js("""
new Promise((resolve) => {
    if (!window.webOS || !window.webOS.service) {
        resolve({ error: 'No webOS.service' });
        return;
    }
    window.webOS.service.request('luna://org.webosbrew.hbchannel.service', {
        method: 'exec',
        parameters: { command: 'id' },
        onSuccess: (res) => resolve(res),
        onFailure: (err) => resolve({ error: err })
    });
})
""")
print('Service call from inside WebApp:', res)
s.close()

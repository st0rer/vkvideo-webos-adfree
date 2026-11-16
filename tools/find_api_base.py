import socket
import time

s = socket.socket()
s.connect(('192.168.1.199', 23))
s.recv(1024)

cmd = """python -c '
f = open("/media/developer/apps/usr/palm/applications/vkvideo/app.js")
text = f.read()
f.close()

for k in ["proxy.", "oauth.vk", "api.vk.com", "code_auth_token", "checkAuthCode"]:
    pos = 0
    print("=== SEARCH: " + k + " ===")
    while True:
        idx = text.find(k, pos)
        if idx == -1: break
        print(text[max(0, idx-100):idx+250])
        print("-------------------")
        pos = idx + len(k)
'
"""
s.sendall(cmd.encode('utf-8'))
time.sleep(1.5)
out = s.recv(16384).decode('utf-8', errors='ignore')
print(out)
s.close()

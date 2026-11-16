import socket
import time

s = socket.socket()
s.connect(('192.168.1.199', 23))
time.sleep(0.3)
s.recv(1024)

cmd = """python -c '
f = open("/media/developer/apps/usr/palm/applications/vkvideo/app.js")
text = f.read()
f.close()

p = 0
while True:
    i = text.find("get_auth_code", p)
    if i == -1: break
    print("MATCH AT " + str(i))
    print(text[max(0, i-250):i+350])
    p = i + 1
'
"""
s.sendall(cmd.encode('utf-8'))
time.sleep(1.0)
out = s.recv(8192).decode('utf-8', errors='ignore')
print(out)
s.close()

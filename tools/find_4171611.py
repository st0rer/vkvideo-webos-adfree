import socket
import time

s = socket.socket()
s.connect(('192.168.1.199', 23))
s.recv(1024)

cmd = """python -c '
f = open("/media/developer/apps/usr/palm/applications/vkvideo/app.js")
text = f.read()
f.close()

p = 0
while True:
    i = text.find("4171611", p)
    if i == -1: break
    print("--- 4171611 at " + str(i) + " ---")
    print(text[max(0, i-200):i+300])
    p = i + 1
'
"""
s.sendall(cmd.encode('utf-8'))
time.sleep(1.0)
out = s.recv(8192).decode('utf-8', errors='ignore')
print(out)
s.close()

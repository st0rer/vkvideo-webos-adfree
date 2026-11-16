import socket
import time

s = socket.socket()
s.connect(('192.168.1.199', 23))
s.recv(1024)

cmd = """python -c '
import re
f = open("/media/developer/apps/usr/palm/applications/vkvideo/app.js")
text = f.read()
f.close()

hosts = set(re.findall(r"https?://([a-zA-Z0-9.-]+)", text))
print("Hosts found:")
for h in sorted(hosts):
    print(" - " + h)
'
"""
s.sendall(cmd.encode('utf-8'))
time.sleep(1.0)
out = s.recv(8192).decode('utf-8', errors='ignore')
print(out)
s.close()

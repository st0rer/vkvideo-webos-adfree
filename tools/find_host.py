import socket
import time

s = socket.socket()
s.connect(('192.168.1.199', 23))
s.recv(1024)

cmd = """python -c '
f = open("/media/developer/apps/usr/palm/applications/vkvideo/app.js")
text = f.read()
f.close()

idx = text.find(".lc=")
if idx != -1:
    print(text[max(0, idx-200):idx+200])

idx2 = text.find("get_auth_code")
# find where Ij is defined and where the host is set
idx3 = text.find("function Z(")
if idx3 != -1:
    print("Z constructor:")
    print(text[idx3:idx3+300])
'
"""
s.sendall(cmd.encode('utf-8'))
time.sleep(1.0)
out = s.recv(8192).decode('utf-8', errors='ignore')
print(out)
s.close()

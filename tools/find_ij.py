import socket
import time

s = socket.socket()
s.connect(('192.168.1.199', 23))
s.recv(1024)

cmd = """python -c '
f = open("/media/developer/apps/usr/palm/applications/vkvideo/app.js")
text = f.read()
f.close()

idx = text.find("function Ij(")
if idx != -1:
    print("Found Ij:")
    print(text[idx:idx+400])

idx2 = text.find("code_auth_token")
print("Around code_auth_token:")
print(text[idx2-200:idx2+200])
'
"""
s.sendall(cmd.encode('utf-8'))
time.sleep(1.0)
out = s.recv(8192).decode('utf-8', errors='ignore')
print(out)
s.close()

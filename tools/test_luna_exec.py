import socket
import time

s = socket.socket()
s.connect(('192.168.1.199', 23))
s.recv(1024)

cmd = 'luna-send -n 1 -f luna://org.webosbrew.hbchannel.service/exec \'{"command":"nohup node /media/developer/apps/usr/palm/applications/org.webosbrew.vkvideo.adfree/server/auth_server.js >/tmp/auth_server.log 2>&1 &"}\'\n'
s.sendall(cmd.encode('utf-8'))
time.sleep(1.0)
print("Luna response:", s.recv(4096).decode('utf-8', errors='ignore'))

time.sleep(1.0)
s.sendall(b"ps aux | grep -v grep | grep auth_server\n")
time.sleep(0.5)
print("PS check:\n", s.recv(4096).decode('utf-8', errors='ignore'))

s.sendall(b"cat /tmp/auth_server.log\n")
time.sleep(0.5)
print("Log:\n", s.recv(4096).decode('utf-8', errors='ignore'))

s.close()

import socket
import sys
import time

cmd = sys.argv[1] if len(sys.argv) > 1 else "ls -la /media/developer/apps/usr/palm/applications/org.webosbrew.vkvideo.adfree"
s = socket.socket()
s.connect(('192.168.1.199', 23))
s.recv(1024)
s.sendall((cmd + '\n').encode('utf-8'))
time.sleep(1.0)
print(s.recv(8192).decode('utf-8', errors='ignore'))
s.close()

import socket
import time

s = socket.socket()
s.connect(('192.168.1.199', 23))
time.sleep(0.5)
s.recv(4096)

cmd = "grep -i 'org.webosbrew.vkvideo.adfree' /var/log/legacy-log /var/log/dbg-log | tail -n 40\n"
s.sendall(cmd.encode('utf-8'))
time.sleep(2.0)
out = s.recv(16384).decode('utf-8', errors='ignore')
print(out)
s.close()

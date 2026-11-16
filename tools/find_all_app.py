import socket
import time

s = socket.socket()
s.connect(('192.168.1.199', 23))
time.sleep(0.3)
s.recv(2048)

s.sendall(b"find / -name '*org.webosbrew.vkvideo.adfree*' 2>/dev/null\n")
time.sleep(1.5)
res = s.recv(4096).decode('utf-8', errors='ignore')
print("All app references:")
print(res)

s.close()

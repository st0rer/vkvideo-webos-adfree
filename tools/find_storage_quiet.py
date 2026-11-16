import socket
import time

s = socket.socket()
s.connect(('192.168.1.199', 23))
time.sleep(0.3)
s.recv(2048)

# Find localStorage files for the app
s.sendall(b"find /home/root /var -type f -name '*.localstorage*' -o -name '*vkvideo*' 2>/dev/null\n")
time.sleep(1.0)
res = s.recv(4096).decode('utf-8', errors='ignore')
print("Found files:")
print(res)

s.close()

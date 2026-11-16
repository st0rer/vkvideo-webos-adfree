import socket
import time

s = socket.socket()
s.connect(('192.168.1.199', 23))
time.sleep(0.3)
s.recv(2048)

s.sendall(b"find /mnt/lg/cmn_data /var /tmp -name '*leveldb*' 2>/dev/null\n")
time.sleep(1.0)
res = s.recv(4096).decode('utf-8', errors='ignore')
print("leveldb dirs:")
print(res)

s.close()

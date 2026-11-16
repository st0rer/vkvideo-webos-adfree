import socket
import time

s = socket.socket()
s.connect(('192.168.1.199', 23))
time.sleep(0.3)
s.recv(2048)

s.sendall(b"ls -la '/mnt/lg/cmn_data/var/lib/wam/Default/Local Storage/leveldb'\n")
time.sleep(1.0)
res = s.recv(4096).decode('utf-8', errors='ignore')
print("leveldb files:")
print(res)

s.close()

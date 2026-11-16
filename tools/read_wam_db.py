import socket
import time

s = socket.socket()
s.connect(('192.168.1.199', 23))
time.sleep(0.3)
s.recv(2048)

s.sendall(b"strings '/mnt/lg/cmn_data/var/lib/wam/Default/Local Storage/leveldb/'*.ldb '/mnt/lg/cmn_data/var/lib/wam/Default/Local Storage/leveldb/'*.log 2>/dev/null | grep -E 'vk_token|vk_user_info|vk_active_user_id' | head -n 20\n")
time.sleep(1.5)
res = s.recv(8192).decode('utf-8', errors='ignore')
print("VK keys in leveldb:")
print(res)

s.close()

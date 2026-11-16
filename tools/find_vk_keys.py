import socket
import time

s = socket.socket()
s.connect(('192.168.1.199', 23))
time.sleep(0.3)
s.recv(2048)

py_cmd = """python -c "
import glob

for f in glob.glob('/mnt/lg/cmn_data/var/lib/wam/Default/Local Storage/leveldb/*.ldb') + glob.glob('/mnt/lg/cmn_data/var/lib/wam/Default/Local Storage/leveldb/*.log'):
    with open(f, 'rb') as fp:
        data = fp.read()
    if b'vkvideo' in data or b'vk_' in data:
        print('Found in', f)
        # Find occurrences
        idx = 0
        while True:
            idx = data.find(b'vk_', idx)
            if idx == -1: break
            snippet = data[idx:idx+80]
            print('  key snippet:', repr(snippet[:40]))
            idx += 10
        break
"
"""
s.sendall(py_cmd.encode('utf-8'))
time.sleep(2.0)
res = s.recv(8192).decode('utf-8', errors='ignore')
print("Leveldb VK search:")
print(res)

s.close()

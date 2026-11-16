import socket
import time

s = socket.socket()
s.connect(('192.168.1.199', 23))
time.sleep(0.3)
s.recv(2048)

py_cmd = """python -c "
import glob, json

for f in glob.glob('/mnt/lg/cmn_data/var/lib/wam/Default/Local Storage/leveldb/*.ldb') + glob.glob('/mnt/lg/cmn_data/var/lib/wam/Default/Local Storage/leveldb/*.log'):
    with open(f, 'rb') as fp:
        data = fp.read()
    needle = b'vk_history_489547617'
    if needle in data:
        idx = data.find(needle)
        val_start = data.find(b'[{\\x00', idx)
        if val_start != -1 and val_start < idx + 100:
            val_end = data.find(b']\\x00', val_start)
            if val_end != -1:
                raw_u16 = data[val_start:val_end+2]
                text = raw_u16.decode('utf-16le', errors='ignore')
                print('HISTORY JSON LEN:', len(text))
                items = json.loads(text)
                print('HISTORY ITEM COUNT:', len(items))
                for it in items[:15]:
                    print(' - ', it.get('title'), '|', it.get('author'))
        break
"
"""
s.sendall(py_cmd.encode('utf-8'))
time.sleep(2.0)
res = s.recv(8192).decode('utf-8', errors='ignore')
print("Active User History on TV:")
print(res)

s.close()

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
    if b'vk_user_accounts' in data:
        idx = data.find(b'vk_user_accounts')
        sub = data[idx:idx+4000]
        # find json array
        start = sub.find(b'[{\\x00')
        if start != -1:
            end = sub.find(b']\\x00', start)
            if end != -1:
                u16 = sub[start:end+2]
                accs = json.loads(u16.decode('utf-16le', errors='ignore'))
                for a in accs:
                    print('User ID:', a.get('id'), 'Name:', a.get('name'), 'Has token:', bool(a.get('token')))
        break
"
"""
s.sendall(py_cmd.encode('utf-8'))
time.sleep(2.0)
res = s.recv(8192).decode('utf-8', errors='ignore')
print("Accounts:")
print(res)

s.close()

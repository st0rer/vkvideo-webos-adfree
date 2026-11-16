import socket
import time

s = socket.socket()
s.connect(('192.168.1.199', 23))
time.sleep(0.5)
s.recv(1024)

py_script = """import re

with open('/usr/sbin/network-input-service', 'rb') as f:
    data = f.read()

# Look for text strings near specialKey
words = re.findall(b'[A-Za-z0-9_]{3,20}', data)
keys = [w for w in words if w.isupper() or 'Key' in w or 'ENTER' in w or 'OK' in w]
print list(set(keys))[:30]
"""

s.sendall(b"cat << 'EOF' > /tmp/check_keys.py\n" + py_script.encode() + b"\nEOF\n")
time.sleep(0.5)
s.sendall(b"python /tmp/check_keys.py\n")
time.sleep(1.0)
out = s.recv(4096).decode(errors='replace')
print("Keys:\n", out)
s.close()

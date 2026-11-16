import socket
import time

s = socket.socket()
s.connect(('192.168.1.199', 23))
time.sleep(0.5)
s.recv(4096)

def run(cmd):
    print(f"\n=== CMD: {cmd} ===")
    s.sendall(cmd.encode('utf-8') + b'\n')
    time.sleep(1.5)
    out = b""
    while True:
        try:
            s.settimeout(0.5)
            c = s.recv(4096)
            if not c: break
            out += c
        except:
            break
    print(out.decode('utf-8', errors='ignore'))

run("grep -i 'CONSOLE' /var/log/legacy-log | tail -n 25")
run("grep -i 'uncaught' /var/log/legacy-log | tail -n 25")
run("grep -i 'org.webosbrew.vkvideo.adfree' /var/log/legacy-log | tail -n 25")

s.close()

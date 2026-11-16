import socket
import time
import json
import urllib.request

def run_telnet(cmd):
    s = socket.socket()
    s.settimeout(5)
    s.connect(('192.168.1.199', 23))
    time.sleep(0.3)
    s.recv(4096)
    s.sendall((cmd + '\n').encode('utf-8'))
    time.sleep(1.0)
    out = s.recv(8192).decode('utf-8', errors='ignore')
    s.close()
    return out

print("--- Step 1: Check initial auth_server processes on TV ---")
ps_out = run_telnet("ps aux | grep -v grep | grep auth_server")
print("Processes:\n", ps_out)

print("--- Step 2: Ensure port 8765 is open in iptables if blocked ---")
ipt_out = run_telnet("iptables -I INPUT -p tcp --dport 8765 -j ACCEPT; iptables -I INPUT -p tcp --dport 9998 -j ACCEPT")
print("Iptables result:\n", ipt_out)

print("--- Step 3: Trigger openQRModal via CDP ---")
# Use curl localhost on TV to inspect CDP
cdp_eval = """curl -s -X POST http://127.0.0.1:9998/json | grep -o 'ws://[^"]*' | head -n 1"""
ws_out = run_telnet(cdp_eval)
print("WS output:", ws_out)

# Call openQRModal directly using node or websocket on TV
trigger_cmd = """node -e "
const WebSocket = require('/usr/palm/applications/org.webosbrew.vkvideo.adfree/node_modules/ws') || null;
" 2>/dev/null || echo "No local ws module" """

# Let's inspect via python on TV or simple shell
print("--- Step 4: Check if webapp can launch auth_server via luna ---")
test_luna = run_telnet("luna-send -n 1 -f luna://org.webosbrew.hbchannel.service/exec '{\"command\":\"ps aux | grep auth_server\"}'")
print("Luna hbchannel test:\n", test_luna)

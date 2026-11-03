#!/usr/bin/env python3
"""Bounded stdio MCP adapter; only a private container socket is reachable."""
import json, os, selectors, socket, sys
MAX_LINE = 131072

def main():
    path = os.environ.get('TERMINAY_RUNTIME_SOCKET', '')
    token = os.environ.get('TERMINAY_RUNTIME_TOKEN', '')
    if not path.startswith('/tmp/terminay-mcp-') or not path.endswith('.sock') or len(token) != 64:
        raise ValueError('Bot runtime capability unavailable')
    with socket.socket(socket.AF_UNIX) as peer:
        peer.settimeout(10)
        peer.connect(path)
        if sys.argv[1:] in (['--check-work'], ['--check-runtime']):
            peer.sendall((json.dumps({'token': token, 'message': {'jsonrpc':'2.0','id':1,'method':'runtime/check-work' if sys.argv[1:] == ['--check-work'] else 'initialize'}})+'\n').encode())
            data = b''
            while b'\n' not in data and len(data) <= MAX_LINE:
                chunk = peer.recv(65536)
                if not chunk: raise ValueError('Bot runtime disconnected')
                data += chunk
            result = json.loads(data)
            if 'error' in result: raise ValueError('Bot runtime capability refused')
            return
        if sys.argv[1:]: raise ValueError('Invalid adapter arguments')
        peer.settimeout(None)
        selector = selectors.DefaultSelector()
        selector.register(sys.stdin.fileno(), selectors.EVENT_READ, 'input')
        selector.register(peer, selectors.EVENT_READ, 'peer')
        buffers = {'input':b'', 'peer':b''}
        while True:
            for key, _ in selector.select():
                chunk = os.read(sys.stdin.fileno(),65536) if key.data == 'input' else peer.recv(65536)
                if not chunk: return
                buffers[key.data] += chunk
                while b'\n' in buffers[key.data]:
                    line, buffers[key.data] = buffers[key.data].split(b'\n',1)
                    if len(line)>MAX_LINE: raise ValueError('MCP frame exceeds limit')
                    if not line.strip(): continue
                    if key.data == 'input':
                        message = json.loads(line)
                        peer.sendall((json.dumps({'token':token,'message':message},separators=(',',':'))+'\n').encode())
                    else:
                        sys.stdout.buffer.write(line+b'\n')
                        sys.stdout.buffer.flush()
                if len(buffers[key.data])>MAX_LINE: raise ValueError('MCP frame exceeds limit')

if __name__ == '__main__':
    try: main()
    except (OSError, ValueError, TypeError) as error:
        reason = {2: 'runtime socket is missing', 13: 'runtime socket permission denied', 61: 'runtime connection refused', 111: 'runtime connection refused'}.get(getattr(error, 'errno', None), 'runtime request failed or capability revoked')
        print('terminay-bot-mcp: '+reason,file=sys.stderr)
        sys.exit(1)

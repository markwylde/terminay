"""Launcher contract tests; fake apps keep real process and stream lifetimes."""
import importlib.machinery
import json
import os
import pathlib
import select
import signal
import socket
import stat
import subprocess
import sys
import tempfile
import time
import unittest

sys.dont_write_bytecode = True
SCRIPT = str(pathlib.Path(__file__).parent / 'bin/terminay-app')
m = importlib.machinery.SourceFileLoader('apps', SCRIPT).load_module()


class AppTests(unittest.TestCase):
    def test_validation_and_clean_environment(self):
        for value in [None, [], {}, {'app': '../gridcraft', 'args': []},
                      {'app': '-x', 'args': []}, {'app': 'gridcraft', 'args': 'x'},
                      {'app': 'gridcraft', 'args': ['\n']},
                      {'app': 'gridcraft', 'args': ['x'] * 65},
                      {'app': 'gridcraft', 'args': ['x' * 8192]}]:
            with self.assertRaises(ValueError):
                m.validate(value)
        self.assertEqual(m.validate({'app': 'gridcraft', 'args': ['$(touch /tmp/no)', '; rm x']}),
                         ('gridcraft', ['$(touch /tmp/no)', '; rm x']))
        os.environ['TERMINAY_RUNTIME_TOKEN'] = 'private'
        os.environ['CODEX_API_KEY'] = 'private'
        self.assertNotIn('CODEX_API_KEY', m.desktop_env())
        self.assertNotIn('TERMINAY_RUNTIME_TOKEN', m.desktop_env())

    def test_bounded_logs(self):
        with tempfile.TemporaryDirectory() as d:
            m.LOG_DIR = d
            for _ in range(40):
                m.append_log('fake', b'x' * 65536)
            self.assertTrue(pathlib.Path(d, 'fake.log.1').exists())
            self.assertTrue(all(p.stat().st_size <= m.MAX_LOG for p in pathlib.Path(d).iterdir()))

    def test_real_dispatch_lifetime_and_failure(self):
        with tempfile.TemporaryDirectory() as d:
            control = socket.socket(socket.AF_UNIX)
            control.bind(d + '/events')
            control.listen(8)
            control.settimeout(5)
            fake = pathlib.Path(d, 'fake-app')
            fake.write_text('#!' + sys.executable + '''
import json,os,socket,sys
s=socket.socket(socket.AF_UNIX);s.connect(os.environ['HOME']+'/events')
s.sendall((json.dumps({'pid':os.getpid(),'pgid':os.getpgrp(),'args':sys.argv[1:],'env':dict(os.environ),'stdin':sys.stdin.read()})+'\\n').encode())
s.recv(1)
print('app failure detail',flush=True)
sys.exit(7)
''')
            fake.chmod(0o755)
            code = f'''import importlib.machinery,selectors,os
m=importlib.machinery.SourceFileLoader('apps',{SCRIPT!r}).load_module()
m.SOCKET={d!r}+'/apps.sock';m.LOG_DIR={d!r}+'/logs'
env=m.desktop_env();env.update(HOME={d!r},PATH={d!r}+':'+env['PATH']);m.desktop_env=lambda:env
original=selectors.DefaultSelector
class Ready(original):
 def register(self,fileobj,events,data=None):
  result=super().register(fileobj,events,data)
  if data=='launch':print('ready',flush=True)
  return result
selectors.DefaultSelector=Ready
m.serve()
'''
            server = subprocess.Popen([sys.executable, '-c', code], stdout=subprocess.PIPE,
                                      stderr=subprocess.PIPE, start_new_session=True)
            def request(value=None, raw=None):
                with socket.socket(socket.AF_UNIX) as client:
                    client.settimeout(5)
                    client.connect(d + '/apps.sock')
                    client.sendall(raw if raw is not None else (json.dumps(value) + '\n').encode())
                    client.shutdown(socket.SHUT_WR)
                    return json.loads(client.makefile('rb').readline())
            peers = []
            try:
                self.assertEqual(server.stdout.readline(), b'ready\n')
                self.assertEqual(stat.S_IMODE(os.stat(d + '/apps.sock').st_mode), 0o600)
                self.assertIn('error', request(raw=b'x' * 8193 + b'\n'))
                self.assertIn('error', request(raw=b'not json\n'))
                self.assertIn('error', request({'app': 'missing-app-unique', 'args': []}))
                args = ['a file.xlsx', '$(touch ' + d + '/injected)', '; echo nope']
                result = request({'app': 'fake-app', 'args': args})
                self.assertIn('pid', result)
                app, _ = control.accept(); peers.append(app)
                info = json.loads(app.makefile('rb').readline())
                self.assertEqual(info['args'], args)
                self.assertEqual(info['stdin'], '')
                self.assertEqual(info['pgid'], server.pid)
                self.assertNotIn('CODEX_API_KEY', info['env'])
                self.assertNotIn('TERMINAY_RUNTIME_TOKEN', info['env'])
                self.assertFalse(pathlib.Path(d, 'injected').exists())
                # The short-lived launch client has gone; the application persists.
                os.kill(info['pid'], 0)
                app.sendall(b'x'); app.close()
                # Bounded retry after app exit in test only, to observe diagnostic output.
                log = pathlib.Path(d, 'logs/fake-app.log')
                deadline = time.monotonic() + 5
                while time.monotonic() < deadline:
                    if log.exists() and 'exited with code 7' in log.read_text():
                        break
                    time.sleep(.01)
                self.assertIn('app failure detail', log.read_text())
                self.assertIn('exited with code 7', log.read_text())
                self.assertFalse(select.select([control], [], [], .2)[0], 'app restarted itself')
                self.assertIn('pid', request({'app': 'fake-app', 'args': []}))
                app, _ = control.accept(); peers.append(app)
                info = json.loads(app.makefile('rb').readline())
                os.killpg(server.pid, signal.SIGTERM)
                server.wait(timeout=5)
                self.assertEqual(app.recv(1), b'')
            finally:
                try:
                    os.killpg(server.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                server.wait(timeout=5)
                for app in peers:
                    app.close()
                control.close()
                server.stdout.close(); server.stderr.close()


if __name__ == '__main__':
    unittest.main()

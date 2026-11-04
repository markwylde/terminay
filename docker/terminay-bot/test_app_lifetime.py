"""Run as root in a disposable, bootstrapped bot container, never a live bot.
Exercises the actual desktop service and terminay-run process groups.
"""
import importlib.machinery
import json
import os
import pathlib
import signal
import subprocess
import sys

sys.dont_write_bytecode = True
init = importlib.machinery.SourceFileLoader('init', '/usr/local/bin/terminay-init').load_module()
fixture = pathlib.Path('/usr/local/bin/terminay-app-lifetime-fixture')
fixture.write_text('''#!/usr/bin/python3
import os,signal,sys
path='/tmp/app-lifetime-'+sys.argv[1]
with open(path+'.tmp','w') as stream: stream.write(str(os.getpid()))
os.rename(path+'.tmp',path)
signal.pause()
''')
fixture.chmod(0o755)


def live(pid):
    try:
        return pathlib.Path(f'/proc/{pid}/stat').read_text().split(') ')[1].split()[0] not in ('Z', 'X')
    except FileNotFoundError:
        return False


try:
    for mode in ('complete', 'stop', 'suspend', 'timeout', 'crash'):
        sid = 'lifetime-' + mode
        command = f'terminay-app launch terminay-app-lifetime-fixture -- {mode}; sleep 300 & echo SESSION $$ $!; read finish'
        proc = subprocess.Popen(['terminay-run', sid, '--', 'bash', '-c', command],
                                stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        app = None
        try:
            assert proc.stdout.readline().startswith('Launch requested')
            tag, agent, command_pid = proc.stdout.readline().split()
            assert tag == 'SESSION'
            marker = '/tmp/app-lifetime-' + mode
            init.wait_path(marker, init.time.monotonic() + 5)
            app = int(pathlib.Path(marker).read_text())
            assert live(app) and live(int(command_pid))
            if mode == 'complete':
                proc.stdin.write('done\n'); proc.stdin.flush()
            elif mode == 'crash':
                os.kill(int(agent), signal.SIGKILL)
            else:
                # Stop, suspension, and timeout share this supervised close path.
                subprocess.run(['terminay-run', '--kill', sid], check=True, timeout=15)
            proc.wait(timeout=15)
            assert not live(int(command_pid)), (mode, 'session command survived')
            assert live(app), (mode, 'desktop application closed')
            assert not pathlib.Path('/run/terminay/sessions', sid).exists()
            print(json.dumps({'mode': mode, 'appPid': app, 'commandPid': int(command_pid),
                              'sessionCommandEnded': True, 'desktopAppSurvived': True}), flush=True)
        finally:
            if proc.poll() is None:
                subprocess.run(['terminay-run', '--kill', sid], check=True, timeout=15)
                proc.wait(timeout=15)
            proc.stdin.close(); proc.stdout.close()
            if app and live(app):
                os.kill(app, signal.SIGTERM)
finally:
    fixture.unlink()

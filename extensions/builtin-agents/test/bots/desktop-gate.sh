set -euo pipefail
export HOME=/home/bot DISPLAY=:1
mkdir -p /tmp/.X11-unix
Xvnc :1 -rfbport 5901 -SecurityTypes None -localhost yes -geometry 1440x900 -depth 24 >/tmp/x.log 2>&1 &
# A bounded X socket readiness wait; this is a one-off test, not production polling.
for i in $(seq 1 50); do [ -S /tmp/.X11-unix/X1 ] && break; sleep .1; done
terminay-desktop-session >/tmp/desktop.log 2>&1 &
terminay-browser >/tmp/browser.log 2>&1 &
timeout 45 xdotool search --sync --onlyvisible --name 'about:blank' >/dev/null
wmctrl -l
curl -fsS http://127.0.0.1:9223/terminay-desktop/health
curl -fsS http://127.0.0.1:9223/json/version
python3 - <<'PY'
import json, urllib.request
s=json.load(urllib.request.urlopen('http://127.0.0.1:9223/terminay-desktop/screenshot'))
print('screenshot:',s.keys())
PY
python3 - <<'PY'
import subprocess,os,signal,time,json
apps='photocraft vectorcraft filmcraft lightcraft pdfcraft effectcraft designcraft figcraft wordcraft soundcraft deckcraft cadcraft gridcraft'.split()
for app in apps:
    with open('/tmp/'+app+'.log','wb') as log:
        p=subprocess.Popen([app],stdout=log,stderr=log,start_new_session=True)
        try:
            window=subprocess.run(['timeout','12','xdotool','search','--sync','--onlyvisible','--pid',str(p.pid)],capture_output=True,text=True)
            if window.returncode:
                print(open('/tmp/'+app+'.log').read()[-1500:])
                raise AssertionError(app+' did not open a window')
            print(app+': rendered window '+window.stdout.strip())
        finally:
            try: os.killpg(p.pid,signal.SIGTERM)
            except ProcessLookupError:pass
            try:p.wait(timeout=5)
            except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait()
PY

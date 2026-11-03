"""Host-only framing fixture. It does not test container account ownership.

CI's unit-test host can be root without a bot account. Root fixtures provide a
synthetic positive owner and suppress chown; real container CI uses the shipped
relay directly and asserts actual UID/GID and mode with no monkeypatches.
"""
import os
import pwd
import runpy
from pathlib import Path
from types import SimpleNamespace

if os.geteuid() == 0:
    lookup = pwd.getpwnam
    def fixture_account(name):
        if name == 'bot':
            return SimpleNamespace(pw_uid=1000, pw_gid=1000)
        return lookup(name)
    pwd.getpwnam = fixture_account
    os.chown = lambda *_: None

relay = Path(__file__).resolve().parents[4] / 'docker/terminay-bot/bin/terminay-mcp-relay'
runpy.run_path(str(relay), run_name='__main__')

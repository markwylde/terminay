#!/usr/bin/env python3
"""Install a seccomp filter that refuses IP sockets, then exec the command.
Needs no privilege and no user namespace (sets no_new_privs)."""
import errno
import os
import socket
import sys

import seccomp

f = seccomp.SyscallFilter(defaction=seccomp.ALLOW)
for family in (socket.AF_INET, socket.AF_INET6):
    f.add_rule(seccomp.ERRNO(errno.EACCES), "socket", seccomp.Arg(0, seccomp.EQ, family))
f.load()
os.execv(sys.argv[1], sys.argv[1:])

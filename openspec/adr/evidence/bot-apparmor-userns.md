# Bot browser sandbox under AppArmor

Evidence for ADR-0119. Recorded 2026-11-14.

## Host

| | |
| --- | --- |
| OS | Debian 13 |
| Kernel | 6.12.90+deb13.1-cloud-amd64 |
| AppArmor | parser 4.1.0, user namespaces mediated |
| Docker | 26.1.5+dfsg1, `/info` SecurityOptions include `name=apparmor` |
| Image | `terminay-bot:local` built from `docker/terminay-bot` |

The bot seccomp profile below is `BOT_BROWSER_SECCOMP` from
`packages/server-core/src/botService/browserSandbox.ts`, written to
`seccomp.json`. Every command is bounded with `timeout`.

## Before: Docker's default profile

```text
$ docker run --rm --pull never --network none --user bot \
    --security-opt seccomp=seccomp.json \
    --entrypoint unshare terminay-bot:local -Ur id
unshare: unshare failed: Permission denied
exit=1
```

Chromium in the same container aborts with
`FATAL:sandbox/linux/services/credentials.cc:137 Check failed: Permission denied (13)`
(reported by a bot on this host before the change).

## Install

Built CLI, as root:

```text
$ sudo node apps/terminay-cli/dist/cli.js daemon host-setup
Installed the terminay-bot AppArmor profile, so bot browsers can start their sandbox.
exit 0
$ ls -l /etc/apparmor.d/terminay-bot
-rw-r--r-- 1 root root 1978 Nov 14 13:42 /etc/apparmor.d/terminay-bot
$ sudo grep -c terminay-bot /sys/kernel/security/apparmor/profiles
1
```

## After: `terminay-bot`

The server's second probe:

```text
$ docker run --rm --pull never --network none --user bot \
    --security-opt seccomp=seccomp.json \
    --security-opt apparmor=terminay-bot \
    --entrypoint unshare terminay-bot:local -Ur id
uid=0(root) gid=0(root) groups=0(root)
exit=0
```

Sandboxed headless Chromium (no sandbox flags) in a container with the same
options, rendering `data:text/html,<h1>sandboxed</h1>`:

```text
$ docker inspect -f '{{.AppArmorProfile}}' terminay-apparmor-evidence
terminay-bot
pid1 label: terminay-bot (enforce)
pid1 userns: user:[4026531837]
renderer 99 userns: user:[4026532590] Seccomp: 2
renderer 110 userns: user:[4026532590] Seccomp: 2
renderer 142 userns: user:[4026532590] Seccomp: 2
--- chromium log
(no FATAL or sandbox errors)
--- DOM
"title": "data:text/html,&lt;h1&gt;sandboxed&lt;/h1&gt;"
```

Every renderer runs in its own user namespace, distinct from the container's,
under seccomp filter mode 2: Chromium's namespace sandbox is up.

Confinement stays in place, as root in the container:

```text
$ docker exec -u root terminay-apparmor-evidence sh -c 'echo h > /proc/sysrq-trigger'
sh: 1: cannot create /proc/sysrq-trigger: Read-only file system
exit=2
```

## Not tried

`apparmor=unconfined`, `--no-sandbox`, and `CAP_SYS_ADMIN` (for the setuid
`chrome-sandbox`) were rejected without measurement: each removes a protection.

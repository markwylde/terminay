# Terminay bot image. Built locally by the Terminay server (`terminay-bot:local`);
# never pulled from a registry. The server appends a generated agents layer.
FROM docker.io/library/node:26.13.0-trixie-slim

ARG BOT_UID=1000
ARG BOT_GID=1000

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    DISPLAY=:1

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl git jq ripgrep python3 inotify-tools procps less openssh-client \
      tigervnc-standalone-server tigervnc-tools xfwm4 xfce4-panel xfce4-settings xfce4-terminal xfdesktop4 x11-xserver-utils x11-apps dbus-x11 fonts-dejavu-core fonts-noto-color-emoji adwaita-icon-theme \
      chromium chromium-sandbox docker-cli docker-compose xdotool wmctrl scrot \
 && rm -rf /var/lib/apt/lists/*

# Keep the large application layer independent of runtime helper changes.
COPY bin/terminay-artcraft-install /usr/local/bin/
RUN chmod 0755 /usr/local/bin/terminay-artcraft-install \
 && /usr/local/bin/terminay-artcraft-install \
 && npm install -g chrome-devtools-mcp@1.1.1 \
 && rm -rf /var/lib/apt/lists/*

# Replace the base image's `node` user with `bot`, at the server account's ids.
RUN userdel -r node 2>/dev/null || true \
 && (getent group "${BOT_GID}" >/dev/null || groupadd -g "${BOT_GID}" bot) \
 && useradd -m -d /home/bot -s /bin/bash -u "${BOT_UID}" -g "${BOT_GID}" bot \
 && mkdir -p /home/bot/memories \
 && chown -R "${BOT_UID}:${BOT_GID}" /home/bot

RUN mkdir -m 0700 /run/terminay-engine
COPY bin/terminay-shell-env bin/terminay-bot-mcp bin/terminay-mcp-relay bin/terminay-browser bin/terminay-init bin/terminay-run bin/terminay-files bin/terminay-tool-shell bin/terminay-engine-proxy.mjs /usr/local/bin/
RUN chmod 0755 /usr/local/bin/terminay-shell-env /usr/local/bin/terminay-bot-mcp /usr/local/bin/terminay-mcp-relay /usr/local/bin/terminay-browser /usr/local/bin/terminay-init /usr/local/bin/terminay-run /usr/local/bin/terminay-files /usr/local/bin/terminay-tool-shell /usr/local/bin/terminay-engine-proxy.mjs

COPY bin/terminay-desktop-session bin/terminay-desktop-control.py bin/terminay-desktop-mcp.mjs /usr/local/bin/
RUN chmod 0755 /usr/local/bin/terminay-desktop*
RUN mkdir -p /etc/chromium/policies/managed \
 && printf '%s\n' '{"DownloadDirectory":"/home/bot/Downloads","PromptForDownloadLocation":false,"DefaultBrowserSettingEnabled":false}' > /etc/chromium/policies/managed/terminay.json

WORKDIR /home/bot
ENTRYPOINT ["/usr/local/bin/terminay-init"]

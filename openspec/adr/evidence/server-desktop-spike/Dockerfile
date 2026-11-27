ARG BASE=docker.io/library/debian:trixie-slim
FROM ${BASE}
ENV DEBIAN_FRONTEND=noninteractive
# Test tooling only. The desktop package set itself is installed at run time
# so the spike can measure what installing it changes.
RUN apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends \
      systemd systemd-sysv sudo procps iproute2 util-linux ca-certificates \
      python3 python3-pycryptodome python3-seccomp \
      xdotool xinput xclip x11-utils xterm x11-apps \
 && rm -rf /var/lib/apt/lists/*
RUN useradd -m -d /var/lib/terminay -s /bin/bash terminay \
 && useradd -m -s /bin/bash other \
 && printf 'terminay ALL=(ALL:ALL) NOPASSWD:ALL\n' > /etc/sudoers.d/terminay \
 && chmod 0440 /etc/sudoers.d/terminay
COPY spike/ /spike/
RUN chmod 0755 /spike/*.sh /spike/*.py
CMD ["/lib/systemd/systemd"]

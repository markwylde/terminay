FROM alpine:3.22
RUN apk add --no-cache openssh-server && \
    adduser -D -s /bin/sh terminay && echo 'terminay:secret-pass' | chpasswd && \
    mkdir -p /run/sshd /home/terminay/project && chown -R terminay:terminay /home/terminay && \
    ssh-keygen -A && \
    printf '#!/bin/sh\nprintf "%%s %%s\\n" "$1" "$2"\n' > /usr/local/bin/accept-fixture-key && \
    chmod 755 /usr/local/bin/accept-fixture-key && \
    printf '%s\n' 'PasswordAuthentication yes' 'PermitRootLogin no' 'AllowUsers terminay' \
      'AuthorizedKeysCommand /usr/local/bin/accept-fixture-key %t %k' \
      'AuthorizedKeysCommandUser nobody' >> /etc/ssh/sshd_config
EXPOSE 22
CMD ["/usr/sbin/sshd", "-D", "-e"]

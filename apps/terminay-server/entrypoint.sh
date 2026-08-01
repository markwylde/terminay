#!/bin/sh
set -eu

umask 077
data_root=${TERMINAY_DATA_ROOT:-/var/lib/terminay}
case "$data_root" in
  /*) ;;
  *) echo "TERMINAY_DATA_ROOT must be an absolute path in the container" >&2; exit 78 ;;
esac

if [ ! -d "$data_root" ]; then
  mkdir -p "$data_root"
fi
if [ ! -w "$data_root" ]; then
  echo "Terminay data root is not writable: $data_root" >&2
  exit 78
fi

export TERMINAY_DATA_ROOT="$data_root"
exec node /opt/terminay/apps/terminay-server/dist/cli.js "$@"

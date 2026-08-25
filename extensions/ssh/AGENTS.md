# AGENTS — Terminay SSH extension

- This repository is a public Terminay server extension. Import only the public
  `@terminay/extension-api`; never import Terminay server internals.
- Keep SSH credentials and transports in the selected Terminay Server process.
- Use structured SSH/SFTP APIs. Never construct local `ssh` shell commands.
- Host-key verification is strict by default and every bypass is profile-local.

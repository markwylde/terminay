import type { DeclarativeForm } from "@terminay/extension-api";

export const profileForm: DeclarativeForm = {
  id: "ssh-profile", title: "Add SSH server", description: "The selected Terminay Server makes this connection and owns its credentials.", submitLabel: "Test and save",
  sections: [
    { id: "server", title: "Server", disclosure: "always", fields: [
      { id: "display-name", type: "text", label: "Display name", required: true, maxLength: 100 },
      { id: "hostname", type: "text", label: "Hostname", required: true, maxLength: 253 },
      { id: "port", type: "number", label: "Port", required: true, minimum: 1, maximum: 65535 },
      { id: "username", type: "text", label: "Username", required: true, maxLength: 64 }
    ] },
    { id: "authentication", title: "Authentication", disclosure: "always", fields: [
      { id: "auth-mode", type: "select", label: "Authentication", required: true, options: [
        { value: "agent", label: "SSH agent", description: "Uses the selected Terminay Server's scoped signing broker; no agent socket is exposed to this extension." },
        { value: "private-key", label: "Private key" }, { value: "password", label: "Password", description: "Guarded fallback." }
      ] },
      { id: "private-key", type: "secret", label: "Private key", required: true, visibleWhen: { fieldId: "auth-mode", equals: "private-key" } },
      { id: "passphrase", type: "secret", label: "Key passphrase", visibleWhen: { fieldId: "auth-mode", equals: "private-key" } },
      { id: "password", type: "secret", label: "Password", required: true, visibleWhen: { fieldId: "auth-mode", equals: "password" } }
    ] },
    { id: "workspace", title: "Workspace", disclosure: "always", fields: [
      { id: "default-root", type: "text", label: "Default project root", description: "Use ~ for the remote account home.", required: true, maxLength: 4096 }
    ] },
    { id: "security", title: "Host verification", description: "Strict verification is strongly recommended.", disclosure: "expanded", fields: [
      { id: "unsafe-host-verification", type: "checkbox", label: "Disable host key verification (unsafe)", description: "Requires a separate confirmation and permission." }
    ] },
    { id: "advanced", title: "Advanced", disclosure: "collapsed", fields: [
      { id: "connect-ms", type: "number", label: "Connect timeout (ms)", minimum: 1000, maximum: 120000 },
      { id: "handshake-ms", type: "number", label: "Handshake timeout (ms)", minimum: 1000, maximum: 120000 },
      { id: "keepalive-ms", type: "number", label: "Keepalive interval (ms)", minimum: 1000, maximum: 120000 }
    ] }
  ]
};

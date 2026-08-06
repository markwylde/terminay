# Release credential bootstrap

Release credentials are operator-managed inputs. They must never be printed to
terminal output, committed to the repository, or copied through a CI log.

## Apple release credentials

The macOS release uses a `Developer ID Application` certificate whose private
key is held in the operator's login Keychain. `MACOS_CERTIFICATE_P12` is the
single-line base64 encoding of a password-protected PKCS#12 export of that
identity. `MACOS_CERTIFICATE_PASSWORD` is the newly generated password for that
export; it is not an Apple account password.

`APPLE_APP_SPECIFIC_PASSWORD` is generated and revoked through the Apple
account used by `APPLE_ID`. It is not recovered from the signing certificate.
The release operator stores it directly as a repository secret.

Apple signing and notarization require a trusted macOS runner. Copying these
credentials to a repository with Linux-only runners does not make the macOS
release job portable.

## Terminay artifact signing key

`TERMINAY_RELEASE_SIGNING_PRIVATE_KEY_B64` is a base64-encoded PKCS#8 PEM
Ed25519 private key. It is independent of Apple code signing. Its matching
SPKI PEM public key is stored as
`TERMINAY_RELEASE_SIGNING_PUBLIC_KEY_B64`.

Repository secrets are write-only. If the original private key is no longer
available from operator custody, it cannot be recovered from GitHub or Gitea.
The operator must explicitly rotate the keypair and update the private secret
and public variable together before publishing another release. Rotation is a
trust-boundary operation and must not happen implicitly.

## Local preparation helper

Run the helper from a trusted macOS account:

```sh
npm run release:prepare-credentials -- macos \
  --output-dir "$HOME/Desktop/terminay-release-credentials" \
  --identity "Developer ID Application: Puzed Ltd (P3J23J5CWT)" \
  --rotate-release-key
```

To preserve an existing release key, replace `--rotate-release-key` with
`--release-private-key /protected/path/release-private-key.pem`. The helper
creates a new mode-`0700` directory containing mode-`0600` files named after
the repository secret or variable they supply. It reports filenames and a
public-key fingerprint only; it never prints credential values.

After saving each value in the repository settings, securely delete the local
output directory. The helper does not upload secrets or configure a runner.

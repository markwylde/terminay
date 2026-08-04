import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { X509Certificate } from 'node:crypto'
import selfsigned from 'selfsigned'
import type { ResolvedRemoteAccessConfig } from './config'

type TlsPaths = {
  certPath: string
  keyPath: string
}

function getDefaultTlsPaths(remoteDir: string): TlsPaths {
  const certDir = path.join(remoteDir, 'certs')
  return {
    certPath: path.join(certDir, 'selfsigned-cert.pem'),
    keyPath: path.join(certDir, 'selfsigned-key.pem'),
  }
}

function collectAltNames(config: ResolvedRemoteAccessConfig): Array<{ ip?: string; type: 2 | 7; value?: string }> {
  const altNames = new Map<string, { ip?: string; type: 2 | 7; value?: string }>()

  const addDns = (value: string): void => {
    const trimmed = value.trim()
    if (!trimmed) {
      return
    }

    altNames.set(`dns:${trimmed}`, { type: 2, value: trimmed })
  }

  const addIp = (ip: string): void => {
    const trimmed = ip.trim()
    if (!trimmed) {
      return
    }

    altNames.set(`ip:${trimmed}`, { ip: trimmed, type: 7 })
  }

  addDns(config.host)
  addDns('localhost')
  addIp('127.0.0.1')
  addIp('::1')

  if (config.bindAddress === '0.0.0.0' || config.bindAddress === '::') {
    for (const netInterface of Object.values(os.networkInterfaces())) {
      for (const addr of netInterface ?? []) {
        if (addr.internal) {
          continue
        }

        if (addr.family === 'IPv4' || addr.family === 'IPv6') {
          addIp(addr.address)
        }
      }
    }
  } else if (config.bindAddress.includes(':')) {
    addIp(config.bindAddress)
  } else {
    addIp(config.bindAddress)
  }

  return Array.from(altNames.values())
}

function certificateNeedsRefresh(cert: Buffer, config: ResolvedRemoteAccessConfig): boolean {
  try {
    const parsed = new X509Certificate(cert)
    const subjectAltName = parsed.subjectAltName ?? ''

    for (const altName of collectAltNames(config)) {
      const expected = altName.type === 2 ? `DNS:${altName.value}` : `IP Address:${altName.ip}`
      if (!subjectAltName.includes(expected)) {
        return true
      }
    }

    return false
  } catch {
    return true
  }
}

async function generateSelfSignedCertificate(
  config: ResolvedRemoteAccessConfig,
  certPath: string,
  keyPath: string,
): Promise<void> {
  await fs.mkdir(path.dirname(certPath), { recursive: true })
  await fs.mkdir(path.dirname(keyPath), { recursive: true })
  const altNames = collectAltNames(config)

  const generated = await selfsigned.generate(
    [{ name: 'commonName', value: config.host }],
    {
      algorithm: 'sha256',
      extensions: [
        {
          name: 'basicConstraints',
          cA: false,
        },
        {
          name: 'keyUsage',
          dataEncipherment: true,
          digitalSignature: true,
          keyEncipherment: true,
        },
        {
          name: 'extKeyUsage',
          serverAuth: true,
        },
        {
          altNames,
          name: 'subjectAltName',
        },
      ],
      keySize: 2048,
      notAfterDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
  )

  await Promise.all([
    fs.writeFile(certPath, generated.cert, 'utf8'),
    fs.writeFile(keyPath, generated.private, 'utf8'),
  ])
}

export async function ensureTlsMaterial(
  config: ResolvedRemoteAccessConfig,
  remoteDir: string,
): Promise<{ cert: Buffer; certPath: string; isSelfSigned: boolean; key: Buffer; keyPath: string }> {
  const defaultPaths = getDefaultTlsPaths(remoteDir)
  const certPath = config.tlsCertPath || defaultPaths.certPath
  const keyPath = config.tlsKeyPath || defaultPaths.keyPath
  const shouldAutoGenerate = !config.tlsCertPath || !config.tlsKeyPath

  if (shouldAutoGenerate) {
    const [existingCert, keyExists] = await Promise.all([
      fs.readFile(certPath).catch(() => null),
      fs
        .access(keyPath)
        .then(() => true)
        .catch(() => false),
    ])

    if (!existingCert || !keyExists || certificateNeedsRefresh(existingCert, config)) {
      await generateSelfSignedCertificate(config, certPath, keyPath)
    }
  }

  try {
    const [cert, key] = await Promise.all([fs.readFile(certPath), fs.readFile(keyPath)])
    return {
      cert,
      certPath,
      isSelfSigned: shouldAutoGenerate,
      key,
      keyPath,
    }
  } catch {
    throw new Error('Terminay could not read the configured TLS certificate files.')
  }
}

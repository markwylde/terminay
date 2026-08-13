# Manifest reference (v1)

`package.json.terminay` is closed: unknown fields fail installation. One npm
package owns one immutable extension id.

| Field | Contract |
| --- | --- |
| `manifestVersion` | Integer `1`. |
| `id` | Globally unique reverse-DNS identity; never change it after release. |
| `displayName`, `description` | Bounded plain text. |
| `api` | supported Terminay Extension API SemVer range. |
| `engines.terminay`, `engines.node` | supported product and bundled Node ranges. |
| `entrypoint` | Relative regular ESM file inside the packed package. No traversal or symlink. |
| `platforms` | Optional subset of `darwin`, `linux`, `win32`. Omit for portable packages. |
| `permissions` | Exact visible capabilities requested from the host. |
| `extensionDependencies` | Other Terminay extension ids and compatible API ranges, not npm libraries. |
| `contributes.projectEnvironments` | Namespaced provider identities, plain metadata, icons, and capabilities. |

Provider ids use `<extension-id>/<local-id>`. Action, form, field, option-source,
and operation ids follow the same ownership rule where applicable. Package name
and extension id are deliberately independent.

The three version axes are independent: npm package SemVer describes that
package release, `manifestVersion` describes this JSON schema, and `api`
describes the host contract. API majors may break; minors are additive. The
server fails closed when ranges do not overlap and leaves dependent projects
visible but unavailable.

The package must contain an exact dependency lock and a production closure that
needs no lifecycle scripts, compiler, native `.node` module, `binding.gyp`, Git,
file, link, alias, or remote URL dependency. The public npmjs registry is the
only v1 installation source.

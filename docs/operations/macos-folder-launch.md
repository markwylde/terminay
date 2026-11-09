# Open a folder in Terminay on macOS

The macOS app registers as an alternate folder handler. Installation does not
change your default applications. Launch Services can open a folder with:

```sh
open -a Terminay "/Users/me/Projects/My Project"
```

To pass command-line arguments through Launch Services, use `--args`:

```sh
open -a Terminay --args --working-directory "/Users/me/Projects/My Project"
```

The executable accepts positional directory paths, local `file:` URLs,
`--working-directory PATH`, and `--working-directory=PATH`. Each operand opens a
fresh terminal, in argument order. Repeated opens reuse the project at the exact
canonical folder root, and create another terminal. Relative paths resolve
against the invoking process's working directory. For example:

```sh
/Applications/Terminay.app/Contents/MacOS/Terminay ./project
/Applications/Terminay.app/Contents/MacOS/Terminay --working-directory=./project
/Applications/Terminay.app/Contents/MacOS/Terminay -- ./-folder
```

Paths are literal data; Terminay does not evaluate shell syntax in them. Quote
spaces and metacharacters for your invoking shell. A `--` delimiter allows
literal folder operands beginning with a dash.

These forms work at startup and while the app is running. A local workspace
window presents the new terminal; remote windows keep their current server.
The requested folder takes precedence over the normal working-directory policy.
Existing terminals keep their working directories.

Unsupported options reject the whole invocation. A missing or nondirectory
operand reports an error and does not prevent later valid folders opening.
There are at most 64 outstanding requests, with paths bounded to 4096 characters.
A second process acknowledges submission; the primary app reports any later
failure in a native dialog and stderr. If a window closes before presentation,
the created terminal remains discoverable in the Local terminal list.

macOS has several terminal integration conventions, and individual apps may
maintain their own supported-terminal lists. Folder registration does not add
Terminay to those lists. This interface opens directories; it does not register
SSH/telnet URLs, run executable files, accept command strings, or replace Apple's
Terminal Services.

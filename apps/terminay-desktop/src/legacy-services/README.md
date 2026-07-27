# Legacy services quarantine

This directory is reserved for services mechanically moved from the existing
Electron host during migration. New application services must not be added.
Only `../compatibility/` may import modules from this directory.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Task 19 removes the zero-consumer broad preload API', async () => {
  const [preload, api, globals, sources] = await Promise.all([
    readFile('electron/preload.ts', 'utf8'),
    readFile('src/types/terminay.ts', 'utf8'),
    readFile('src/vite-env.d.ts', 'utf8'),
    Promise.all(['src/App.tsx', 'src/components/SettingsWindow.tsx', 'src/components/folder-viewer/FolderPanel.tsx']
      .map((path) => readFile(path, 'utf8'))).then((values) => values.join('\n')),
  ])
  const removed = [
    'deleteEntry', 'deleteSecret', 'getFileInfo', 'getFilePreviewSource',
    'getFileTextMetadata', 'getGitDiff', 'getGitRepoInfo', 'getMacros',
    'getSecrets', 'mkdir', 'readFileBytes', 'readFileText', 'readFileTextLines',
    'renameEntry', 'resetMacros', 'resetTerminalSettings', 'saveFile',
    'saveSecret', 'saveSparseFile', 'unwatchFile', 'updateMacros',
    'updateTerminalSettings', 'watchFile', 'listDirectory',
    'cancelFolderSize', 'watchDirectory', 'unwatchDirectory',
    'calculateFolderSize', 'searchFiles', 'getPathForFile', 'listAiTabMetadataModels',
    'getDictationOpenAiKeyStatus', 'saveDictationOpenAiKey',
    'clearDictationOpenAiKey', 'getDictationMicrophonePermissionStatus',
    'requestDictationMicrophonePermission', 'transcribeDictation',
    'getDecryptedSecret', 'getRemoteAccessStatus', 'toggleRemoteAccessServer',
    'revokeRemoteAccessDevice', 'closeRemoteAccessConnection',
    'setRemoteAccessPairingAddress',
  ]
  for (const operation of removed) {
    assert.doesNotMatch(sources, new RegExp(`window\\.terminay\\.${operation}\\b`, 'u'))
    assert.match(preload, new RegExp(`\\b${operation}(?:,|:)`, 'u'))
  }
  for (const operation of [
    'deleteEntry', 'deleteSecret', 'getFileInfo', 'getFilePreviewSource',
    'getFileTextMetadata', 'getGitDiff', 'getGitRepoInfo', 'getMacros',
    'getSecrets', 'mkdir', 'readFileBytes', 'readFileText', 'readFileTextLines',
    'renameEntry', 'resetMacros', 'saveFile', 'saveSparseFile', 'unwatchFile', 'watchFile',
    'resetTerminalSettings', 'saveSecret', 'updateMacros', 'updateTerminalSettings',
    'listDirectory', 'cancelFolderSize', 'watchDirectory', 'unwatchDirectory',
    'calculateFolderSize', 'searchFiles', 'getPathForFile', 'listAiTabMetadataModels',
    'getDictationOpenAiKeyStatus', 'saveDictationOpenAiKey',
    'clearDictationOpenAiKey', 'getDictationMicrophonePermissionStatus',
    'requestDictationMicrophonePermission', 'transcribeDictation',
    'getDecryptedSecret', 'getRemoteAccessStatus', 'toggleRemoteAccessServer',
    'revokeRemoteAccessDevice', 'closeRemoteAccessConnection',
    'setRemoteAccessPairingAddress',
  ]) {
    assert.doesNotMatch(api, new RegExp(`^ {2}${operation}:`, 'mu'))
  }
  for (const operation of [
    'getFileExplorerGitStatuses',
    'getWorktreePanelStatus',
    'moveGitWorktree',
    'removeGitWorktree',
    'pullGitWorktreeFromOrigin',
  ]) {
    assert.doesNotMatch(sources, new RegExp(`window\\.terminay\\.${operation}\\b`, 'u'))
    assert.doesNotMatch(preload, new RegExp(`\\b${operation}(?:,|:)`, 'u'))
    assert.doesNotMatch(api, new RegExp(`^ {2}${operation}:`, 'mu'))
  }
  assert.doesNotMatch(preload, /contextBridge\.exposeInMainWorld\('terminay'/u)
  assert.doesNotMatch(preload, /\bpublicTerminayApi\b/u)
  assert.doesNotMatch(api, /\bTerminayApi\b/u)
  assert.doesNotMatch(globals, /^\s*terminay:/mu)
})

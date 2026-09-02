## MODIFIED Requirements

### Requirement: Single connection generation per mounted workspace

The stable session origin SHALL own one WebRTC connection generation for its mounted workspace. Network loss SHALL keep server-owned PTYs and work running. The browser SHALL show reconnecting state, create a fresh authenticated generation, restore subscriptions, and enable input only after hydration completes. The session host SHALL create one generation per connect attempt, shared by pairing or saved-device signaling, bundle install, and the workspace's application `connect`. The workspace SHALL NOT start a second signaling join, peer, or ticket for the same attempt. A `closed` event from a retired generation SHALL NOT start a parallel connect. Automatic recovery, **Retry connection**, document resume, and the initial connect SHALL share one in-flight attempt.

#### Scenario: Input stays disabled until hydration

- **WHEN** a replacement generation is still hydrating
- **THEN** reconnecting state is shown and terminal input remains disabled

#### Scenario: Retired generation cannot fork a connect

- **WHEN** a retired generation emits `closed`
- **THEN** no parallel connect attempt starts

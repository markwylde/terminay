/// <reference types="vite/client" />

import type { TerminayApi, TerminayTestApi } from './types/terminay'

declare global {
  interface Window {
    terminay: TerminayApi
    terminayTest?: TerminayTestApi
    __TERMINAY_REMOTE_WEBRTC__?: {
      managerUrl?: string
    }
  }
}

export {}

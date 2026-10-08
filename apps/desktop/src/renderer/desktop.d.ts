import type { EngineeringBridge } from '@follo/shared';

declare global {
  interface Window {
    // Available in Electron through preload.ts; a plain browser has no desktop bridge.
    engineering?: EngineeringBridge;
  }
}

import type { Category } from '@traffic-room/shared';

export const tokens = {
  asphalt: '#0C131D',
  panel: '#111B28',
  line: '#1D2A3A',
  ink: '#DCE4EE',
  mute: '#7C8A9B',
  flow: '#2BD47D',
  slow: '#F5B83D',
  jam: '#FF4D4F',
  info: '#5AA9FF',
  construction: '#4B5D74',
  report: '#7C8A9B',
} as const;

export function categoryColor(c: Category): string {
  switch (c) {
    case 'accident': return tokens.jam;
    case 'breakdown': return tokens.slow;
    case 'weather': return tokens.info;
    case 'construction': return tokens.construction;
    case 'report': return tokens.report;
    default: return tokens.mute;
  }
}

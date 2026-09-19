// Canvas color themes.
// The canvas can't read CSS custom properties, so these live in JS and are kept
// in sync with the matching :root[data-theme] blocks in index.css by hand.

export const THEMES = {
  dark: {
    canvasBg: '#0A0E17',
    rulerText: '#8892B0',
    rulerTick: '#4A5568',
    selection: 'rgba(66, 135, 245, 0.35)',
    cursor: '#FFFFFF',
    gapBg: '#161B26',
    gapText: '#4A5568',
    nameText: '#8892B0',
    nameTextActive: '#E2E8F0',
    gutterBg: '#0F1524',
    gutterBorder: '#1A3A5C',
    activeRowBg: 'rgba(66, 135, 245, 0.12)',
    dropMarker: '#4285F5',
    dirtyMarker: '#E67E22',
    consensusBg: '#0F1524',
    consensusBorder: '#4A7FC1', // thick rule separating the consensus from the rows
    agreementText: '#5F6B80', // greyed-out base that matches the consensus/reference
    rowNumber: '#5A6478',
    columnCursor: '#FF9F45',
    selectedRowBg: 'rgba(66, 135, 245, 0.30)',
    selectedRowBar: '#4285F5',
    selectedRowOverlay: 'rgba(66, 135, 245, 0.28)',
  },
  light: {
    canvasBg: '#FFFFFF',
    rulerText: '#8A94A6',
    rulerTick: '#C3C9D4',
    selection: 'rgba(45, 127, 249, 0.18)',
    cursor: '#1F2933',
    gapBg: '#EDEFF3',
    gapText: '#A3ABB8',
    nameText: '#6B7684',
    nameTextActive: '#1F2933',
    gutterBg: '#F7F8FA',
    gutterBorder: '#E1E4E8',
    activeRowBg: 'rgba(45, 127, 249, 0.08)',
    dropMarker: '#2D7FF9',
    dirtyMarker: '#D97706',
    consensusBg: '#F0F2F5',
    consensusBorder: '#8A94A6',
    agreementText: '#AEB6C2',
    rowNumber: '#A3ABB8',
    columnCursor: '#E8590C',
    selectedRowBg: 'rgba(45, 127, 249, 0.22)',
    selectedRowBar: '#2D7FF9',
    selectedRowOverlay: 'rgba(45, 127, 249, 0.22)',
  },
};

export const DEFAULT_THEME = 'dark';

export function getTheme(name) {
  return THEMES[name] ?? THEMES[DEFAULT_THEME];
}

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
    columnSelection: 'rgba(99, 179, 237, 0.22)', // cyan tint, distinct from cursor and selection
    columnBand: 'rgba(255, 255, 255, 0.05)', // alternating 10-column banding
    matchHighlight: 'rgba(255, 214, 102, 0.30)', // search hit
    matchHighlightActive: 'rgba(255, 184, 46, 0.55)', // the hit the viewport is on
    conservationHigh: '#48BB78',
    conservationMid: '#ECC94B',
    conservationLow: '#F56565',
    minimapBg: '#0F1524',
    minimapTrack: '#4A7FC1',
    minimapViewport: 'rgba(66, 135, 245, 0.28)',
    minimapViewportBorder: '#4285F5',
    annotationText: '#E2E8F0',
    selectedRowBg: 'rgba(66, 135, 245, 0.30)',
    selectedRowBar: '#4285F5',
    selectedRowOverlay: 'rgba(66, 135, 245, 0.28)',
    // Green rather than another blue, so the reference stays legible next to the
    // blue selection and active-row tints.
    referenceNameBg: 'rgba(72, 187, 120, 0.25)',
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
    columnSelection: 'rgba(59, 153, 252, 0.18)', // cyan tint, distinct from cursor and selection
    columnBand: 'rgba(15, 23, 42, 0.05)', // alternating 10-column banding
    matchHighlight: 'rgba(250, 204, 21, 0.35)', // search hit
    matchHighlightActive: 'rgba(234, 164, 8, 0.60)', // the hit the viewport is on
    conservationHigh: '#2F9E5E',
    conservationMid: '#D8A213',
    conservationLow: '#D64545',
    minimapBg: '#F0F2F5',
    minimapTrack: '#7A93B8',
    minimapViewport: 'rgba(45, 127, 249, 0.22)',
    minimapViewportBorder: '#2D7FF9',
    annotationText: '#1F2933',
    selectedRowBg: 'rgba(45, 127, 249, 0.22)',
    selectedRowBar: '#2D7FF9',
    selectedRowOverlay: 'rgba(45, 127, 249, 0.22)',
    referenceNameBg: 'rgba(39, 174, 96, 0.18)',
  },
};

export const DEFAULT_THEME = 'dark';

export function getTheme(name) {
  return THEMES[name] ?? THEMES[DEFAULT_THEME];
}

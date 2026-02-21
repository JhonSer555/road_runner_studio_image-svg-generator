export interface ImageAsset {
  id: string;
  url: string; // The data URL for display
  base64Data: string; // The raw base64 data for the API
  mimeType: string;
}

export enum AppState {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR'
}

export interface GenerationResult {
  imageUrl?: string;
  videoUrl?: string; // New optional field for video support
  text?: string;
  provider?: string;
  error?: string;
}

export interface Letter {
  id: string;            // unique identifier
  char: string;          // character itself
  fill?: string;         // fill color (explicit only)
  stroke?: string;       // stroke color (explicit only)
  fontFamily?: string;   // font family (explicit only)
  fontSize?: string;     // font size (explicit only)
  fontWeight?: string;   // font weight (explicit only)
  fontStyle?: string;    // font style (explicit only)
  letterSpacing?: string; // letter spacing (explicit only)
  x?: number;            // absolute x position (manual words only)
  y?: number;            // absolute y position (manual words only)
  animation: {          // animation settings
    duration: number;    // seconds
    delay: number;       // seconds
    easing: string;      // easing function name
  };
}

export interface Word {
  id: string;
  letters: Letter[];
  textIndex?: number;
  textNodeId?: string;
  x?: number;
  y?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  isManual?: boolean;
  visible?: boolean;
}

export interface SvgLayer {
  id: string;
  type: 'path' | 'rect' | 'circle' | 'text' | 'image' | 'g' | 'line' | 'other';
  label: string;
  fill?: string;
  stroke?: string;
  opacity?: number;
  duration?: number;
  hasAnimate?: boolean;
  visible?: boolean;
  baseTransform?: string;
  tx?: number;
  ty?: number;
  rotation?: number;
  centerX?: number;
  centerY?: number;
  element: Element;
}

export interface TextMeasureStyle {
  fontStyle?: string;
  fontWeight?: string;
  fontSize?: string;
  fontFamily?: string;
  letterSpacing?: string;
}
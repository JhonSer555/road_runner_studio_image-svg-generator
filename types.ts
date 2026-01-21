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
  text?: string;
}
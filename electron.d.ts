declare global {
  type DesktopUpdateStage =
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'downloaded'
    | 'error';

  interface DesktopUpdateStatus {
    stage: DesktopUpdateStage;
    version?: string | null;
    percent?: number;
    transferred?: number;
    total?: number;
    message?: string;
  }

  interface DesktopUpdaterApi {
    isDesktop: boolean;
    checkForUpdates: () => Promise<{ ok: boolean; reason?: string; message?: string }>;
    quitAndInstall: () => Promise<boolean>;
    savePdf: (
      html: string,
      defaultFileName?: string
    ) => Promise<{ ok: boolean; canceled?: boolean; filePath?: string; error?: string }>;
    getAppVersion: () => Promise<string>;
    isPackaged: () => Promise<boolean>;
    onStatus: (callback: (status: DesktopUpdateStatus) => void) => () => void;
  }

  interface Window {
    desktopUpdater?: DesktopUpdaterApi;
  }
}

export {};

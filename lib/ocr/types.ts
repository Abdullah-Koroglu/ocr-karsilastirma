export type ProcessDocsState = {
  success: boolean;
  message: string;
  textReport?: string;
  summary?: {
    totalFiles: number;
    totalPages: number;
    detected: {
      ruhsatPages: number;
      uygunlukPages: number;
      ehliyetPages: number;
      unknownPages: number;
      ehliyetBackPages: number;
    };
  };
};

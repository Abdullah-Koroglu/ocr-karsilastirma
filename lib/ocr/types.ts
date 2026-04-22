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

export type DocKind = "ruhsatProforma" | "uygunlukBelgesi" | "ehliyet";

export type ExtractedFields = {
  fullName: string | null;
  tckn: string | null;
  chassisNo: string | null;
  plate: string | null;
};

export type ParsedDocument = {
  kind: DocKind;
  rawText: string;
  extracted: ExtractedFields;
};

export type ComparisonCheck = {
  id: string;
  label: string;
  leftDoc: DocKind;
  rightDoc: DocKind;
  leftValue: string | null;
  rightValue: string | null;
  status: "match" | "mismatch" | "missing";
};

export type ComparisonReport = {
  overallPassed: boolean;
  checks: ComparisonCheck[];
};

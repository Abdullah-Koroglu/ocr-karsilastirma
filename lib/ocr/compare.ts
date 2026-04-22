import "server-only";

import { normalizeForComparison } from "@/lib/ocr/parsers";
import type { ComparisonCheck, ComparisonReport, DocKind, ParsedDocument } from "@/lib/ocr/types";

function compareField(
  id: string,
  label: string,
  leftDoc: ParsedDocument,
  rightDoc: ParsedDocument,
  field: keyof ParsedDocument["extracted"],
): ComparisonCheck {
  const leftValue = leftDoc.extracted[field];
  const rightValue = rightDoc.extracted[field];

  if (!leftValue || !rightValue) {
    return {
      id,
      label,
      leftDoc: leftDoc.kind,
      rightDoc: rightDoc.kind,
      leftValue,
      rightValue,
      status: "missing",
    };
  }

  const isMatch = normalizeForComparison(leftValue) === normalizeForComparison(rightValue);

  return {
    id,
    label,
    leftDoc: leftDoc.kind,
    rightDoc: rightDoc.kind,
    leftValue,
    rightValue,
    status: isMatch ? "match" : "mismatch",
  };
}

export function buildComparisonReport(documents: Record<DocKind, ParsedDocument>): ComparisonReport {
  const checks: ComparisonCheck[] = [
    compareField(
      "name-license",
      "Ruhsat/Proforma ve Ehliyet isim-soyisim eşleşmesi",
      documents.ruhsatProforma,
      documents.ehliyet,
      "fullName",
    ),
    compareField(
      "chassis-compliance",
      "Ruhsat/Proforma ve Uygunluk Belgesi şasi no eşleşmesi",
      documents.ruhsatProforma,
      documents.uygunlukBelgesi,
      "chassisNo",
    ),
    compareField(
      "tckn-license",
      "Ruhsat/Proforma ve Ehliyet TCKN eşleşmesi",
      documents.ruhsatProforma,
      documents.ehliyet,
      "tckn",
    ),
    compareField(
      "plate-compliance",
      "Ruhsat/Proforma ve Uygunluk Belgesi plaka eşleşmesi",
      documents.ruhsatProforma,
      documents.uygunlukBelgesi,
      "plate",
    ),
  ];

  return {
    overallPassed: checks.every((check) => check.status === "match"),
    checks,
  };
}

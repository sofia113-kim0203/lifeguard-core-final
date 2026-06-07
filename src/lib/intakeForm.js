import { extractHealthDisclosure } from "./healthDisclosure.js";

function extractIntakeMeta(detailsJson) {
  const root = detailsJson && typeof detailsJson === "object" ? detailsJson : {};
  const intake = root.intake && typeof root.intake === "object" ? root.intake : {};
  return {
    address: intake.address ?? "",
    consultationPurpose: intake.consultation_purpose ?? "",
    insuranceSummary: intake.insurance_summary ?? "",
    completenessScore:
      typeof intake.completeness_score === "number" ? intake.completeness_score : null,
    lastScoredAt: intake.last_scored_at ?? null,
  };
}

export function buildIntakeFormFromRecords(profile, health, insurancePolicy) {
  const intake = extractIntakeMeta(health?.details_json);
  const disclosure = extractHealthDisclosure(health?.details_json);
  let insuranceSummary = intake.insuranceSummary;

  if (insurancePolicy) {
    const coverageSummary =
      typeof insurancePolicy.coverage_summary === "object"
        ? insurancePolicy.coverage_summary?.summary ?? ""
        : insurancePolicy.coverage_summary ?? "";
    if (coverageSummary && !insuranceSummary) {
      insuranceSummary = String(coverageSummary);
    }
  }

  return {
    displayName: profile?.display_name ?? "",
    birthDate: profile?.birth_date ?? "",
    gender: profile?.gender ?? "",
    jobCategory: profile?.job_category ?? "",
    address: intake.address,
    consultationPurpose: intake.consultationPurpose,
    insuranceSummary,
    insurerName: insurancePolicy?.insurer_name ?? "",
    productName: insurancePolicy?.product_name ?? "",
    healthDisclosure: disclosure.values,
  };
}

export function extractStoredIntakeMeta(detailsJson) {
  return extractIntakeMeta(detailsJson);
}

import { supabase } from "./supabase.js";
import {
  buildHealthDisclosurePayload,
  extractHealthDisclosure,
  INSURANCE_DISCLOSURE_VERSION,
} from "./healthDisclosure.js";
import { loadCustomerDashboardData } from "./customerDashboard.js";
import { toCustomerErrorMessage } from "./uiLocale.js";

function emptyIntakeForm() {
  return {
    displayName: "",
    birthDate: "",
    gender: "",
    jobCategory: "",
    address: "",
    consultationPurpose: "",
    insuranceSummary: "",
    insurerName: "",
    productName: "",
    healthDisclosure: extractHealthDisclosure({}).values,
  };
}

function extractIntake(detailsJson) {
  const root = detailsJson && typeof detailsJson === "object" ? detailsJson : {};
  const intake = root.intake && typeof root.intake === "object" ? root.intake : {};
  return {
    address: intake.address ?? "",
    consultationPurpose: intake.consultation_purpose ?? "",
    insuranceSummary: intake.insurance_summary ?? "",
  };
}

export function normalizeCustomerIntake({
  dashboard,
  profile,
  health,
  insurancePolicy,
  consents,
}) {
  const intake = extractIntake(health?.details_json);
  const disclosure = extractHealthDisclosure(health?.details_json);

  return {
    dashboard,
    customerId: profile?.id ?? null,
    form: {
      displayName: profile?.display_name ?? "",
      birthDate: profile?.birth_date ?? "",
      gender: profile?.gender ?? "",
      jobCategory: profile?.job_category ?? "",
      address: intake.address,
      consultationPurpose: intake.consultationPurpose,
      insuranceSummary: intake.insuranceSummary,
      insurerName: insurancePolicy?.insurer_name ?? "",
      productName: insurancePolicy?.product_name ?? "",
      healthDisclosure: disclosure.values,
    },
    healthSource: health?.source ?? null,
    insurancePolicyId: insurancePolicy?.id ?? null,
    consents: consents ?? [],
  };
}

export async function loadCustomerIntake(authUser) {
  const dashboard = await loadCustomerDashboardData(authUser);

  const { data: profile, error: profileError } = await supabase
    .from("customer_profiles")
    .select("id, display_name, birth_date, gender, job_category, status")
    .eq("user_id", authUser.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (profileError) {
    throw new Error(toCustomerErrorMessage(profileError, "고객 프로필을 불러오지 못했습니다."));
  }

  if (!profile) {
    throw new Error("고객 프로필을 불러오지 못했습니다.");
  }

  const [healthResult, insuranceResult, consentsResult] = await Promise.all([
    supabase
      .from("profile_health")
      .select("customer_id, source, details_json")
      .eq("customer_id", profile.id)
      .maybeSingle(),
    supabase
      .from("profile_insurance_policies")
      .select("id, insurer_name, product_name, coverage_summary")
      .eq("customer_id", profile.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("customer_consents")
      .select("consent_type, granted, revoked_at")
      .eq("customer_id", profile.id),
  ]);

  if (healthResult.error) {
    throw new Error(toCustomerErrorMessage(healthResult.error, "건강 정보를 불러오지 못했습니다."));
  }

  if (insuranceResult.error) {
    throw new Error(toCustomerErrorMessage(insuranceResult.error, "보험 정보를 불러오지 못했습니다."));
  }

  if (consentsResult.error) {
    throw new Error(toCustomerErrorMessage(consentsResult.error, "동의 정보를 불러오지 못했습니다."));
  }

  const insurancePolicy = insuranceResult.data
    ? {
        ...insuranceResult.data,
        coverage_summary:
          typeof insuranceResult.data.coverage_summary === "object"
            ? insuranceResult.data.coverage_summary?.summary ?? ""
            : insuranceResult.data.coverage_summary ?? "",
      }
    : null;

  const intake = extractIntake(healthResult.data?.details_json);
  if (insurancePolicy?.coverage_summary && !intake.insuranceSummary) {
    intake.insuranceSummary = String(insurancePolicy.coverage_summary);
  }

  return normalizeCustomerIntake({
    dashboard,
    profile,
    health: healthResult.data
      ? { ...healthResult.data, details_json: healthResult.data.details_json }
      : null,
    insurancePolicy,
    consents: consentsResult.data ?? [],
  });
}

export async function saveCustomerIntake(authUser, form) {
  const current = await loadCustomerIntake(authUser);
  const customerId = current.customerId;

  const { error: profileError } = await supabase
    .from("customer_profiles")
    .update({
      display_name: form.displayName?.trim() || null,
      birth_date: form.birthDate || null,
      gender: form.gender?.trim() || null,
      job_category: form.jobCategory?.trim() || null,
    })
    .eq("id", customerId);

  if (profileError) {
    throw new Error(toCustomerErrorMessage(profileError, "프로필을 저장하지 못했습니다."));
  }

  const { data: healthRow, error: healthReadError } = await supabase
    .from("profile_health")
    .select("customer_id, details_json")
    .eq("customer_id", customerId)
    .maybeSingle();

  if (healthReadError) {
    throw new Error(toCustomerErrorMessage(healthReadError, "건강 정보를 불러오지 못했습니다."));
  }

  const existingDetails =
    healthRow?.details_json && typeof healthRow.details_json === "object"
      ? healthRow.details_json
      : {};

  const mergedDetails = {
    ...existingDetails,
    insurance_disclosure_version: INSURANCE_DISCLOSURE_VERSION,
    insurance_disclosure: buildHealthDisclosurePayload(form.healthDisclosure),
    intake: {
      address: form.address?.trim() || "",
      consultation_purpose: form.consultationPurpose?.trim() || "",
      insurance_summary: form.insuranceSummary?.trim() || "",
    },
  };

  const healthPayload = {
    customer_id: customerId,
    details_json: mergedDetails,
    source: "update",
  };

  const healthWrite = healthRow
    ? supabase.from("profile_health").update(healthPayload).eq("customer_id", customerId)
    : supabase.from("profile_health").insert({ ...healthPayload, source: "update" });

  const { error: healthError } = await healthWrite;
  if (healthError) {
    throw new Error(toCustomerErrorMessage(healthError, "건강 정보를 저장하지 못했습니다."));
  }

  const insuranceRow = {
    customer_id: customerId,
    insurer_name: form.insurerName?.trim() || null,
    product_name: form.productName?.trim() || null,
    coverage_summary: { summary: form.insuranceSummary?.trim() || "" },
    source: "manual",
    is_active: true,
  };

  if (current.insurancePolicyId) {
    const { error: insuranceError } = await supabase
      .from("profile_insurance_policies")
      .update(insuranceRow)
      .eq("id", current.insurancePolicyId);
    if (insuranceError) {
      throw new Error(toCustomerErrorMessage(insuranceError, "보험 정보를 저장하지 못했습니다."));
    }
  } else if (
    form.insurerName?.trim() ||
    form.productName?.trim() ||
    form.insuranceSummary?.trim()
  ) {
    const { error: insuranceError } = await supabase
      .from("profile_insurance_policies")
      .insert(insuranceRow);
    if (insuranceError) {
      throw new Error(toCustomerErrorMessage(insuranceError, "보험 정보를 저장하지 못했습니다."));
    }
  }

  return loadCustomerIntake(authUser);
}

export { emptyIntakeForm };

import assert from "node:assert/strict";
import {
  INSURANCE_AGGREGATE_FACT_KEYS,
  parsePolicyIdFromInsuranceFactKey,
  policyKeyedInsuranceFactKeys,
  scrubInsuranceMemoryAfterPolicyRetire,
  supersedeActiveFactKeys,
} from "../server/customerMemoryInsuranceScrub.js";

assert.deepEqual(policyKeyedInsuranceFactKeys("pol-1"), [
  "insurance.policy.pol-1.summary",
  "insurance.policy.pol-1.riders",
]);
assert.equal(
  parsePolicyIdFromInsuranceFactKey(
    "insurance.policy.aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.summary",
  ),
  "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
);
assert.equal(parsePolicyIdFromInsuranceFactKey("profile.name"), null);
assert.equal(INSURANCE_AGGREGATE_FACT_KEYS.length, 4);

function makeScrubSupabase({ policies = [], facts = [] } = {}) {
  const state = {
    policies: policies.map((row) => ({ ...row })),
    facts: facts.map((row) => ({ ...row })),
    memory_version: 1,
  };

  return {
    _state: state,
    from(table) {
      if (table === "active_profile_insurance_policies") {
        return {
          select() {
            return {
              eq() {
                return Promise.resolve({ data: state.policies, error: null });
              },
            };
          },
        };
      }
      if (table === "customer_profiles") {
        return {
          select() {
            return {
              eq() {
                return {
                  is() {
                    return {
                      maybeSingle: async () => ({
                        data: { memory_version: state.memory_version },
                        error: null,
                      }),
                    };
                  },
                };
              },
            };
          },
          update(payload) {
            return {
              eq: async () => {
                state.memory_version = payload.memory_version;
                return { error: null };
              },
            };
          },
        };
      }
      if (table !== "customer_memory_facts") {
        throw new Error(`unexpected_table:${table}`);
      }
      return {
        select(columns) {
          return {
            eq(_col, customerId) {
              return {
                is(_c, _v) {
                  const chain = {
                    in(field, keys) {
                      return {
                        select: async () => {
                          const keySet = new Set(keys);
                          const matched = state.facts.filter(
                            (f) =>
                              f.customer_id === customerId &&
                              f.superseded_at == null &&
                              keySet.has(f.fact_key),
                          );
                          for (const row of matched) {
                            row.superseded_at = "2026-07-13T00:00:00.000Z";
                          }
                          return { data: matched.map((r) => ({ id: r.id, fact_key: r.fact_key })), error: null };
                        },
                      };
                    },
                    like(_field, pattern) {
                      const prefix = String(pattern).replace(/%/g, "");
                      return Promise.resolve({
                        data: state.facts
                          .filter(
                            (f) =>
                              f.customer_id === customerId &&
                              f.superseded_at == null &&
                              String(f.fact_key).startsWith(prefix),
                          )
                          .map((f) => ({ fact_key: f.fact_key })),
                        error: null,
                      });
                    },
                    maybeSingle: async () => {
                      // used by upsert path — not hit in this supersede-only case when no active policies
                      return { data: null, error: null };
                    },
                    async then(resolve) {
                      // .select().eq().is() without like — unused
                      return resolve({ data: [], error: null });
                    },
                  };
                  // supersedeActiveFactKeys: update().eq().is().in().select()
                  return chain;
                },
                eq() {
                  return {
                    is() {
                      return {
                        maybeSingle: async () => ({ data: null, error: null }),
                      };
                    },
                  };
                },
              };
            },
          };
        },
        update(payload) {
          return {
            eq(_c, customerId) {
              return {
                is() {
                  return {
                    in(field, keys) {
                      return {
                        select: async () => {
                          const keySet = new Set(keys);
                          const matched = state.facts.filter(
                            (f) =>
                              f.customer_id === customerId &&
                              f.superseded_at == null &&
                              keySet.has(f[field] ?? f.fact_key),
                          );
                          for (const row of matched) {
                            Object.assign(row, payload);
                          }
                          return {
                            data: matched.map((r) => ({ id: r.id, fact_key: r.fact_key })),
                            error: null,
                          };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
        insert() {
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

{
  const policyId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const supabase = makeScrubSupabase({
    policies: [],
    facts: [
      {
        id: "f1",
        customer_id: "cust-1",
        fact_key: `insurance.policy.${policyId}.summary`,
        fact_value: "한화생명/종신(유지)",
        superseded_at: null,
      },
      {
        id: "f2",
        customer_id: "cust-1",
        fact_key: `insurance.policy.${policyId}.riders`,
        fact_value: "특약A",
        superseded_at: null,
      },
      {
        id: "f3",
        customer_id: "cust-1",
        fact_key: "insurance.policy.count",
        fact_value: "1",
        superseded_at: null,
      },
      {
        id: "f4",
        customer_id: "cust-1",
        fact_key: "profile.name",
        fact_value: "QA",
        superseded_at: null,
      },
    ],
  });

  const result = await scrubInsuranceMemoryAfterPolicyRetire({
    supabase,
    customerId: "cust-1",
    retiredPolicyIds: [policyId],
  });
  assert.equal(result.ok, true);
  assert.ok(result.retired_keyed_superseded >= 2);
  assert.equal(result.active_policy_count, 0);
  assert.equal(
    supabase._state.facts.find((f) => f.id === "f1").superseded_at != null,
    true,
  );
  assert.equal(
    supabase._state.facts.find((f) => f.id === "f2").superseded_at != null,
    true,
  );
  assert.equal(
    supabase._state.facts.find((f) => f.id === "f3").superseded_at != null,
    true,
    "aggregate count must supersede when no active policies",
  );
  assert.equal(
    supabase._state.facts.find((f) => f.id === "f4").superseded_at,
    null,
    "profile memory must stay",
  );
}

{
  const supabase = makeScrubSupabase({
    facts: [
      {
        id: "f1",
        customer_id: "cust-1",
        fact_key: "insurance.policies.active_summary",
        fact_value: "old",
        superseded_at: null,
      },
    ],
  });
  const r = await supersedeActiveFactKeys(supabase, "cust-1", [
    "insurance.policies.active_summary",
  ]);
  assert.equal(r.superseded_count, 1);
}

console.log("customer-memory-insurance-scrub-unit-test: PASS");

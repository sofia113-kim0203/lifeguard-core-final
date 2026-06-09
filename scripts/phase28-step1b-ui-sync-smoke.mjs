/**
 * Phase 28 Step 1B — smoke check for unified-state API + session-facing modules.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const requiredFiles = [
  "api/customer-unified-state.js",
  "src/context/CustomerSessionProvider.jsx",
  "src/lib/customerUnifiedState.js",
  "src/hooks/useCustomerSession.js",
  "src/components/CustomerDashboardPanel.jsx",
];

for (const file of requiredFiles) {
  assert.ok(existsSync(file), `missing ${file}`);
}

const dashboardSource = readFileSync("src/components/CustomerDashboardPanel.jsx", "utf8");
assert.match(dashboardSource, /AiRecommendationPanel/, "dashboard must embed recommendation panel");
assert.match(dashboardSource, /useCustomerSession/, "dashboard must use customer session");
assert.match(dashboardSource, /onAnalysisJobUpdate/, "dashboard must wire analysis job updates");

const appSource = readFileSync("src/App.jsx", "utf8");
assert.match(appSource, /CustomerSessionProvider/, "app must provide customer session");

const documentsSource = readFileSync("src/components/DocumentsPanel.jsx", "utf8");
assert.match(documentsSource, /notifySystemMessage/, "documents panel must post session messages");

const conversationsSource = readFileSync("src/lib/customerConversations.js", "utf8");
assert.match(conversationsSource, /postCustomerSystemMessage/, "system message helper required");

const recommendationPanelSource = readFileSync("src/components/AiRecommendationPanel.jsx", "utf8");
assert.match(
  recommendationPanelSource,
  /hydrateMissingClaudeExplanations/,
  "analysis job panels must hydrate Claude via panel APIs",
);

console.log("Phase 28 Step 1B UI sync smoke checks passed.");

/**
 * @deprecated Use jc-premium-burden-v1-preview-verify-exec.mjs (verify) or
 * jc-premium-burden-v1-preview-deploy-exec.mjs (deploy) separately.
 */
console.error("HOLD — combined deploy+verify removed per Tom.");
console.error("");
console.error("Preview deploy (separate):");
console.error("  npm run deploy:jc-premium-burden-v1-preview");
console.error("");
console.error("Preview verify (separate):");
console.error("  npm run verify:jc-premium-burden-v1-preview -- <preview-url>");
console.error("");
console.error("Production deploy (Tom GO only):");
console.error("  npm run deploy:jc-premium-burden-v1-production -- --tom-go");
process.exit(2);

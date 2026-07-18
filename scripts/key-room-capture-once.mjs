/**
 * Capture KEY ROOM visual seat at desktop / mid / mobile widths.
 * Local only — uses /key-room-seat.html (no Supabase).
 */
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = process.env.KEY_ROOM_SEAT_URL || "http://127.0.0.1:4173/key-room-seat.html";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 960 } });
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
page.on("console", (m) => {
  if (m.type() === "error") console.log("CONSOLE", m.type(), m.text());
});

await page.goto(base, { waitUntil: "networkidle" });
await page.waitForSelector("[data-key-room-visual-seat='1']", { timeout: 15000 });

const out = {
  desktop: path.join(root, "fixtures/key-room-ui-capture-desktop.png"),
  mid: path.join(root, "fixtures/key-room-ui-capture-mid.png"),
  mobile: path.join(root, "fixtures/key-room-ui-capture-mobile.png"),
};

await page.getByRole("button", { name: "데스크톱" }).click();
await page.waitForTimeout(300);
await page.locator("[data-key-room-visual-seat='1']").screenshot({ path: out.desktop });

await page.getByRole("button", { name: "중간" }).click();
await page.waitForTimeout(300);
await page.locator("[data-key-room-visual-seat='1']").screenshot({ path: out.mid });

await page.getByRole("button", { name: "모바일" }).click();
await page.waitForTimeout(300);
await page.locator("[data-key-room-visual-seat='1']").screenshot({ path: out.mobile });

console.log("WROTE", out);
await browser.close();

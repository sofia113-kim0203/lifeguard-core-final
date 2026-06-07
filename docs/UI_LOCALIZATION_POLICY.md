# UI Localization Policy — LIFEGUARD Core

## Principle

**Customer-facing UI is Korean-first.** A Korean insurance customer must not see internal English terminology in menus, buttons, status badges, empty states, validation messages, or placeholders.

## Korean (display only)

- Menu labels
- Buttons
- Status badges (`준비중`, `데이터 연결 예정`, `다음 단계`)
- Empty states
- Validation and error messages
- Input placeholders
- Role labels (`고객`, `설계사`, `관리자`)
- Profile/health source labels

## English (keep in code)

- Database table and column names
- Variable and function names
- React component names
- API/metadata keys (`customer_id` in JSON — label as `고객 ID` in UI)

## Implementation

- Shared helpers: `src/lib/uiLocale.js`
  - `formatUserRole`, `formatProfileStatus`, `formatHealthSource`
  - `toCustomerErrorMessage` — maps Supabase/auth English errors to Korean
  - `UI_LABELS` — standard field labels

## Admin panels

Admin dev tools may retain technical terms until a dedicated admin localization pass. Customer routes (sidebar menus through role gates) must follow this policy first.

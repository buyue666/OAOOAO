# Membership display implementation — 2026-10-14

## Scope and inputs

This change introduces a new membership storefront composition, plan card, purchase review, and CSS layout. The implementation work used the caller contracts in `components/membership/plans-page.tsx`, `components/studio/product-preview.tsx`, and the color-control wiring in `components/studio/admin-commerce.tsx`; the input/output declarations in `components/membership/types.ts`; the retained product conversion and cycle resolver in `lib/studio/membership.ts`; the retained folding utility in `components/membership/benefits.ts`; the current `CommercePolicy` contract; local Next.js client-component documentation; the existing site UI controls; and existing regression tests. The test harness continues to execute the existing product-draft conversion to check the administrative draft round trip.

During this implementation, the previous membership display components and stylesheet, external template ZIPs, reference/audit source trees, and upstream application source were not read. Deleted display files were removed by their known paths. These statements describe this implementation's input boundaries; they do not establish a formal clean-room process for the entire repository or conclude that the project has no licensing risk. Repository provenance and retained third-party notices are reviewed separately.

## Retained interoperability

- `MembershipPurchaseView` keeps the storefront, products, billing options, audience/cycle controls, tier callback, preview/read-only behavior, loading/error/retry states, comparison/FAQ inputs, close callback, and asynchronous selection callback.
- `PlanCard` retains `plan`, `tier`, `billingCycle`, `billingOption`, `showMore`, `isCurrent`, `onTierChange`, `onSelect`, and `onInstallment`. Optional `interactive` and `busy` inputs allow callers to disable purchase controls. The installment callback remains an interface compatibility point; the new storefront does not manufacture an installment offer.
- CSS exports `themeScope`, `viewportScope`, `previewRoot`, `planGrid`, `moreBenefitsButton`, `toneOptions`, and `toneSwatch` remain available. The card grid uses flex wrapping and centering. Named container queries use the display container's width, including fixed-width administrative previews. `--plan-count: 1` constrains the standalone desktop preview.
- Product conversion, order creation, payment adapters, checkout state, and server behavior were not changed by this display implementation.

## Display and purchase behavior

The selected tier's exact cycle pricing supplies the product identifier, currency, amount, and credit grant. `resolveTierDisplay` supplies that cycle's color, daily credits, badge, promotion text, and benefits. A cycle-specific map never borrows missing benefit groups from another product. Benefits fold after six visible rows and can be expanded. Campaign, comparison, and FAQ content appears only when callers provide it; no fallback campaign or capability claims are added.

A purchase first opens a review that shows the exact price and credits, any configured daily grant, the published expiry/refund/renewal/invoice rules, customer support, and service/privacy agreement links. The callback runs only after explicit consent and complete published policy data. Consent is tied to the policy contents. The catalog and current membership are checked again immediately before dispatch. A synchronous ref lock blocks simultaneous confirmations while the callback is pending. Errors keep the review available for retry. Preview, read-only, current-membership, disabled-plan, missing-cycle, and invalid-pricing states cannot initiate purchase.

Five newly specified palettes distinguish `standard`, `advanced`, `premium`, `luxury`, and `ultimate`. Cards and controls use CSS shapes and native text, with no external template images. The only optional campaign image is supplied by the caller. Buttons have explicit button types, named controls and visible keyboard focus; the site dialog primitive supplies focus/modal behavior. Reduced-motion preferences disable motion in the display scope.

## Verification

The relevant local regression command passed 46 tests:

```powershell
node --test tests/membership-purchase-view.test.mjs tests/commerce-storefront.test.mjs tests/plans-checkout-scope.test.mjs tests/membership.test.cjs tests/workspace-preview.test.mjs
```

The new tests execute the production components with persistent React-hook state and inert UI leaves. They cover exact cycle display, tier selection, consent, duplicate asynchronous events, error retry, preview browsing, current/disabled/unavailable products, catalog changes, policy changes, controlled callbacks, folding, loading/error/empty states, and close behavior. They do not send orders or modify external data.

The React best-practices checklist was applied to the new TSX: hooks are unconditional; transient dispatch locking is per-instance; derived selections do not require effects; event handlers own purchase transitions; product references are revalidated; input controls have accessible names; and no extra remote fetches or heavy libraries were introduced. `tsc --noEmit` passed. A final whitespace check is recorded with the root agent's verification.

The implementation worker did not run the pre-existing live browser scripts, which hard-code an external dependency path. Its attempted local Playwright launch stopped before opening a browser and the temporary script was removed. The coordinator subsequently verified the new pages with the approved browser tools against a loopback-only synthetic backend: desktop and phone layouts, five card palettes, points-store display, disabled administrative previews, policy review, and duplicate purchase events. Database inspection confirmed exactly one new pending synthetic order; no real charge was made. The complete frontend acceptance suite passed 336 tests, and the disposable schema was removed after verification. Application-code whitespace checks passed; original whitespace inside third-party license bodies is deliberately preserved.

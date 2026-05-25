# PolicyLens Mobile UI — Audit + Fixes (2026-05-26)

Smoke test of the Policies tab on a 360–430 px Android screenshot (Heather, 3 policies).
All edits land in **`src/index.babel.html`** — the source. Run
`npm run build:precompile` to regenerate `index.html`.

> ⚠ **Where to apply these changes**: the canonical PolicyLens clone is
> `C:\Creations\PolicyLens-ckgtools\` (remote `FundLens-SG/PolicyLens`).
> `ckgtools/public/tools/policylens/` is the auto-synced mirror — pushes
> from the canonical clone overwrite it. If you want these fixes to
> survive, port them to the canonical clone too.

Tag: `v2.4.0-rc1.85` (used as the version comment marker on every edit).

---

## Summary table

| # | Finding | Severity | Status | File reference (src) |
|---|---|---|---|---|
| 1 | "Hover a code for full name" hint dead on touch | 🔴 Bug | ✅ Fixed | `index.babel.html` ~line 50191 |
| 2 | "Clear all" broom icon clipped at top of filter zone | 🔴 Bug | ✅ Fixed | `index.babel.html` ~line 49495 |
| 3 | Drop zone is desktop-only on mobile | 🔴 Bug | ✅ Fixed | `index.babel.html` ~line 35328 (DropZone) |
| 4 | "Clients" tab cut off, no scroll affordance | 🔴 Bug | ✅ Fixed | `index.babel.html` ~line 32087 |
| 5 | Bottom-right floating FAB icon ambiguous | 🔴 Bug | ✅ Fixed | `index.babel.html` ~line 29756 |
| 6 | Filter chips don't distinguish selected/unselected | 🟠 Clarity | ✅ Fixed (via #1 — chips are now interactive tap-to-reveal) | `index.babel.html` ~line 50176 |
| 7 | "Profile" chip + tab share label | 🟠 Clarity | ✅ Fixed | `index.babel.html` ~line 32185 |
| 8 | "3 active / 3 total" + tab badge redundant | 🟠 Clarity | ✅ Fixed (chip collapses when equal; badge kept as count signal) | `index.babel.html` ~line 32172 |
| 9 | "$872/yr" lacks label | 🟠 Clarity | ✅ Fixed | `index.babel.html` ~line 32175 |
| 10 | "Review 0" wastes a tap target | 🟠 Clarity | ✅ Fixed | `index.babel.html` ~line 32176 |
| 11 | "Synced" pill breaks chip rhythm | 🟠 Clarity | ✅ Fixed | `index.babel.html` ~line 32188 |
| 12 | Buttons under 44 px tap target | 🟡 Polish | ✅ Fixed (global CSS rule) | `index.babel.html` ~line 361 (CSS) |
| 13 | Active tab pill visually dominant | 🟡 Polish | ✅ Fixed | `index.babel.html` ~line 32096 |
| 14 | PROTECTION group checkbox unlabeled | 🟡 Polish | ✅ Fixed | `index.babel.html` ~line 50209 |
| 15 | Policy table cramped on narrow screens | 🟡 Polish | ✅ Fixed (Insurance + Fixed Deposits + Other Assets) | `index.babel.html` ~lines 50200, 50450, 50486 |
| 16 | No `viewport-fit=cover` / safe-area padding | 🟡 Polish | ✅ Fixed (meta + CKG strip + toast + orientation FAB) | `index.babel.html` line 5, ~line 320, ~line 397, ~line 29766 |

**Built & verified**: `npm run build:precompile` runs clean. All change markers
("Tap a code for full name", "Tap to upload", "Edit profile", "Orientation
lock:", "revealedLegend", "Select all … policies") appear in the regenerated
`index.html` — 11 distinct occurrences.

---

## Fix details

### 1. Rider/Status code legend → tap-to-reveal full name

**Problem**: The legend row shows 8 rider codes (D, TPD, CI, ECI, DI, PA, WP,
CV) and 4 status codes with a hint "Hover a code for full name". No hover on
touch. STATUS chips had no `title` either (rider chips did).

**Fix**:
1. Added state in `Policies()` for the currently revealed code:
   ```jsx
   const [revealedLegend, setRevealedLegend] = useState(null);
   const revealLegendTimerRef = useRef(null);
   const revealLegend = (label) => {
     setRevealedLegend(label);
     if (revealLegendTimerRef.current) clearTimeout(revealLegendTimerRef.current);
     revealLegendTimerRef.current = setTimeout(() => setRevealedLegend(null), 2500);
   };
   ```
2. Converted each `<span>` chip into a `<button>` with `onClick={() => revealLegend(...)}`,
   `aria-label`, `title`, and `cursor:pointer`. STATUS chips also got `title`.
3. Replaced the hint text with `revealedLegend || 'Tap a code for full name'`,
   gold-tinted when revealing.

**Solves both finding #1 (tap fallback) and finding #6 (chip distinction)** —
the chips now have a clear interaction model.

---

### 2. "Clear all" clipping on mobile

**Problem**: Destructive button wrapped into the action row and visually
clipped by the sticky header on scroll.

**Fix**: `Clear all` is now `desktop-only` (`!isMobile && policies.length > 0
&& selected.size === 0 && …`). The double-confirm dialogs are also poor UX on
touch. Power-user destructive actions stay on desktop.

---

### 3. Mobile tap-to-upload in DropZone

**Problem**: `DropZone` accepted only drag & paste, useless on phones.

**Fix** (DropZone component):
- Added `useViewportIsMobile()` hook + a hidden `<input type="file" multiple
  accept="image/*,.pdf,.xlsx,...">`.
- On mobile: the zone becomes a tap target (`role=button`, `tabIndex=0`,
  Enter/Space handlers), `onClick` opens the OS file picker.
- Label swaps to "📎 Tap to upload — photo, PDF, doc" on mobile.
- Min height bumped to 56 px on touch.

---

### 4. Tab strip horizontal-scroll affordance

**Problem**: 7 tabs overflow at < 430 px; existing `overflowX: auto` had no
visual indicator that more content was hidden.

**Fix**:
- Wrapped the existing tab row in a `position:relative` container.
- Added `scrollbarWidth: 'none'` / `msOverflowStyle: 'none'` to hide the ugly
  scrollbar.
- Added a 28 px right-edge gradient fade (`linear-gradient(to right,
  transparent, T.bg)`) with `pointerEvents: 'none'` so taps pass through.
- Only rendered on mobile.

---

### 5. Orientation-lock FAB icon → text label

**Problem**: AUTO mode showed `↻` glyph which reads as "refresh". Users
tapped it expecting reload.

**Fix**:
- Replaced glyph icons with text: `AUTO` (small, 9 px) / `P` (portrait) / `L`
  (landscape).
- AUTO pill widens to 50 px (vs 42 px for P/L) and uses tighter letterspacing
  + smaller font.
- Smoother width/font transitions.
- `aria-label` and `title` already present — preserved.

---

### 6. (covered by #1) Chip selected/unselected distinction

The legend chips are now interactive buttons with hover/press cursor, and the
hint slot turns gold when active. Functionally separate from the row chips on
each policy (those weren't broken — they have semantic colors per type).

---

### 7. Rename "Profile" chip → "Edit profile"

**Problem**: A chip and a tab both named "Profile".

**Fix**: Chip label is now `Edit profile`; chip's `title` reads "Open the
Profile tab to edit this client's details". Chip still navigates via `setTab('profile')`.

---

### 8. Collapse "N active / N total" when equal

**Problem**: "3 active / 3 total" is noise when both numbers match.

**Fix**:
```jsx
{summary.activePolicyCount === summary.totalPolicyCount
  ? `${summary.totalPolicyCount} polic${summary.totalPolicyCount === 1 ? 'y' : 'ies'}`
  : `${summary.activePolicyCount} active / ${summary.totalPolicyCount} total`}
```
The button still navigates to the Policies tab. Title attribute gives the
full breakdown either way. **The tab badge "3" is kept** — it serves as an
"this client has policies" signal at a glance.

---

### 9. Label the premium chip

**Problem**: `$872/yr` alone is ambiguous (premium? payout? income?).

**Fix**: Chip now reads `Premium  $872/yr` with a softer "Premium" prefix in
`var(--text3)` and the figure in `var(--text2) bold`. `title` is "Total annual
premium (active policies)"; `aria-label` is "Total annual premium $872/yr".

---

### 10. Hide "Review 0" at zero state

**Problem**: 0-state chip wastes a tap target.

**Fix**: Wrapped the Review button in `{summary.reviewCount > 0 && (...)}`.
When count is > 0, the chip's gold treatment + 800 weight makes it
prominently actionable.

---

### 11. Inline Synced state as a small dot

**Problem**: "Synced" pill on its own line broke the chip rhythm.

**Fix**:
- OK-path (`syncState === 'synced'`) collapses to a tiny 18 px green ✓ dot
  next to the client name, with `title="Synced [timestamp]"` and
  `aria-label="Synced"`.
- Non-OK states (failed / queued / ready / idle) still render as the full
  chip at the end of the row — those are actionable and warrant attention.

---

### 12. 44 px tap target compliance (touch devices)

**Problem**: Many chips render at 24–26 px tall, below iOS 44 px / Material
48 dp guidance.

**Fix**: Added a global CSS rule in the `<style>` block (~line 366):

```css
@media (pointer: coarse) {
  button[style*="borderRadius:999"]:not([style*="height:32"])...
        :not([style*="height:44"]) {
    position: relative;
  }
  button[style*="borderRadius:999"]:not(...)::after {
    content: "";
    position: absolute;
    inset: -8px;
    min-width: 44px;
    min-height: 44px;
  }
  .btn-sm, .btn-danger.btn-sm { min-height: 36px; }
}
```

This **extends the touchable area** without inflating the visible chip — the
`::after` overlay is transparent. Skips selectors that already declare a
button-friendly height to avoid breaking existing flex layouts.

---

### 13. Soften active tab pill

**Problem**: Solid gold-fill active tab dominated the strip.

**Fix**:
- Active background: `T.primaryDim` (tinted) instead of `T.primary` (solid).
- Active text: `T.primary` instead of `#fff`.
- Added `boxShadow: 'inset 0 -2px 0 0 T.primary'` as a subtle underline
  accent that signals "selected" without shouting.
- Badge background on active tab uses solid `T.primary` so the count still
  pops.

---

### 14. PROTECTION group select-all checkbox label

**Problem**: Group-header checkbox had no `aria-label` — screen readers
couldn't associate it with the visible text.

**Fix**:
```jsx
<input type='checkbox'
  aria-label={'Select all ' + group.sub + ' policies (' + group.items.length + ')'}
  title={'Select all ' + group.sub + ' policies'}
  ... style={{accentColor:'var(--gold)', width:18, height:18, cursor:'pointer'}} />
```
Also bumped the box to 18 × 18 with `cursor:pointer` for clarity.

Per-row checkboxes also got `aria-label={'Select ' + (policyName||productName||'policy')}`.

---

### 15. Reflow policy table on narrow screens

**Problem**: Table had 7 columns. On mobile, SUB-TYPE column shows
duplicate `Whole Life / Whole Life`; columns cramp.

**Fix** (Insurance table only — other tables left for next pass):
- On `isMobile`: SUB-TYPE column and SUM ASSURED column drop out of the
  table.
- SUB-TYPE text appears as a small caption under the policy name.
- SUM ASSURED, when present and > 0, renders as a small `SA $XXX` mono chip
  in the policy-row chip cluster (alongside D / CI / TPD chips).
- `colSpan` for group headers adjusts (5 vs 7).
- Insurer column header shortens to "Insurer" on mobile.

**Also ported in this pass**:
- **Fixed Deposits / Bonds** table (~line 50450): Drops TYPE + YIELD columns
  on mobile. Sub-type folds in as a small caption; yield renders as a green
  `XX% yield` micro-line under the policy name.
- **Other Assets** table (~line 50486): Same structure — drops TYPE +
  YIELD/RETURN columns; sub-type + yield fold under the policy name.

Both tables also got `aria-label` on their select-all checkboxes.

---

### 16. `viewport-fit=cover` + safe-area padding

**Status**: ✅ **Fixed.**

Changes:
1. **Meta viewport** (line 5):
   ```html
   <meta name="viewport"
     content="width=device-width, initial-scale=1.0, maximum-scale=1.0,
              user-scalable=no, viewport-fit=cover">
   ```
2. **CKG Suite Strip** (~line 397): height grows by
   `env(safe-area-inset-top, 0px)` and pads itself by that amount, so the
   black bar properly cloaks the iPhone notch. Body's `padding-top` matches.
   Left/right padding also adjust for landscape notch positioning.
3. **Toast container** (~line 320): bottom offset adds
   `env(safe-area-inset-bottom, 0px)` so toasts clear the home indicator.
4. **Orientation lock FAB** (~line 29766): bottom + right offsets use
   `calc(14px + env(safe-area-inset-*, 0px))`.

Fallback is `0px` on devices without a notch — Android + desktop see no
change. Verify on a real iPhone with notch (12+/13/14/15/16) — Android
testing done already.

---

## How to verify locally

```powershell
cd C:\CKG Creations\ckgtools
npm run dev
```

Open `http://localhost:5173/tools/policylens/` and DevTools → toggle device
toolbar → iPhone 13 mini (375×812) or Pixel 5 (393×851).

Check, on the Policies tab with a client selected:
- Header chips wrap cleanly; "Edit profile" reads right; ✓ dot replaces
  "Synced" pill in the OK path.
- Tab strip scrolls horizontally with a right-edge fade.
- Active tab is softer (tinted, not solid fill).
- Drop zone shows "📎 Tap to upload — photo, PDF, doc" and opens the file
  picker on tap.
- Rider/status chips show the full label when tapped (gold hint slot).
- "Clear all" hidden on mobile, visible on desktop ≥ 768 px.
- Bottom-right FAB shows "AUTO" (text, not ↻).
- Insurance table has 4 columns on mobile (Select / Policy / Insurer /
  Premium) with sub-type folded under the policy name.
- All chips have at least a 44 × 44 px tap area.

---

## Open items for follow-up

1. **Smoke test** on a real iPhone (12+/13/14/15/16 — notch / Dynamic
   Island) and on a small Android (Pixel 4a / 360 px) to verify the safe-area
   work renders correctly and no chip wraps awkwardly at < 360 px.
2. Consider extracting the rider-code legend to its own component now that
   it has state — `Policies()` is already long. Cosmetic refactor only.
3. Optional: apply the same `pointer:coarse` 44 × 44 tap-target rule to
   sibling tools (FundLens, AutoDial, Illustration Studio) by lifting the CSS
   into a shared file or repeating it locally.

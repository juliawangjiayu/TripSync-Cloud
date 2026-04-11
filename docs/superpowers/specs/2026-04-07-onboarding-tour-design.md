# Onboarding Tour Design

## Overview

A guided tour for first-time users on the ItineraryEditor page. Uses react-joyride for spotlight + tooltip steps. Triggered once per account, controlled by a backend flag.

## Backend Changes

### User Model

Add field to `app/models/user.py`:

```python
has_completed_onboarding: Mapped[bool] = mapped_column(Boolean, default=False)
```

### Alembic Migration

Single `ALTER TABLE users ADD COLUMN has_completed_onboarding BOOLEAN DEFAULT FALSE NOT NULL`.

### Schema Changes

Add `has_completed_onboarding: bool` to `UserOut` in `app/schemas/auth.py`. This field is already returned by login/register responses via `UserOut`.

### New Endpoint

```
PATCH /auth/me/onboarding-complete
```

- Auth required
- Sets `has_completed_onboarding = True` for the current user
- Returns 200

Added to `app/routers/auth.py`.

## Frontend Changes

### Dependencies

Install `react-joyride`.

### Types

Add `has_completed_onboarding: boolean` to the `User` interface in `src/types/index.ts`.

### API Client

Add to `authApi` in `src/api/client.ts`:

```ts
completeOnboarding: () => api.patch('/auth/me/onboarding-complete')
```

### Tour Integration (ItineraryEditor)

Location: `src/pages/ItineraryEditor.tsx`

- Import `{ Joyride, STATUS, EVENTS }` from react-joyride (named exports, not default)
- Check `user.has_completed_onboarding === false` from authStore
- Wait for itinerary data to load before starting tour (500ms delay)
- Use `onEvent` callback (not `callback` — react-joyride v3 API)
- On tour completion (STATUS.FINISHED or STATUS.SKIPPED): call `authApi.completeOnboarding()`, update local user state in authStore
- Alternatives step: flash the star button via CSS animation when step is active (since no alternatives exist for new users)

### Tour Steps

Each step targets a DOM element via CSS selector or `data-tour` attribute. Steps that target elements which may not exist (e.g., items in an empty itinerary) are conditionally included.

| # | Target (`data-tour`) | Placement | Content | Conditional |
|---|----------------------|-----------|---------|-------------|
| 1 | `add-day` | bottom | "Start by adding a day to your itinerary" | No |
| 2 | `add-item` | bottom | "Add activities to each day" | Yes - needs >= 1 day |
| 3 | `drag-handle` | bottom | "Drag to reorder items, even across days" | Yes - needs >= 1 item |
| 4 | `alternatives` | bottom | "Click ★ to view or add alternative suggestions for any field" | Yes - needs >= 1 item |
| 5 | `save` | bottom | "Click Save to persist all your changes" | No |
| 6 | `sync` | bottom | "Pull the latest changes from your collaborators" | No |
| 7 | `columns-sidebar` | right | "Toggle which columns are visible" | No |
| 8 | `right-panel-tabs` | left | "Switch between Map view and AI Chat" | No |
| 9 | `export-pdf` | bottom | "Export your itinerary to PDF" | No |
| 10 | `share` | bottom | "Share via link or manage collaborators" | No |

### Element Targeting

`data-tour` attributes added to:
- `TopBar.tsx` — sync, save, share, members, export-pdf buttons
- `DaySection.tsx` — add-item button, drag-handle td
- `EditableCell.tsx` — alternatives button
- `RightPanel.tsx` — right-panel-tabs div
- `ItineraryEditor.tsx` — add-day button, columns-sidebar aside

### Styling

- Spotlight overlay with semi-transparent backdrop (joyride default)
- Tooltip primary color: `#4f46e5` (indigo, matching project theme)
- Buttons: "Back", "Next", "Skip" on each step; "Done" on last step

### AuthStore Update

Add a method to update the local user object after onboarding completes:

```ts
markOnboardingComplete: () => {
  set((state) => ({
    user: state.user ? { ...state.user, has_completed_onboarding: true } : null
  }))
  // Also update localStorage
}
```

## Skip Behavior

Clicking "Skip" at any step ends the tour immediately and calls the API to mark onboarding as complete. The tour will not appear again.

No "replay tour" button is provided. Can be added later if needed.

## Empty Itinerary Handling

When the itinerary has no days or items, steps 2 (add-item), 3 (drag-handle), and 4 (alternatives) are excluded from the tour array (they reference elements that don't exist). The remaining 7 steps still provide a useful overview.

## Files Modified

**Backend:**
- `app/models/user.py` — add field
- `app/schemas/auth.py` — add field to UserOut
- `app/routers/auth.py` — add PATCH endpoint
- `alembic/versions/xxx_add_onboarding_field.py` — migration

**Frontend:**
- `package.json` — add react-joyride
- `src/types/index.ts` — add field to User
- `src/api/client.ts` — add completeOnboarding method
- `src/stores/authStore.ts` — add markOnboardingComplete method
- `src/pages/ItineraryEditor.tsx` — add Joyride component + step definitions + flash logic
- `src/components/layout/TopBar.tsx` — add data-tour attributes
- `src/components/editor/DaySection.tsx` — add data-tour attributes
- `src/components/editor/EditableCell.tsx` — add data-tour to alternatives button
- `src/components/layout/RightPanel.tsx` — add data-tour to tabs
- `src/index.css` — tour-flash animation keyframes

# Admin Dashboard Preview — Design Spec
**Date:** 2026-07-24  
**Status:** Approved

---

## Overview

Admins can preview any user's live dashboard — as that user sees it — without leaving the admin portal. Actions taken during preview are fully interactive: they use the target user's real Firestore UID so all reads and writes affect their actual data. The admin's Firebase Auth session handles all network calls; no re-authentication or token swapping is required.

---

## Architecture

### Core Mechanism: ImpersonationContext + `useEffectiveAuth()`

A new `ImpersonationContext` is added at the app root. It stores:

```ts
interface ImpersonationState {
  targetUserId: string | null
  targetProfile: UserProfile | null
  isImpersonating: boolean
  startImpersonation: (userId: string, profile: UserProfile) => void
  stopImpersonation: () => void
}
```

`startImpersonation` sets `targetUserId` and `targetProfile`. `stopImpersonation` clears both and navigates back to `/admin`.

A new hook `useEffectiveAuth()` (exported from `ImpersonationContext.tsx`) wraps `useAuth()`. When impersonation is active it returns the real auth object with `uid` and `profile` replaced by the target user's values:

```ts
export function useEffectiveAuth() {
  const auth = useAuth()
  const { isImpersonating, targetUserId, targetProfile } = useImpersonation()
  if (isImpersonating && targetUserId && targetProfile) {
    return {
      ...auth,
      profile: targetProfile,
      firebaseUser: auth.firebaseUser
        ? { ...auth.firebaseUser, uid: targetUserId }
        : null,
    }
  }
  return auth
}
```

All dashboard pages swap their single `useAuth()` call to `useEffectiveAuth()`. No other per-file changes are required.

### Pages updated (hook swap only)

- `pages/student/StudentDashboard.tsx`
- `pages/student/StudentCoursesPage.tsx`
- `pages/student/StudentCourseView.tsx`
- `pages/student/StudentDailyPlanner.tsx`
- `pages/student/StudentHistory.tsx`
- `pages/mentor/MentorDashboard.tsx`
- `pages/mentor/MentorStudentProgress.tsx`
- `pages/ProfilePage.tsx`

Admin-only pages (`AdminDashboard`, `UserManagement`, `StudentsPage`, etc.) keep `useAuth()` — they are not reachable during impersonation because the sidebar swaps away from admin nav.

---

## AppShell Changes

`AppShell.tsx` reads `useImpersonation()` and derives effective role booleans:

```ts
const { isImpersonating, targetProfile, stopImpersonation } = useImpersonation()
const effectiveRoles = isImpersonating ? targetProfile!.roles : profile?.roles ?? []

const showAdmin  = !isImpersonating && profile?.roles.includes('admin')
const showMentor = effectiveRoles.includes('mentor')
const showStudent = effectiveRoles.includes('student')
```

The sidebar and bottom nav use `showAdmin`/`showMentor`/`showStudent` instead of the current booleans. Admin nav is hidden during impersonation.

### Preview Banner

A sticky amber bar rendered at the top of `<main>` when `isImpersonating` is true:

```
┌─────────────────────────────────────────────────────┐
│ 👁 Previewing as  Alice Tan  ·  student             │
│                                      [Exit Preview] │
└─────────────────────────────────────────────────────┘
```

- Background `#fffbeb`, border `#fde68a`, text `#92400e`
- Shows `targetProfile.name` and `targetProfile.roles.join(' · ')`
- "Exit Preview" calls `stopImpersonation()` → clears context, navigates to `/admin`
- Always visible regardless of which page is loaded beneath it

---

## New Routes

Added under the existing `admin` route in `App.tsx`:

```tsx
<Route path="preview">
  <Route path="student/:userId" element={<PreviewLayout role="student" />}>
    <Route index element={<StudentDashboard />} />
  </Route>
  <Route path="mentor/:userId" element={<PreviewLayout role="mentor" />}>
    <Route index element={<MentorDashboard />} />
  </Route>
  <Route index element={<PreviewPickerPage />} />
</Route>
```

No parallel sub-routes are needed for `/student/courses`, `/student/planner`, etc. Internal nav links within previewed dashboards naturally navigate to those existing routes, and the impersonation context persists across route changes — so all data fetching continues to use the target user's UID.

### PreviewLayout

Route-level wrapper (`pages/admin/PreviewLayout.tsx`):

1. Reads `:userId` from `useParams()`
2. Fetches `users/{userId}` from Firestore on mount
3. Calls `startImpersonation(userId, profile)` once loaded
4. Calls `stopImpersonation()` on unmount
5. Shows a loading state while fetching; renders `<Outlet />` when ready

---

## Entry Points

### 1. Admin Sidebar — Preview Dashboards

New nav entry in `AppShell` (admin nav section), below Reports:

```
👁 Preview Dashboards  →  /admin/preview
```

### 2. PreviewPickerPage (`/admin/preview`)

Lists all non-admin users from Firestore grouped by role (Students / Mentors). Each row shows name, email, and a "View Dashboard →" button that navigates to `/admin/preview/student/:userId` or `/admin/preview/mentor/:userId`.

### 3. UserManagement — "View Dashboard" Button

Each user card footer in `UserManagement.tsx` gets a new button:

```
[Edit]  [Reset PW]  [View Dashboard]  [Disable]
```

- Hidden for users whose only role is `admin`
- Navigates to `/admin/preview/mentor/:userId` for mentor-role users, `/admin/preview/student/:userId` for student-role users (mentor takes priority when both roles exist)

### 4. AdminDashboard — Quick Action

A "Preview Dashboards" entry added to the Quick Actions panel linking to `/admin/preview`.

---

## Data Flow

```
Admin clicks "View Dashboard" on user Alice (student)
  → navigate to /admin/preview/student/alice-uid
  → PreviewLayout fetches users/alice-uid from Firestore
  → startImpersonation("alice-uid", aliceProfile)
  → ImpersonationContext stores { targetUserId: "alice-uid", targetProfile: aliceProfile }
  → AppShell: shows Student nav + Preview banner ("Previewing as Alice Tan · student")
  → StudentDashboard renders via useEffectiveAuth()
      → uid = "alice-uid"  (target)
      → profile = aliceProfile
      → Firestore queries run with admin's auth token but Alice's UID
  → Admin clicks "My Courses" → navigates to /student/courses
      → impersonation context still active → shows Alice's courses
  → Admin clicks "Exit Preview"
      → stopImpersonation() → clears context → navigate to /admin
      → AppShell: restores Admin nav, banner disappears
```

### Firestore Security Note

Reads and writes use the admin's auth token. Firestore Security Rules must allow admins to write to collections currently restricted to the owning student (e.g. `student_lesson_progress`, `student_daily_plans`). Existing admin reads of these collections already work (confirmed by AdminDashboard). Write rules may need a rule addition of the form:

```
allow write: if request.auth.token.roles.hasAny(['admin']);
```

This is a separate task from the frontend implementation and should be verified before marking the feature production-ready.

---

## File Map

| File | Status | Change |
|---|---|---|
| `src/context/ImpersonationContext.tsx` | New | Context, provider, `useImpersonation()`, `useEffectiveAuth()` |
| `src/components/AppShell.tsx` | Modified | Preview banner, effective-role nav logic |
| `src/App.tsx` | Modified | `ImpersonationProvider` wrap, `/admin/preview/*` routes |
| `src/pages/admin/PreviewLayout.tsx` | New | Fetches target profile, starts/stops impersonation |
| `src/pages/admin/PreviewPickerPage.tsx` | New | Lists students/mentors to pick for preview |
| `src/pages/admin/UserManagement.tsx` | Modified | "View Dashboard" button per card |
| `src/pages/admin/AdminDashboard.tsx` | Modified | "Preview Dashboards" quick action link |
| `src/pages/student/StudentDashboard.tsx` | Modified | `useAuth` → `useEffectiveAuth` |
| `src/pages/student/StudentCoursesPage.tsx` | Modified | same |
| `src/pages/student/StudentCourseView.tsx` | Modified | same |
| `src/pages/student/StudentDailyPlanner.tsx` | Modified | same |
| `src/pages/student/StudentHistory.tsx` | Modified | same |
| `src/pages/mentor/MentorDashboard.tsx` | Modified | same |
| `src/pages/mentor/MentorStudentProgress.tsx` | Modified | same |
| `src/pages/ProfilePage.tsx` | Modified | same |

---

## Non-Goals

- Impersonation does not persist across page refreshes (session-only, acceptable)
- No audit log of admin preview sessions (out of scope)
- Exam page (`/exam`) excluded from preview — destructive/timed context
- No support for impersonating another admin account

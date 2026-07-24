# Admin Delegation for Mentor Users — Design Spec

**Date:** 2026-07-24  
**Status:** Approved  
**Scope:** Allow users with the `mentor` role to perform select admin tasks (initially: view and create students) via an admin-assigned delegation model.

---

## Problem

Mentors currently cannot create or view students. The only way to grant this is to assign the `admin` role, which gives full administrative access — too broad. We need a way for admins to delegate specific capabilities to mentors without elevating their role.

---

## Chosen Approach: Admin Delegation (`delegatedPermissions`)

A new `delegatedPermissions: string[]` field on the Firestore user document. Only admins can write this field. Delegated mentors get access to specific pages and callables without gaining any other admin privileges.

Rejected alternatives:
- **Dual-role (`roles: ['mentor', 'admin']`)** — gives full admin access, no way to restrict to select tasks; navigation UX breaks.
- **Capability flags on all users** — same mechanics as delegation but lacks the admin-only write guard, which is the key safety property here.

---

## Data Model

### `types.ts`

```ts
export type DelegatedPermission = 'manageStudents'

export interface UserProfile {
  // existing fields unchanged
  roles: Role[]
  // new optional field
  delegatedPermissions?: DelegatedPermission[]
}
```

`DelegatedPermission` is a union type. Future values (`'manageCourses'`, `'viewReports'`, etc.) are added here. The field is optional and omitted for users without delegations — no migration needed.

### What `'manageStudents'` grants

| Action | Delegated mentor | Full admin |
|---|---|---|
| View students list | ✅ | ✅ |
| Create student | ✅ | ✅ |
| Edit student profile | ✅ | ✅ |
| Disable student | ❌ | ✅ |
| Delete student | ❌ | ✅ |

---

## AuthContext / `useAuth`

Two new helpers added to the context value, derived from the Firestore profile at login — no extra fetch:

```ts
// Returns true if the user has this specific delegation
isDelegated: (permission: DelegatedPermission) => boolean

// Returns true if the user is a full admin OR has this delegation
// This is the primary check used in components and pages
canManage: (permission: DelegatedPermission) => boolean
```

Implementation in `AuthContext.tsx`:

```ts
const isDelegated = (p: DelegatedPermission) =>
  (profile?.delegatedPermissions ?? []).includes(p)

const canManage = (p: DelegatedPermission) =>
  profile?.roles.includes('admin') || isDelegated(p)
```

`useEffectiveAuth` (if used for impersonation) must also forward `delegatedPermissions` from the impersonated profile.

---

## Firestore Security Rules

### New helper function

```js
function hasDelegation(perm) {
  let u = get(/databases/$(database)/documents/users/$(request.auth.uid)).data;
  return 'delegatedPermissions' in u && perm in u.delegatedPermissions;
}
```

### Write guard on `/users/{uid}`

Only admins may write the `delegatedPermissions` field. The existing self-update allowance (name, firstLogin) must explicitly exclude this field:

```js
allow update: if isAdmin()
  || (
    !request.resource.data.keys().hasAny(['delegatedPermissions'])
    && request.resource.data.diff(resource.data).affectedKeys()
         .hasOnly(['name', 'firstLogin'])
  );
```

### `/users/{uid}` rule changes

Students are user documents in the `/users` collection with `roles: ['student']`. The existing read/write rules are extended:

```js
// Read: admins, the user themselves, and delegated mentors viewing students
allow read: if isAdmin()
  || request.auth.uid == uid
  || (hasDelegation('manageStudents') && 'student' in resource.data.roles);

// Create: admins or delegated mentors (payload role-restriction enforced in Cloud Function)
allow create: if isAdmin() || hasDelegation('manageStudents');

// Update: admins or delegated mentors (for student profile edits)
allow update: if isAdmin()
  || hasDelegation('manageStudents')
  || (request.auth.uid == uid && request.resource.data.diff(resource.data)
        .affectedKeys().hasOnly(['name', 'firstLogin']));

// Delete: admin only (disable/delete actions)
allow delete: if isAdmin();
```

---

## Cloud Functions (`functions/src/index.ts`)

### New assertion helper

```ts
async function assertAdminOrDelegated(
  uid: string,
  permission: DelegatedPermission
): Promise<void> {
  const snap = await db.doc(`users/${uid}`).get()
  const data = snap.data()
  const roles = coerceRoles(data)
  const delegated: string[] = data?.delegatedPermissions ?? []

  const status = data?.status
  const isAdmin = roles.includes('admin') && status === 'active'
  const hasDelegation = delegated.includes(permission) && status === 'active'

  if (!isAdmin && !hasDelegation) {
    throw new HttpsError(
      'permission-denied',
      `Requires admin role or delegation: ${permission} (has roles: ${roles.join(',')}, delegations: ${delegated.join(',')})`
    )
  }
}
```

### Callable changes

| Callable | Before | After |
|---|---|---|
| `adminCreateUser` (when creating students) | `assertAdmin()` | `assertAdminOrDelegated(uid, 'manageStudents')` |
| All other admin callables | `assertAdmin()` | unchanged |

The `adminCreateUser` callable must verify the payload `roles` field only contains `['student']` when called by a delegated (non-admin) mentor — delegated mentors cannot create admins or other mentors.

---

## Navigation Sidebar (`AppShell.tsx`)

The mentor sidebar is unchanged. A new "Admin Access" section appears below mentor nav only when the user has active delegations:

```tsx
{isMentor && (
  <>
    {/* existing mentor nav — no change */}
  </>
)}

{canManage('manageStudents') && !isAdmin && (
  <NavSection label="Admin Access">
    <NavLink to="/admin/students">
      Students
    </NavLink>
  </NavSection>
)}
```

Full admins already see the admin nav in full — the delegated section is suppressed for them (`!isAdmin`) to avoid duplication.

---

## Students Page (`StudentsPage.tsx`)

Replace the existing `isAdmin` guard with `canManage('manageStudents')`:

```ts
// Before
const isAdmin = Boolean(profile?.roles.includes('admin'))

// After
const { canManage, isAdmin } = useAuth()
const canManageStudents = canManage('manageStudents')
```

UI guards:
- Page access, student list, create button: guarded by `canManageStudents`
- Disable / delete actions: guarded by `isAdmin` (unchanged)
- Notice text: updated to mention delegation as an alternative to admin role

---

## Admin UI — Assigning Delegations

On the existing admin user-edit panel (or a new "Permissions" tab), a checkbox group for mentors:

```
Delegated Permissions
[ ] Manage Students  — can view and create students
```

This section is only visible when editing a user with `roles: ['mentor']`. It submits via `adminUpdateUser` with the updated `delegatedPermissions` array. The callable uses `assertAdmin()` — only full admins can assign delegations.

---

## What Does Not Change

- `normalizeRoles` and role coercion logic
- All existing `assertAdmin()` callables (other than student creation)
- Admin nav and mentor nav structure
- `hasRole()` Firestore rule function
- Student, course, session, and planning-level rules (unless students are stored as `/users` docs — see Firestore section above)
- Any page outside the student management flow

---

## File Change Summary

| File | Change |
|---|---|
| `platform/src/types.ts` | Add `DelegatedPermission` type, add field to `UserProfile` |
| `platform/src/context/AuthContext.tsx` | Add `isDelegated`, `canManage` helpers |
| `platform/src/components/AppShell.tsx` | Add delegated nav section |
| `platform/src/pages/admin/StudentsPage.tsx` | Replace `isAdmin` guard with `canManage` |
| `platform/src/pages/admin/UserEditPage.tsx` | Add delegation checkbox UI |
| `platform/src/lib/adminGcfCallables.ts` | Add `delegatedPermissions` to update payload type |
| `functions/src/index.ts` | Add `assertAdminOrDelegated`, update `adminCreateUser` |
| `firestore.rules` | Add `hasDelegation()`, write guard, update student rules |

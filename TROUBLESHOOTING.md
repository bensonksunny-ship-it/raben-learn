# Cloud Functions Auth Error - Troubleshooting Guide

## Problem Summary
Getting `functions/internal: internal` error when trying to create student users.

**Root Cause Found:** ❌ **User is NOT logged in** → Auth token is missing

---

## Quick Fix Checklist

### 1. **Verify You're Logged In**
- Open https://raben-learn.web.app
- Look for a login form or user profile in the top-right
- **If you see a login page:** Sign in first!
- **If you're already logged in:** Go to step 2

### 2. **Verify Your User Account Exists**
- Open [Firebase Console](https://console.firebase.google.com/project/raben-learn/authentication)
- Go to **Authentication** → **Users**
- Look for your email (e.g., bensonksunny@gmail.com)
- If NOT found → Create your account first

### 3. **Verify You Have Admin Role in Firestore**
This is critical! The `adminCreateUser` function checks your admin role.

**Steps:**
1. Open [Firebase Console](https://console.firebase.google.com/project/raben-learn/firestore)
2. Go to **Firestore** → **Data**
3. Click on **users** collection
4. Find your user document (matches your auth UID)
5. Check the `roles` array - it should contain `"admin"` (case-sensitive!)

**Example of correct document:**
```json
{
  "name": "Your Name",
  "email": "you@example.com",
  "roles": ["admin"],
  "status": "active",
  "firstLogin": false
}
```

If the `roles` array is missing or doesn't contain `"admin"`:
- Ask an existing admin to update your roles
- OR manually create/update it in the Firestore console

### 4. **Verify Status is "active"**
- In your user document (step 3), check that `status` field equals `"active"`
- If it's `"disabled"` or missing, update it to `"active"`

### 5. **Clear Browser Cache & Try Again**
- Hard refresh: **Cmd+Shift+R** (Mac) or **Ctrl+Shift+F5** (Windows)
- Sign out and sign back in
- Try creating the student user again

---

## What Each Step Does

| Step | Checks | Error If Fails |
|------|--------|---|
| 1 | You're authenticated | "Auth token missing" |
| 2 | Your account exists in Firebase | "Auth user not found" |
| 3 | You have admin permissions | "Admin only" → "internal" |
| 4 | Your account is active | "User disabled" → "internal" |
| 5 | App has latest config | CORS/cache errors |

---

## Still Getting `functions/internal`?

**Check these in order:**

1. **Open Browser DevTools** (F12 → Console tab)
   - Look for any new error messages
   - Share the full error message

2. **Firebase Cloud Functions Logs**
   ```bash
   firebase functions:log
   ```
   - Share the last few error messages

3. **Check Firestore Rules**
   - Current rules require:
     - `isSignedIn()` - You must be logged in
     - `hasRole('admin')` - You must have admin role
     - `request.resource.data.status == 'active'` - Your status must be active

---

## Manual Fix: Bootstrap First Admin

If you have NO admins at all, you need to bootstrap one manually:

1. Create a user in [Firebase Auth Console](https://console.firebase.google.com/project/raben-learn/authentication)
2. Note the new user's UID (shown in the user list)
3. Go to **Firestore** → **Create collection** → `users`
4. Create a new document with ID = `{UID from step 2}`
5. Set this data:
```json
{
  "name": "Admin User",
  "email": "admin@example.com",
  "roles": ["admin"],
  "status": "active",
  "firstLogin": false,
  "courseIds": []
}
```
6. Sign in with that email
7. Now you can create other users

---

## Firebase Console Links

- [Authentication Users](https://console.firebase.google.com/project/raben-learn/authentication)
- [Firestore Data](https://console.firebase.google.com/project/raben-learn/firestore)
- [Cloud Functions Logs](https://console.firebase.google.com/project/raben-learn/functions)

---

## Problem Still Not Solved?

Please share:
1. Your email address (what you sign in with)
2. Browser console error message (full text)
3. Output of: `firebase functions:log` (last 10 lines)

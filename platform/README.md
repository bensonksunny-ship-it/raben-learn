# Learning platform (RBAC)

React + Vite + Firebase Auth + Firestore + Cloud Functions (callable admin APIs).

## Setup

1. Create a Firebase project and enable **Authentication → Email/Password** and **Firestore**.
2. Copy `platform/.env.example` to `platform/.env.local` and paste your web app config.
3. Deploy Firestore rules from repo root:

   ```bash
   firebase deploy --only firestore:rules
   ```

4. Deploy Cloud Functions (requires Blaze plan for callable functions):

   ```bash
   cd functions && npm install && npm run build
   cd .. && firebase deploy --only functions
   ```

5. Create the first admin user manually in Firebase Auth, then add a matching document in Firestore:

   - Collection: `users`
   - Document ID: **same UID** as the Auth user
   - Fields: `name`, `email`, `role: "admin"`, `status: "active"`, `firstLogin: false`, `centreIds: []`, `centreId: null`, `courseId: null`, `createdAt` (timestamp)

6. Run the app locally:

   ```bash
   npm install
   npm run dev
   ```

## Roles

- **admin**: user management (via Cloud Functions), centres, courses, lessons, reports.
- **mentor**: centres list, students in assigned centres, manual progress %.
- **student**: lessons for assigned course, item completion, auto progress %.

## Deploy hosting (optional)

From repo root:

```bash
cd platform && npm run build && cd ..
firebase deploy --only hosting
```

Ensure `firebase.json` `hosting.public` points to `platform/dist`.

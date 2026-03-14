# Blueprint Planner

Desktop-first Ionic Vue app for blueprint planning across floors and reusable engineering layers, with Firebase-backed auth, multi-project workspaces, and save-version management.

## What it does

- Uses a hardcoded plot, building boundary, and fixed cores as the base shell
- Lets you plan with reusable templates for structural, plumbing, fire safety, electrical, and custom layers
- Supports generic point, polyline, and polygon entities
- Adds multi-project dashboards with archive/recover flows
- Adds save-version management with Save As forks and archived saves
- Uses Firebase Auth-backed username/password login
- Exports the current floor to PDF
- Saves planner state to Firestore when Firebase web config is supplied
- Keeps PDF exports local to the browser and logs export metadata in Firestore

## Development

```bash
npm install
npm run dev
```

## Testing

```bash
npm test
```

## Firebase setup

1. Create a Firebase project and enable Firestore, Hosting, and Email/Password Authentication.
2. Copy `.env.example` to `.env.local`.
3. Fill in the Firebase web app config values.
4. Deploy with the Firebase CLI once you have a project selected.

## Default seeded users

The app bootstraps these two accounts at startup when Firebase is configured:

- `aditya / greatest` (admin)
- `anil / greatest` (standard user)

The `aditya` account is the initial admin and can create users plus manage project membership.

## Security note

This implementation relies on Firebase Auth and Firestore rules. Before using it in production, verify the seeded-user bootstrap and Firestore rules against your deployment workflow.

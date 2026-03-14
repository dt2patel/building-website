# Blueprint Planner

Desktop-first Ionic Vue app for blueprint planning across floors and reusable engineering layers.

## What it does

- Uses a hardcoded plot, building boundary, and fixed cores as the base shell
- Lets you plan with reusable templates for structural, plumbing, fire safety, electrical, and custom layers
- Supports generic point, polyline, and polygon entities
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

1. Create a Firebase project and enable Firestore and Hosting.
2. Copy `.env.example` to `.env.local`.
3. Fill in the Firebase web app config values.
4. Deploy with the Firebase CLI once you have a project selected.

## Security note

This implementation follows the agreed prototype assumption: no auth in v1. Until Firebase Auth and restrictive rules are added, any deployed Firebase-backed instance should be treated as insecure.

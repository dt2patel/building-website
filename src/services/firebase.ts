import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getFirestore, type Firestore } from 'firebase/firestore'

interface FirebaseServices {
  app: FirebaseApp
  db: Firestore
}

let cachedServices: FirebaseServices | null = null

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export function isFirebaseConfigured(): boolean {
  return Object.values(firebaseConfig).every(Boolean)
}

export function getFirebaseServices(): FirebaseServices | null {
  if (!isFirebaseConfigured()) {
    return null
  }

  if (cachedServices) {
    return cachedServices
  }

  const app = initializeApp(firebaseConfig)
  cachedServices = {
    app,
    db: getFirestore(app),
  }

  return cachedServices
}

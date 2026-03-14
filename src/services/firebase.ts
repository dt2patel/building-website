import {
  deleteApp,
  initializeApp,
  type FirebaseApp,
  type FirebaseOptions,
} from 'firebase/app'
import {
  getAuth,
  type Auth,
} from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'

interface FirebaseServices {
  app: FirebaseApp
  auth: Auth
  db: Firestore
}

let cachedServices: FirebaseServices | null = null

const firebaseConfig: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export function getFirebaseConfig(): FirebaseOptions {
  return firebaseConfig
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
    auth: getAuth(app),
    db: getFirestore(app),
  }

  return cachedServices
}

export async function createSecondaryAuthServices(name: string) {
  if (!isFirebaseConfigured()) {
    return null
  }

  const app = initializeApp(firebaseConfig, name)
  return {
    app,
    auth: getAuth(app),
    cleanup: async () => {
      await deleteApp(app)
    },
  }
}

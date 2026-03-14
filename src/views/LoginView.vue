<script setup lang="ts">
import { IonContent, IonPage } from '@ionic/vue'
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/authStore'

const auth = useAuthStore()
const router = useRouter()
const username = ref('aditya')
const password = ref('greatest')

async function submit() {
  try {
    await auth.login(username.value, password.value)
    await router.replace({ name: 'projects' })
  } catch {
    return
  }
}
</script>

<template>
  <ion-page>
    <ion-content :fullscreen="true">
      <main class="auth-shell">
        <section class="auth-card">
          <p class="eyebrow">Blueprint Planner</p>
          <h1>Sign In</h1>
          <p class="muted auth-copy">
            Use the seeded credentials to get started. `aditya / greatest` is the default admin account.
          </p>

          <label class="field">
            <span>Username</span>
            <input v-model="username" name="username" type="text" autocomplete="username" />
          </label>

          <label class="field">
            <span>Password</span>
            <input v-model="password" name="password" type="password" autocomplete="current-password" />
          </label>

          <p v-if="auth.errorMessage" class="form-error">{{ auth.errorMessage }}</p>

          <button class="button button--primary auth-submit" :disabled="auth.loading" @click="submit">
            {{ auth.loading ? 'Signing in...' : 'Sign in' }}
          </button>
        </section>
      </main>
    </ion-content>
  </ion-page>
</template>

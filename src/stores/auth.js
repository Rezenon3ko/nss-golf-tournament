import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { ADMIN_PASSWORD, ADMIN_EMAIL, AUTH_STORAGE_KEY, AUTH_TTL_MS, USE_SUPABASE } from '@/config'
import { supabase } from '@/lib/supabase'

function now() {
  return Date.now()
}

function readLocalSession() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || !parsed.at) return null
    if (now() - parsed.at > AUTH_TTL_MS) {
      localStorage.removeItem(AUTH_STORAGE_KEY)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export const useAuthStore = defineStore('auth', () => {
  const session = ref(null)
  const initialized = ref(false)

  const isAdmin = computed(() => !!session.value)

  async function init() {
    if (USE_SUPABASE && supabase) {
      const { data } = await supabase.auth.getSession()
      session.value = data.session ? { at: now() } : null
    } else {
      session.value = readLocalSession()
    }
    initialized.value = true
  }

  async function login(password) {
    if (USE_SUPABASE && supabase) {
      const { error } = await supabase.auth.signInWithPassword({
        email: ADMIN_EMAIL,
        password: String(password ?? ''),
      })
      if (error) return false
      session.value = { at: now() }
      return true
    }
    if (String(password ?? '') !== ADMIN_PASSWORD) {
      return false
    }
    session.value = { at: now() }
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session.value))
    return true
  }

  async function logout() {
    if (USE_SUPABASE && supabase) {
      await supabase.auth.signOut()
    }
    localStorage.removeItem(AUTH_STORAGE_KEY)
    session.value = null
  }

  return {
    isAdmin,
    initialized,
    init,
    login,
    logout,
  }
})

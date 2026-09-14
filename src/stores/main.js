import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useMainStore = defineStore('main', () => {
  const userName = ref('n3ko')
  const userEmail = ref('n3ko@nss.local')

  const isFieldFocusRegistered = ref(false)

  function setUser(payload) {
    if (payload.name) {
      userName.value = payload.name
    }
    if (payload.email) {
      userEmail.value = payload.email
    }
  }

  return {
    userName,
    userEmail,
    isFieldFocusRegistered,
    setUser,
  }
})

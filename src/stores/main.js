import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useMainStore = defineStore('main', () => {
  const userName = ref('n3ko')

  return {
    userName,
  }
})

<script setup>
import { useFeedbackStore } from '@/stores/feedback'
import BaseIcon from '@/components/BaseIcon.vue'
import { mdiAlertCircle, mdiCheckCircle, mdiInformation, mdiAlertOutline } from '@mdi/js'

const feedback = useFeedbackStore()

const styleMap = {
  success: {
    icon: mdiCheckCircle,
    class:
      'border-[#b7e0c3] bg-[#e5f6ea] text-[#146c2e] dark:border-[#2c5540] dark:bg-[#142a1e] dark:text-[#7ec8a0]',
  },
  error: {
    icon: mdiAlertCircle,
    class:
      'border-[#f3c2c2] bg-[#fdecec] text-[#a12222] dark:border-[#5c2b2b] dark:bg-[#3d2020] dark:text-[#f0b4b4]',
  },
  warn: {
    icon: mdiAlertOutline,
    class:
      'border-[#f0d9a0] bg-[#fef7d6] text-[#793400] dark:border-[#5c4a1e] dark:bg-[#2b2415] dark:text-[#e6d5a8]',
  },
  info: {
    icon: mdiInformation,
    class:
      'border-[#cfe0f5] bg-[#eef4fc] text-[#1d4b82] dark:border-[#2f4a68] dark:bg-[#16222f] dark:text-[#9dc0e6]',
  },
}

function toastStyle(type) {
  return styleMap[type] || styleMap.info
}
</script>

<template>
  <div
    class="pointer-events-none fixed inset-x-3 top-3 z-[130] flex flex-col items-center gap-2 sm:right-auto sm:left-1/2 sm:w-[26rem] sm:-translate-x-1/2"
    role="status"
    aria-live="polite"
  >
    <button
      v-for="toast in feedback.toasts"
      :key="toast.id"
      type="button"
      class="pointer-events-auto flex w-full items-start gap-2 rounded-xl border px-4 py-2.5 text-left text-sm font-medium shadow-[rgba(15,15,15,0.16)_0px_12px_32px_-8px] transition-opacity hover:opacity-80"
      :class="toastStyle(toast.type).class"
      :title="'点击关闭'"
      @click="feedback.dismiss(toast.id)"
    >
      <BaseIcon :path="toastStyle(toast.type).icon" size="18" class="mt-0.5 shrink-0" />
      <span class="leading-relaxed">{{ toast.message }}</span>
    </button>
  </div>
</template>

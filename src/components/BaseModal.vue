<script setup>
import { mdiClose } from '@mdi/js'
import BaseIcon from '@/components/BaseIcon.vue'

defineProps({
  title: {
    type: String,
    default: '',
  },
  width: {
    type: String,
    default: 'max-w-2xl',
  },
})

const emit = defineEmits(['close'])
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-[#373158]/60 backdrop-blur-sm sm:p-4"
    @click.self="emit('close')"
  >
    <div
      class="flex h-full w-full flex-col overflow-hidden bg-white shadow-[rgba(15,15,15,0.16)_0px_16px_48px_-8px] dark:bg-[#1e1e1e] sm:h-auto sm:max-h-[92vh] sm:rounded-xl"
      :class="width"
    >
      <div
        class="flex items-center justify-between border-b border-[#e5e3df] px-5 py-4 dark:border-[#3d3d3d]"
      >
        <h3 class="text-lg font-bold">{{ title }}</h3>
        <button
          class="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-[#f0eeec] dark:hover:bg-[#2a2a2a]"
          type="button"
          @click="emit('close')"
        >
          <BaseIcon :path="mdiClose" size="20" />
        </button>
      </div>
      <div class="overflow-y-auto px-5 py-4">
        <slot />
      </div>
      <div
        v-if="$slots.footer"
        class="flex justify-end gap-2 border-t border-[#e5e3df] px-5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 dark:border-[#3d3d3d]"
      >
        <slot name="footer" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted } from 'vue'
import { useFeedbackStore } from '@/stores/feedback'
import BaseModal from '@/components/BaseModal.vue'
import BaseButton from '@/components/BaseButton.vue'

const feedback = useFeedbackStore()

function onKeydown(event) {
  // 焦点在按钮上时交给按钮自己处理，避免「取消」被回车误触发
  if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
    event.preventDefault()
    feedback.settle(true)
  }
  if (event.key === 'Escape') feedback.settle(false)
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <BaseModal
    v-if="feedback.dialog"
    :title="feedback.dialog.title"
    width="max-w-md"
    @close="feedback.settle(false)"
  >
    <p class="text-sm leading-relaxed text-[#37352f] dark:text-[#e6e6e6]">
      {{ feedback.dialog.message }}
    </p>

    <template #footer>
      <BaseButton
        :label="feedback.dialog.cancelLabel"
        color="whiteDark"
        @click="feedback.settle(false)"
      />
      <BaseButton
        :label="feedback.dialog.confirmLabel"
        :color="feedback.dialog.danger ? 'danger' : 'purple'"
        @click="feedback.settle(true)"
      />
    </template>
  </BaseModal>
</template>

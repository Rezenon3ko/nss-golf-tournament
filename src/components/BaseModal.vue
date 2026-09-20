<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue'
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

// 无障碍：dialog 语义 + 焦点陷阱 + 背景滚动锁 + 关闭后焦点归位
const panel = ref(null)
const titleId = `modal-title-${useId()}`
let previouslyFocused = null

let lockCount = 0
let savedOverflow = ''
let savedPadding = ''

function lockScroll() {
  if (typeof document === 'undefined') return
  if (lockCount === 0) {
    const { body } = document
    savedOverflow = body.style.overflow
    savedPadding = body.style.paddingRight
    const gap = window.innerWidth - document.documentElement.clientWidth
    body.style.overflow = 'hidden'
    if (gap > 0) body.style.paddingRight = `${gap}px`
  }
  lockCount += 1
}

function unlockScroll() {
  if (typeof document === 'undefined') return
  lockCount = Math.max(0, lockCount - 1)
  if (lockCount === 0) {
    document.body.style.overflow = savedOverflow
    document.body.style.paddingRight = savedPadding
  }
}

function focusables() {
  if (!panel.value) return []
  return Array.from(
    panel.value.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => el.offsetParent !== null)
}

function close() {
  emit('close')
}

function onKeydown(event) {
  if (event.key === 'Escape') {
    event.stopPropagation()
    close()
    return
  }
  if (event.key !== 'Tab') return

  const items = focusables()
  if (!items.length) {
    event.preventDefault()
    return
  }
  const first = items[0]
  const last = items[items.length - 1]
  const active = document.activeElement
  const inside = panel.value?.contains(active)

  if (event.shiftKey && (!inside || active === first)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (!inside || active === last)) {
    event.preventDefault()
    first.focus()
  }
}

onMounted(async () => {
  previouslyFocused = document.activeElement
  lockScroll()
  await nextTick()
  panel.value?.focus()
})

onBeforeUnmount(() => {
  unlockScroll()
  if (previouslyFocused?.focus) previouslyFocused.focus()
})
</script>

<template>
  <div
    class="fixed inset-0 z-[120] flex items-center justify-center bg-[#373158]/60 backdrop-blur-sm sm:p-4"
    @click.self="close()"
  >
    <div
      ref="panel"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      tabindex="-1"
      class="flex h-full w-full flex-col overflow-hidden bg-white shadow-[rgba(15,15,15,0.16)_0px_16px_48px_-8px] sm:h-auto sm:max-h-[92vh] sm:rounded-xl dark:bg-[#1e1e1e]"
      :class="width"
      @keydown="onKeydown"
    >
      <div
        class="flex items-center justify-between border-b border-[#e5e3df] px-5 py-4 dark:border-[#3d3d3d]"
      >
        <h3 :id="titleId" class="text-lg font-bold">{{ title }}</h3>
        <button
          class="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-[#f0eeec] dark:hover:bg-[#2a2a2a]"
          type="button"
          aria-label="关闭"
          @click="close"
        >
          <BaseIcon :path="mdiClose" size="20" />
        </button>
      </div>
      <div class="overflow-y-auto px-5 py-4">
        <slot />
      </div>
      <div
        v-if="$slots.footer"
        class="flex justify-end gap-2 border-t border-[#e5e3df] px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] dark:border-[#3d3d3d]"
      >
        <slot name="footer" />
      </div>
    </div>
  </div>
</template>

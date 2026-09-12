<script setup>
import { GROUPS } from '@/stores/tournament'

defineProps({
  modelValue: {
    type: String,
    default: 'A',
  },
})

const emit = defineEmits(['update:modelValue'])

// 与首页积分榜卡片同款组色
const groupTint = {
  A: 'bg-[#e6e0f5] text-[#37352f] dark:bg-[#7469a6] dark:text-[#cfc8e0]',
  B: 'bg-[#d9f3e1] text-[#37352f] dark:bg-[#6b7f72] dark:text-[#c8dccf]',
  C: 'bg-[#dcecfa] text-[#37352f] dark:bg-[#6b7890] dark:text-[#c8d6e6]',
  D: 'bg-[#ffe8d4] text-[#37352f] dark:bg-[#8c7363] dark:text-[#e6d8ca]',
}
</script>

<template>
  <div class="flex flex-wrap gap-2">
    <button
      v-for="g in GROUPS"
      :key="g"
      type="button"
      class="rounded-full px-4 py-1.5 text-sm font-semibold transition-colors"
      :class="
        modelValue === g
          ? groupTint[g]
          : 'bg-[#f6f5f4] text-[#37352f] hover:bg-[#e8e6e2] dark:bg-[#333333] dark:text-[#c7c7c7] dark:hover:bg-[#3d3d3d]'
      "
      @click="emit('update:modelValue', g)"
    >
      {{ g }} 组
    </button>
  </div>
</template>

<script setup>
import { GROUPS } from '@/stores/tournament'
import { groupChipClass } from '@/lib/groupColors'

defineProps({
  modelValue: {
    type: String,
    default: 'A',
  },
})

const emit = defineEmits(['update:modelValue'])

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
          ? groupChipClass(g)
          : 'bg-[#f6f5f4] text-[#37352f] hover:bg-[#e8e6e2] dark:bg-[#333333] dark:text-[#c7c7c7] dark:hover:bg-[#3d3d3d]'
      "
      @click="emit('update:modelValue', g)"
    >
      {{ g }} 组
    </button>
  </div>
</template>

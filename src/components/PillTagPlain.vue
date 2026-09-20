<script setup>
defineProps({
  label: {
    type: String,
    required: true,
  },
  small: Boolean,
})
</script>

<template>
  <div
    class="inline-flex items-center leading-none whitespace-nowrap capitalize"
    :class="[small ? 'text-xs' : 'text-sm']"
  >
    <span>{{ label }}</span>
  </div>
</template>

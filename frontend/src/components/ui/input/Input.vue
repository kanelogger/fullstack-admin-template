<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "@/lib/utils";

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  class?: HTMLAttributes["class"];
  modelValue?: string | number;
  modelModifiers?: { number?: boolean };
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string | number];
}>();

function updateValue(event: Event) {
  const input = event.target as HTMLInputElement;
  const value = input.value;
  const shouldCast = input.type === "number" || props.modelModifiers?.number;
  const parsed = Number.parseFloat(value);
  emit(
    "update:modelValue",
    shouldCast && !Number.isNaN(parsed) ? parsed : value
  );
}
</script>

<template>
  <input
    v-bind="$attrs"
    :value="props.modelValue"
    :class="cn('flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50', props.class)"
    @input="updateValue"
  />
</template>

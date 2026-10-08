<!--
  `PublicFooter` — shared public footer: brand và copyright tĩnh.

  Footer deterministic: không runtime fetch, không dependency backend, không
  Date (không hydration mismatch theo thời gian), không application-specific
  content. Legal/product link chỉ thêm vào đây khi architecture hiện tại cần
  — hiện tại không cần nên không có.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { localeRootHref } from '../locale-root-href';
import type { PublicLayoutPathResult } from '../public-layout-path';

const { layout } = defineProps<{ readonly layout: PublicLayoutPathResult }>();

/** Brand về bề mặt root của locale hiện tại; `root`/`invalid` → `/`. */
const homeHref = computed<string>((): string => localeRootHref(layout));
</script>

<template>
  <footer>
    <a :href="homeHref">ecoma.io</a>
    <p>© ecoma.io</p>
  </footer>
</template>

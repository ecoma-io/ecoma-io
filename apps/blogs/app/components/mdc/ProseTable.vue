<!--
  Bọc `<table>` do Markdown sinh trong một scroll container.

  `overflow-x` bị trình duyệt bỏ qua trên chính `<table>` (`display: table`),
  và đặt `display: block` lên table bằng CSS sẽ làm mất table semantics cho
  screen reader. Cách đúng: giữ `<table>` nguyên vẹn, bọc nó trong một
  `<div>` scrollable — đúng pattern đã xác minh ở `apps/docs`.
-->
<template>
  <div class="my-6 max-w-full overflow-x-auto">
    <slot />
  </div>
</template>

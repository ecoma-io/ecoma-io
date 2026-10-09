<template>
  <!--
    Override `ProseTable` của `@nuxtjs/mdc` (mặc định chỉ là `<table><slot /></table>`).

    Bảng Markdown có thể rộng hơn cột nội dung, và `overflow-x` **không** có tác
    dụng trên chính phần tử `<table>`: trình duyệt bỏ qua `overflow` cho
    `display: table`, nên cách sửa bằng CSS trên `table` chỉ là no-op. Cách còn
    lại — đặt `display: block` lên `<table>` — làm mất table semantics đối với
    một số screen reader (Safari/VoiceOver), đúng thứ mà accessibility của docs
    cần giữ. Vì vậy bọc `<table>` trong một scroll container thật, giữ nguyên
    `<table>` là bảng thật.

    `@nuxtjs/mdc` tự đăng ký thư mục `components/mdc/` của app ở ưu tiên cao
    nhất, nên file này thay thế component prose mặc định mà không cần patch
    upstream (xem `@nuxtjs/mdc` `dist/module.mjs`, hook `components:dirs`).
  -->
  <div class="my-6 w-full max-w-full overflow-x-auto">
    <table class="w-full text-sm">
      <slot />
    </table>
  </div>
</template>

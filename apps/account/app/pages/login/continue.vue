<script setup lang="ts">
/**
 * `/login/continue` — bàn giao sang dịch vụ uỷ quyền.
 *
 * ⚠️ Trang này **không** phải phần protocol. Nó không đọc `code`, không đổi
 * `state`, không biết `redirect_uri`, và không dựng URL nào. `auth` sở hữu
 * authorization transaction và là bên duy nhất tạo redirect cuối
 * (`01-architecture.md` §5.1.1); trang này chỉ là chỗ để BFF hoàn tất việc bàn giao
 * và để người dùng thấy kết quả.
 *
 * ⚠️ Vì vậy bước bàn giao **chưa** được nối vào trong PR này: không có endpoint BFF
 * nào được chốt, và bịa ra một `fetch` tới `/api/login/complete` sẽ tạo ra một
 * contract mà không ai đã ký. Vậy nên trang render đúng hai trạng thái mà adapter
 * có thể trả, và nói thẳng với người dùng khi nó không hoàn tất — thay vì quay
 * vòng vòng. Đây là phần chờ contract BFF, đã ghi trong handoff của PR.
 *
 * ⚠️ Handle continuation **không** được đọc, không được render, không xuất hiện
 * trong DOM. Trang này chưa nối bàn giao (chưa có contract BFF), nên không có chỗ
 * nào cần nó; và ngay cả khi có, đưa nó vào DOM là một đường rò: nó nằm trong HTML
 * SSR, trong view-source, trong cây accessibility và trong mọi script quét DOM —
 * đúng thứ FR-006k3 cấm. Chỉ chính luồng bàn giao đã thiết lập mới mang nó đi.
 */
definePageMeta({ layout: 'auth' });

const i18n = useI18n();

/**
 * Bàn giao đã hoàn tất hay chưa.
 *
 * `false` là giá trị duy nhất hiện được, và nó **đúng**: khi contract BFF chốt,
 * trạng thái thật sẽ do nó cấp. Đặt `true` để "cho xong" là tuyên bố một thứ chưa
 * xảy ra.
 */
const handoffComplete = ref(false);
</script>

<template>
  <section class="account-card space-y-5 p-6 text-center" data-testid="login-continue-card">
    <template v-if="handoffComplete">
      <h1 class="text-xl font-semibold tracking-tight text-foam">
        {{ i18n.t('loginContinue.title') }}
      </h1>
      <p class="text-sm text-muted">{{ i18n.t('loginContinue.body') }}</p>
    </template>

    <template v-else>
      <h1 class="text-xl font-semibold tracking-tight text-foam">
        {{ i18n.t('loginContinue.errorTitle') }}
      </h1>
      <p class="text-sm text-muted">{{ i18n.t('loginContinue.errorBody') }}</p>
      <NuxtLink to="/login" class="account-button-primary" data-testid="login-continue-retry">
        {{ i18n.t('loginContinue.retry') }}
      </NuxtLink>
    </template>
  </section>
</template>

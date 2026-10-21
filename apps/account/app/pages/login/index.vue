<script setup lang="ts">
/**
 * `/login` — đăng nhập passwordless.
 *
 * ⚠️ **Không có ô mật khẩu, không có liên kết "quên mật khẩu", không có trang đặt
 * lại.** Ecoma là passwordless và sẽ giữ nguyên như vậy. `login.noPasswordNote`
 * nói thẳng để người dùng không phải tìm chỗ đó, và không có markup nào trên trang
 * này chứa `type="password"` hay từ khoá `password` trong `href`.
 *
 * ⚠️ **Không có nút đăng nhập bằng passkey.** Tài liệu chưa chốt passkey là đường
 * đăng nhập chính, nên trang không đề nghị nó.
 *
 * ⚠️ **Bước nhập mã chỉ render khi adapter nói `'code'`.** Tài liệu chưa chốt cơ
 * chế challenge (`01-architecture.md` §10), nên UI không đoán: `LoginChallenge.mode`
 * là đầu vào, và mặc định của bản mock là `email-link` — chế độ không có bước nhập
 * mã. `login-flow.spec.ts` chạy cả hai chế độ để chứng minh điều đó.
 *
 * ⚠️ **Continuation handle không bị đụng.** `?handle=X` do `auth` đưa tới và được
 * chuyển tiếp nguyên vẹn trong `continue_handoff`, không đọc, không diễn giải, không
 * log, không đưa vào storage, không dán vào link khác. Adapter thật nhận nó ở
 * lúc bàn giao qua `POST /api/auth/handoff` (server push
 * `/internal/session/verified` về `auth`); bản mock không có BFF nên bàn giao
 * giả lập chỉ giữ nguyên trạng thái.
 *
 * ⚠️ **Bàn giao sau khi mã được chấp nhận.** Khi `continuationHandle` tồn tại,
 * trang gọi `adapter.completeHandoff(handle)` ngay sau verify thành công và
 * relay `continueUrl` bằng điều hướng browser (`window.location.assign`) — URL
 * do `auth` dựng, trang KHÔNG tự ghép chuỗi hay thêm tham số. Khi handoff thất
 * bại, người dùng thấy thông báo retry (mã OTP đã dùng; BFF push idempotent ⇒
 * thử lại an toàn). Không handle ⇒ đăng nhập account thuần, giữ nguyên accepted.
 */
import type { LoginChallenge } from '../../account-data/types';

definePageMeta({ layout: 'auth' });

const i18n = useI18n();
const adapter = useAccountAdapter();
const route = useRoute();

const email = ref('');
const submitting = ref(false);
const requestFailed = ref(false);
const challenge = ref<LoginChallenge | undefined>(undefined);
const code = ref('');
const codeFailed = ref(false);

/**
 * Trạng thái bàn giao (handoff) sau khi mã được chấp nhận.
 *
 * `handoffFailed` cho phép retry; `handoffUnavailable` (mock) hiển thị dòng
 * giải thích mà không hứa một URL tiếp theo nào — mock KHÔNG báo thành công.
 */
const handoffFailed = ref(false);
const handoffUnavailable = ref(false);

/**
 * Mã đã được chấp nhận hay chưa.
 *
 * ⚠️ Tách khỏi `codeFailed`: `codeFailed = false` không phân biệt được "mã đúng"
 * với "chưa bấm". Trước khi có trạng thái này, `verifyLoginCode` trả `ok: true`
 * không đổi gì trên màn hình — người dùng bấm "Đăng nhập" rồi im lặng, và không
 * có cách nào biết bước này đã xong. Chuyển hướng sang `/login/continue` là việc
 * của BFF (hợp đồng chưa có), nhưng **phản hồi** thì không được chờ.
 */
const codeAccepted = ref(false);

/**
 * Đã gửi lại email thành công hay chưa.
 *
 * ⚠️ Phải là trạng thái **riêng**, không dùng lại `challenge`: gửi lại thành công
 * làm `challenge` được ghi giá trị mới, nhưng người dùng cần thấy một câu xác nhận
 * "đã gửi lại" — im lặng sau khi bấm nút khiến họ bấm lần nữa. Reset ở cả ba chỗ:
 * bắt đầu gửi mới, gửi lại thành công, và `startOver`.
 */
const resendSent = ref(false);

/**
 * Handle continuation do `auth` cấp trong `continue_url`
 * (`docs/services/auth/01-architecture.md` §5.1.1).
 *
 * Đọc bằng `route.query.handle` và giữ nguyên **chuỗi** — không parse, không kiểm
 * tra định dạng, không so với bất kỳ danh sách nào. Handle là giá trị opaque; mọi
 * kiểm tra cục bộ về nó đều là giả định sai về nội dung của một thứ không được
 * phép đoán.
 *
 * ⚠️ Nó **chỉ** được đưa vào `requestLoginChallenge` — đúng một call-site, đúng
 * luồng đã được thiết lập. Không log, không `useState`, không `localStorage`, không
 * analytics, và không dán vào bất kỳ liên kết nào khác: mọi đường đi thêm đều là
 * một lần rò handle ra ngoài luồng mà sinh ra nó (FR-006k3).
 */
const continuationHandle = computed(() => {
  const value = route.query.handle;
  return typeof value === 'string' ? value : undefined;
});

const challengeNeedsCode = computed(() => challenge.value?.mode === 'code');

async function requestChallenge(): Promise<void> {
  if (email.value.trim() === '') {
    return;
  }
  // Gửi lại hay gửi lần đầu đều qua đây; chỉ ghi nhận "đã gửi lại" khi thử lại
  // từ một challenge đang mở, để không hiện câu xác nhận ở lần gửi đầu.
  const isResend = challenge.value !== undefined;
  submitting.value = true;
  requestFailed.value = false;
  resendSent.value = false;
  codeFailed.value = false;
  codeAccepted.value = false;
  try {
    // Handle đi kèm đây và **chỉ** ở đây — xem khối chú thích của
    // `continuationHandle` ở trên.
    const requested = await adapter.requestLoginChallenge(
      email.value.trim(),
      continuationHandle.value,
    );
    if (requested.ok) {
      challenge.value = requested.value;
      resendSent.value = isResend;
    } else {
      requestFailed.value = true;
    }
  } catch {
    // `postJson` dùng fetch thô — lỗi mạng/DNS ném thay vì trả `Result`; bỏ
    // catch là một vòng retry im lặng (unhandled rejection, không trạng thái).
    requestFailed.value = true;
  } finally {
    submitting.value = false;
  }
}

async function submitCode(): Promise<void> {
  submitting.value = true;
  codeFailed.value = false;
  codeAccepted.value = false;
  handoffFailed.value = false;
  handoffUnavailable.value = false;
  try {
    const verified = await adapter.verifyLoginCode(code.value.trim());
    codeFailed.value = !verified.ok;
    codeAccepted.value = verified.ok;
  } catch {
    // Lỗi ném (network/transport) cũng là verify thất bại — không để unhandled
    // rejection; người dùng phải thấy trạng thái lỗi để có thể retry.
    codeFailed.value = true;
    codeAccepted.value = false;
  } finally {
    submitting.value = false;
  }

  // Bàn giao chạy SAU khi `submitting` đã về `false`: màn hình phản hồi verify
  // không được chờ handoff (đó là một lần gọi server khác; nếu auth chết thì
  // response verify vẫn phải đến). Handle tiếp tục được dùng đúng một lần trong
  // luồng này.
  if (codeAccepted.value && continuationHandle.value !== undefined) {
    await runHandoff(continuationHandle.value);
  }
}

/**
 * Đang bàn giao — cho phép hiện trạng retry sau khi thống nhất xong.
 */
const handingOff = ref(false);

async function runHandoff(handle: string): Promise<void> {
  handingOff.value = true;
  handoffFailed.value = false;
  handoffUnavailable.value = false;
  try {
    const result = await adapter.completeHandoff(handle);
    if (result.ok && typeof result.value.continueUrl === 'string') {
      // Đích do `auth` quyết định: relay nguyên vẹn — không tự ghép chuỗi, không
      // thêm tham số. Điều hướng client-side SPA không dùng được vì URL có thể
      // origin của app khác (RP); `window.location.assign` là trung thực nhất.
      window.location.assign(result.value.continueUrl);
      return;
    }
    if (result.ok) {
      // `already_processed`: hợp đồng KHÔNG cấp URL ở outcome này. Hiện trạng
      // "đang hoàn tất" thay vì lỗi — không hứa một đích mà hợp đồng không có.
      handoffUnavailable.value = true;
      return;
    }
    handoffFailed.value = true;
  } catch {
    // `completeHandoff` có thể ném (fetch thô trong adapter thật) — lỗi ném
    // cũng là handoff thất bại; nuốt nó là trạng thái "im lặng" không có retry.
    handoffFailed.value = true;
  } finally {
    handingOff.value = false;
  }
}

/** Retry bàn giao sau khi fail — handle không đổi, vì push idempotent. */
async function retryHandoff(): Promise<void> {
  if (handingOff.value || continuationHandle.value === undefined) {
    return;
  }
  await runHandoff(continuationHandle.value);
}

function startOver(): void {
  challenge.value = undefined;
  code.value = '';
  codeFailed.value = false;
  codeAccepted.value = false;
  requestFailed.value = false;
  resendSent.value = false;
  handoffFailed.value = false;
  handoffUnavailable.value = false;
}
</script>

<template>
  <section class="account-card space-y-5 p-6" data-testid="login-card">
    <div>
      <h1 class="text-xl font-semibold tracking-tight text-foam">
        {{ i18n.t('login.title') }}
      </h1>
      <p class="mt-2 text-sm text-muted">{{ i18n.t('login.description') }}</p>
    </div>

    <form
      v-if="!challenge"
      class="space-y-4"
      data-testid="login-email-form"
      @submit.prevent="requestChallenge"
    >
      <div>
        <label class="account-label" for="login-email">{{ i18n.t('login.email') }}</label>
        <input
          id="login-email"
          v-model="email"
          class="account-field mt-1"
          type="email"
          autocomplete="email"
          required
          data-testid="login-email"
        />
      </div>
      <button
        type="submit"
        class="account-button-primary w-full"
        :disabled="submitting"
        data-testid="login-submit"
      >
        {{ submitting ? i18n.t('login.submitting') : i18n.t('login.submit') }}
      </button>
    </form>

    <div v-else class="space-y-4" data-testid="login-challenge">
      <div>
        <h2 class="text-base font-semibold text-foam">
          {{ i18n.t('login.checkTitle') }}
        </h2>
        <p class="mt-1 text-sm text-muted">
          {{ i18n.t('login.checkBody', { email: challenge.email }) }}
        </p>
      </div>

      <form
        v-if="challengeNeedsCode"
        class="space-y-4"
        data-testid="login-code-form"
        @submit.prevent="submitCode"
      >
        <div>
          <label class="account-label" for="login-code">{{ i18n.t('login.codeLabel') }}</label>
          <input
            id="login-code"
            v-model="code"
            class="account-field mt-1"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            required
            data-testid="login-code"
          />
          <p class="account-hint">
            {{ i18n.t('login.codeBody', { email: challenge.email }) }}
          </p>
        </div>
        <button
          type="submit"
          class="account-button-primary w-full"
          :disabled="submitting"
          data-testid="login-code-submit"
        >
          {{ i18n.t('login.codeSubmit') }}
        </button>
        <p
          v-if="codeFailed"
          class="text-sm text-danger"
          role="alert"
          data-testid="login-code-invalid"
        >
          {{ i18n.t('login.codeInvalid') }}
        </p>
        <p
          v-else-if="codeAccepted"
          class="text-sm text-success"
          role="status"
          data-testid="login-code-accepted"
        >
          {{ i18n.t('login.codeAccepted') }}
        </p>
      </form>

      <!--
        Trạng thái bàn giao nằm NGOÀI form nhập mã: nó là kết quả của lần gọi
        server thứ hai (handoff), không thuộc về vòng đời của form. Retry chỉ
        có khi handoff thất bại — mock/preview không có server để bàn giao và
        hiển thị `handoffUnavailable` thay vì một retry vô nghĩa hiển thị như thành công.
      -->
      <div v-if="handoffFailed" class="space-y-3" data-testid="login-handoff-retry">
        <p class="text-sm text-danger" role="alert">
          {{ i18n.t('loginContinue.errorTitle') }} —
          {{ i18n.t('loginContinue.errorBody') }}
        </p>
        <button
          type="button"
          class="account-button-secondary"
          :disabled="handingOff"
          data-testid="login-handoff-retry-button"
          @click="retryHandoff"
        >
          {{ i18n.t('common.retry') }}
        </button>
      </div>
      <p
        v-else-if="handoffUnavailable"
        class="text-sm text-muted"
        role="status"
        data-testid="login-handoff-unavailable"
      >
        {{ i18n.t('loginContinue.body') }}
      </p>

      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="account-button-secondary"
          data-testid="login-resend"
          @click="requestChallenge"
        >
          {{ i18n.t('login.resend') }}
        </button>
        <button
          type="button"
          class="account-button-secondary"
          data-testid="login-change-email"
          @click="startOver"
        >
          {{ i18n.t('login.changeEmail') }}
        </button>
      </div>
    </div>

    <!--
      Hai thông báo này nằm NGOÀI cả `form` lẫn nhánh challenge, vì cả hai đều
      đến từ `requestChallenge` — hàm chạy ở cả hai nhánh. Để trong `form`
      (nhánh `v-if="!challenge"`) nghĩa là gửi lại thất bại không hiện gì cả:
      người dùng bấm "Gửi lại" rồi im lặng, và `login.resendSent` có trong cả
      ba catalog mà không nơi nào dùng.
    -->
    <p
      v-if="requestFailed"
      class="text-sm text-danger"
      role="alert"
      data-testid="login-request-failed"
    >
      {{ i18n.t('login.errorTitle') }} — {{ i18n.t('login.errorBody') }}
    </p>
    <p
      v-else-if="resendSent"
      class="text-sm text-success"
      role="status"
      data-testid="login-resend-sent"
    >
      {{ i18n.t('login.resendSent') }}
    </p>

    <p class="border-t border-line pt-4 text-xs text-muted" data-testid="login-no-password">
      {{ i18n.t('login.noPasswordNote') }}
    </p>
  </section>
</template>

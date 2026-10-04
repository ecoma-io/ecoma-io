import { useNuxtApp, type NuxtApp } from '#app';
import type { AccountAdapter } from '../account-data/types';
import { createMockAccountAdapter } from '../account-data/mock-adapter';

/** App Nuxt đã mang adapter, gắn thêm vào nó. */
type AccountNuxtApp = NuxtApp & {
  $accountAdapter?: AccountAdapter;
};

/**
 * Điểm chọn implementation adapter — **nơi duy nhất** quyết định UI nói chuyện
 * với nguồn dữ liệu nào.
 *
 * Hôm nay chỉ có mock. Khi contract BFF thật có mặt, thay thân hàm này bằng
 * adapter thật; toàn bộ UI phía trên không đổi vì nó chỉ biết `AccountAdapter`.
 *
 * ⚠️ **Không** dùng `useState` cho adapter. `useState` trả `Ref<UnwrapRef<T>>`, mà
 * `UnwrapRef` biến một **interface có phương thức** thành object thuần phẳng —
 * mọi phương thức biến mất khỏi kiểu. Tệ hơn: `useState` ghi vào `payload.state`,
 * và payload được serialize để hydrate client; một adapter đi qua đó sẽ thành
 * object JSON **mất sạch hàm**, nên mọi trang gọi `adapter.listEmails()` sẽ ném
 * `TypeError` ngay sau hydrate. Adapter không phải dữ liệu để vận chuyển.
 *
 * Vì vậy nó nằm trên chính `nuxtApp`. Ở SSR, Nuxt tạo một `NuxtApp` **riêng cho
 * từng request**, nên adapter cũng riêng theo — không rò dữ liệu giữa hai người,
 * đúng điều mà một biến ở cấp module sẽ làm hỏng (và `AGENTS.md` cấm đúng thứ
 * đó). Ở client, `nuxtApp` là singleton của tab nên adapter sống suốt phiên.
 *
 * `??=` thay vì gán thẳng: mọi call-site trong app nhận **cùng** một instance, nên
 * thao tác ghi của một trang phải thấy dữ liệu trang khác vừa ghi.
 */
export function useAccountAdapter(): AccountAdapter {
  const nuxtApp = useNuxtApp() as AccountNuxtApp;
  nuxtApp.$accountAdapter ??= createMockAccountAdapter();
  return nuxtApp.$accountAdapter;
}

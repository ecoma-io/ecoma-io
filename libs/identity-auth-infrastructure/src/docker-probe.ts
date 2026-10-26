/**
 * Probe Docker fail-loud cho suite PostgreSQL thật của lib này.
 *
 * Copy có chủ đích của `probeDocker` trong `apps/auth/tests/integrations/harness.ts`
 * (cùng pattern với harness của `apps/account`): 06-testing.md §6 cấm chia sẻ
 * test-support qua ranh giới deploy unit, nên hai harness giống hệt nhau là
 * **có chủ đích**, không phải nợ kỹ thuật.
 *
 * Probe bằng **chính** container PostgreSQL mà test sẽ dùng, chứ không bằng một
 * lệnh Docker rẻ tiền: một runner không có Docker daemon thì `docker info` vẫn
 * có thể trả 0 (chỉ thiếu socket), và probe đó sẽ cho một describe rỗng rồi đỏ
 * ở `beforeAll`. Tốn vài giây cho lần đầu, nhưng nó loại được đúng cái nguy
 * hiểm nhất: một suite báo skip vì hạ tầng, không phải vì hành vi.
 *
 * Khi probe thất bại:
 * - **Ném lỗi** làm toàn bộ lần chạy đỏ ngay lập tức: Docker là phụ thuộc cứng
 *   của suite PostgreSQL, vắng Docker là sự cố hạ tầng — suite phải ĐỎ, không
 *   được skip với exit 0 (skip im lặng chính là thứ che mất test).
 *   docs/overview/06-testing.md §6 chốt chính sách fail-loud này.
 */

/**
 * Cổng PostgreSQL **trong container**. Không phải cổng host: testcontainers ánh
 * xạ sang một cổng host ngẫu nhiên và `getMappedPort` đọc cổng đó. Con số này
 * chỉ cần khác `5432` để không lẫn với một PostgreSQL local.
 *
 * ⚠️ Truyền nó vào `withExposedPorts` bằng **varargs**. `withExposedPorts` nhận
 * `...ports`, nên truyền một mảng (`[POSTGRES_PORT]`) đẩy chính cái mảng vào vị
 * trí `port`, và `getContainerPort` trả `port.container` là `undefined` — lỗi
 * của Docker daemon là `invalid port 'undefined'`, tức là hỏng **trước** khi
 * container kịp chạy, và trông như "Docker hỏng" thay vì "sai API".
 */
const POSTGRES_PORT = 5_432;

/**
 * Biến môi trường mang kết quả probe từ `globalSetup` sang từng worker.
 *
 * Vitest chạy mỗi spec file trong một worker riêng với module graph riêng
 * (pool `forks`, isolate) — cache ở module scope hay `globalThis` vẫn probe
 * **một lần mỗi file**. `globalSetup` chạy **một lần** trong main process
 * trước khi worker khởi động, và worker kế thừa `process.env` khi được fork —
 * nên biến môi trường là kênh duy nhất đáng tin để "một probe cho cả lần chạy".
 */
const DOCKER_PROBE_ENV = 'ECOMA_IDENTITY_AUTH_INFRA_DOCKER_PROBE';

/**
 * Docker có dùng được không — probe một lần mỗi lần chạy vitest.
 *
 * Xem header file cho chính sách fail-loud và hình thức probe.
 */
export function probeDocker(): Promise<void> {
  const flag = process.env[DOCKER_PROBE_ENV];
  if (flag === 'available') {
    return Promise.resolve();
  }
  if (flag === 'unavailable') {
    throw new Error(
      'Docker is unavailable: PostgreSQL integration suites require a running Docker daemon; refusing to skip.',
    );
  }
  // Fallback khi được gọi ngoài pipeline vitest có `globalSetup` (chạy tay,
  // vitest khác config): probe tại chỗ và cache trên globalThis cho caller sau.
  const cache = globalThis as DockerProbeCache;
  cache.ecomaIdentityAuthInfraDockerProbe ??= runDockerProbe();
  return cache.ecomaIdentityAuthInfraDockerProbe;
}

interface DockerProbeCache {
  ecomaIdentityAuthInfraDockerProbe?: Promise<void>;
}

/**
 * Số lần thử lại khi start một container thất bại, và khoảng nghỉ giữa hai lần.
 *
 * ⚠️ Thất bại start **thường là tạm thời**, không phải Docker hỏng: dưới rootless
 * Docker, nhiều container start song song thi nhau chiếm port host qua
 * RootlessKit, và người thua nhận
 * `RootlessKit PortManager.AddPort(): bind: address already in use` — HTTP 500
 * từ daemon, lỗi biến mất ở lần thử sau. Retry với khoảng nghỉ tăng dần là
 * cách rẻ nhất để hai tầng này không nhầm với nhau.
 */
const CONTAINER_START_ATTEMPTS = 3;
const CONTAINER_START_BACKOFF_MS = 1_000;

async function startPostgresContainer(
  builder: (
    c: import('@testcontainers/postgresql').PostgreSqlContainer,
  ) => import('@testcontainers/postgresql').PostgreSqlContainer,
): Promise<import('@testcontainers/postgresql').StartedPostgreSqlContainer> {
  const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
  let lastError: unknown;
  for (let attempt = 1; attempt <= CONTAINER_START_ATTEMPTS; attempt++) {
    try {
      return await builder(new PostgreSqlContainer('postgres:17-alpine'))
        .withStartupTimeout(120_000)
        .start();
    } catch (error) {
      lastError = error;
      // Lỗi xảy ra trước khi container kịp chạy (ví dụ port-bind) không để lại
      // gì để dọn; lỗi sau start thì ryuk dọn container theo label của
      // testcontainers. Nuốt ở đây để vòng retry không ném giữa chừng.
    }
    await new Promise<void>((done) => {
      setTimeout(done, CONTAINER_START_BACKOFF_MS * attempt);
    });
  }
  throw lastError;
}

async function runDockerProbe(): Promise<void> {
  let container: { stop(): Promise<unknown> } | undefined;
  let available = false;
  try {
    container = await startPostgresContainer((c) => c.withExposedPorts(POSTGRES_PORT));
    available = true;
  } catch {
    available = false;
  } finally {
    // `.catch(() => {})` chứ không phải block rỗng: `stop()` là cleanup và có
    // thể tự nó ném, nuốt lỗi ở đây để lỗi **thật** của probe không bị che.
    await container?.stop().catch(() => undefined);
  }

  process.env[DOCKER_PROBE_ENV] = available ? 'available' : 'unavailable';
  if (!available) {
    throw new Error(
      'Docker is unavailable: PostgreSQL integration suites require a running Docker daemon; refusing to skip.',
    );
  }
}

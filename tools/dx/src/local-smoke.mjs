/**
 * Smoke HTTPS cho luồng local deployment — Node thuần, không dependency ngoài.
 *
 * Việc cần làm: request HTTPS tới `https://fbi.com:<port>/` và xác nhận (1) TLS
 * bắt tay THÀNH CÔNG với certificate local của repo (không tắt verification —
 * smoke mà bỏ kiểm TLS là smoke nói dối), (2) server home trả response.
 *
 * Certificate trust ở đây là TƯỜNG MINH và scoped: `ca` của riêng agent HTTPS
 * này trỏ vào `deploys/platform-deploy/local-certs/fbi.com.crt` — chỉ request
 * của smoke test này tin certificate đó, không đụng trust store toàn cục của
 * hệ điều hành, không biến môi trường NODE_TLS_REJECT_UNAUTHORIZED nào bị đặt.
 *
 * Cách chạy: `node tools/dx/src/local-smoke.mjs fbi.com:<port>` — input là giá
 * trị ROOT_HOST đã sinh từ Pulumi outputs, không phải port đoán trước.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import https from 'node:https';

const [rootHostArg] = process.argv.slice(2);
if (rootHostArg === undefined || rootHostArg.length === 0) {
  console.error('Usage: node tools/dx/src/local-smoke.mjs <rootHost>   # vd: fbi.com:32768');
  process.exit(2);
}

// Định dạng ROOT_HOST đã chốt: `fbi.com:<port>` — hostname KHÔNG chứa port,
// router Traefik match `Host: fbi.com`; port chỉ thuộc URL phía client.
const separator = rootHostArg.lastIndexOf(':');
if (separator === -1) {
  console.error(`rootHost không đúng dạng <hostname>:<port>: ${rootHostArg}`);
  process.exit(2);
}
const hostname = rootHostArg.slice(0, separator);
const port = Number(rootHostArg.slice(separator + 1));
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(`port không hợp lệ trong rootHost: ${rootHostArg}`);
  process.exit(2);
}

// `import.meta.url` là …/tools/dx/src/local-smoke.mjs — ba mức `../` về repo
// root, rồi vào deploys/platform-deploy. Thiếu một mức là path sai và smoke
// fail với ENOENT trước khi kịp thử HTTPS nào.
const certPath = join(
  fileURLToPath(
    new URL('../../../deploys/platform-deploy/local-certs/fbi.com.crt', import.meta.url),
  ),
);
const ca = readFileSync(certPath, 'utf8');

const started = Date.now();
const request = https.get(
  // servername để SNI đúng hostname — Traefik chọn certificate theo SNI.
  { hostname, port, path: '/', ca, servername: hostname, timeout: 15000 },
  (response) => {
    const elapsed = Date.now() - started;
    // `/` của home redirect 302 sang `/en` — mọi status < 500 là server home
    // đã sống và trả lời qua Traefik; 5xx là lỗi SSR thật.
    response.resume(); // tiêu thụ body để socket giải phóng, không cần nội dung
    if (response.statusCode >= 500) {
      console.error(`smoke FAILED: status ${response.statusCode} sau ${elapsed}ms`);
      process.exit(1);
    }
    console.log(
      `smoke OK: status ${response.statusCode} sau ${elapsed}ms — server home trả lời qua Traefik, TLS hợp lệ với certificate local`,
    );
    process.exit(0);
  },
);
request.on('timeout', () => {
  console.error('smoke FAILED: timeout 15s — server không trả lời qua Traefik');
  request.destroy();
  process.exit(1);
});
request.on('error', (error) => {
  // Lỗi TLS (certificate sai, hostname sai) cũng rơi vào đây — đúng ý: smoke
  // phải đỏ khi TLS không hợp lệ, không bao giờ nuốt lỗi xác minh.
  console.error(`smoke FAILED: ${error.message}`);
  process.exit(1);
});

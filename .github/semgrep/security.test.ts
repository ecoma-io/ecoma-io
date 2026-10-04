// Fixture semgrep --test cho security.yml. File này không phải là code của
// application — không gì dưới .github/semgrep được build hay chạy. Nó là TypeScript
// vì rule trong security.yml dùng `languages: [typescript]`: semgrep ghép cặp
// rule↔fixture theo tên file (`security.yml` ↔ `security.test.ts`) và chỉ chạy
// fixture có đuôi trùng ngôn ngữ của rule.
//
// Mỗi rule cần cả hai nửa: `ruleid:` phải khớp, `ok:` không được khớp. Các case
// `ok:` dưới đây chính là các ranh giới FP của threat model — userId/requestId
// là thứ AGENTS.md chỉ định PHÉP in ra để correlation, nên chúng không được
// nằm trong danh sách nguồn, và một identifier không nằm trong danh sách cũng
// không được tự biến thành nguồn chỉ vì nó nằm trong một biểu thức nhạy cảm.

/* oxlint-disable no-console */
// Fixture semgrep --test, không phải application code: mỗi dòng `console.*`
// bên dưới là SINK mà rule taint cần để tồn tại, và `.github/semgrep/` không
// thuộc Nx project nào nên chúng không bao giờ tới được runtime. `no-console`
// vẫn được giữ nguyên cho mọi file có thật — chính rule này là thứ đọc được
// GIÁ TRỊ bên trong console, cái mà lint không nhìn thấy.
// ruleid: security-sensitive-value-logged
console.log(token);
// ruleid: security-sensitive-value-logged
console.log(secret);
// ruleid: security-sensitive-value-logged
console.log(apiKey);
// ruleid: security-sensitive-value-logged
console.log(api_key);
// ruleid: security-sensitive-value-logged
console.error(password);
// ruleid: security-sensitive-value-logged
console.warn(accessToken);
// ruleid: security-sensitive-value-logged
console.log(refreshToken);
// ruleid: security-sensitive-value-logged
console.log(credentials);
// ruleid: security-sensitive-value-logged
console.log(prompt);
// ruleid: security-sensitive-value-logged
console.log(llm.response);
// ruleid: security-sensitive-value-logged
console.log(responseBody);
// ruleid: security-sensitive-value-logged
console.log(response_body);
// ruleid: security-sensitive-value-logged
console.log(cookie);
// ruleid: security-sensitive-value-logged
console.log(authorization);

// Ranh giới FP quan trọng nhất của rule này. `response` trần trong repository
// này là một `Response` của fetch/h3 — `response.status` và `await
// response.json()` đọc metadata HTTP, không phải body của LLM. Khi `response`
// được xếp vào nguồn trần, chính hai biểu thức đó đã sinh 7 FP trên
// apps/*/server/api/greet.spec.ts, nên `response` trần chỉ được nhận ở dạng
// field (`x.response`) và body phải tự nói tên mình là body.
// ok: security-sensitive-value-logged
console.log(response.status);
// ok: security-sensitive-value-logged
console.log(response);

// Nguồn dưới dạng field của object — `config.apiKey`, `env.SECRET` — cũng là
// cùng một đường đi, và đây là cách một secret environment thực sự xuất hiện.
// ruleid: security-sensitive-value-logged
console.log(config.apiKey);
// ruleid: security-sensitive-value-logged
console.error(process.env.SECRET);

// Ranh giới FP: hai identifier mà AGENTS.md chỉ định là được phép in ra, và
// hai identifier thông thường không có tên trong threat model.
// ok: security-sensitive-value-logged
console.log(userId);
// ok: security-sensitive-value-logged
console.log(requestId);
// ok: security-sensitive-value-logged
console.log(count);
// ok: security-sensitive-value-logged
console.log(message);

// Fixture cho rule response: giá trị nhạy cảm rời khỏi handler.
export function returnToken(): string {
  // ruleid: security-sensitive-value-in-http-response
  return token;
}

export function returnField(): string {
  // ruleid: security-sensitive-value-in-http-response
  return config.accessToken;
}

export function returnSafe(): string {
  // ok: security-sensitive-value-in-http-response
  return userId;
}

export function returnObject() {
  // ruleid: security-sensitive-value-in-http-response
  return { token };
}

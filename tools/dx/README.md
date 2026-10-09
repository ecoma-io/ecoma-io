# dx

Devtools CLI cho repository ecoma-io. Tự chạy khi `pnpm install` thông qua
script `prepare`.

## Lệnh

```bash
pnpm dx --help              # liệt kê các lệnh
pnpm dx repo-prepare        # hook, kiểm tra tool, đồng bộ cấu hình agent
pnpm dx sync-agent-config   # chỉ đồng bộ cấu hình agent (CLAUDE.md + .agent/skills/ → .claude/skills/)
pnpm dx pr-check            # kiểm PR theo policy của repository
```

`repo-prepare` chạy lại an toàn — mỗi bước đều bỏ qua việc đã xong.

### repo-prepare

1. Cài git hook (`lefthook install`).
2. Kiểm tra Docker, Helm, kustomize và kubeconform có chạy được không.
3. Đồng bộ cấu hình agent: viết `CLAUDE.md` cạnh mọi `AGENTS.md` còn thiếu
   và đồng bộ `.agent/skills/` → `.claude/skills/`.

### Kiểm tra tool

Một tool chỉ được coi là có mặt khi lệnh lấy version của nó chạy được trên
`PATH` hiện tại. Một binary nằm trong thư mục cài đặt mà shell này chưa nhận
diện thì không chạy được, trong khi các bước thiết lập trong `CONTRIBUTING.md`
lại giả định nó chạy được.

`repo-prepare` không bao giờ cài gì cả. Một máy không có root, không có TTY để
trả lời prompt `sudo`, hoặc đứng sau corporate proxy là một máy bình thường,
mà một installer không hoàn tất được sẽ khiến repository chỉ chuẩn bị được một
nửa. Tool còn thiếu được liệt kê kèm link tới hướng dẫn của chính vendor:

```
Checking required tools
Docker v29.5.3 is available
kubeconform v0.6.7 is available

2 required tools are missing. Install them before working on this repository:
  Helm: https://helm.sh/docs/intro/install/
  kustomize: https://kubectl.docs.kubernetes.io/installation/kustomize/
```

Lệnh vẫn exit 0 — một tool thiếu là thông tin, không phải thiết lập hỏng.

Docker được kiểm tra bằng `docker version` chứ không phải `docker --version`.
Flag trần báo binary đã cài dù daemon có chạy hay không, nên nó sẽ qua bước kiểm
tra này trên một máy rồi fail mọi commit vì daemon chưa từng tồn tại.

### sync-agent-config

Đồng bộ cấu hình agent từ source of truth sang cấu hình generated:

- **CLAUDE.md** — duyệt repository và viết `CLAUDE.md` chứa `@AGENTS.md` ở mọi
  nơi có `AGENTS.md` mà thiếu file đó. `AGENTS.md` vẫn là source of truth:
  `CLAUDE.md` đã tồn tại không bao giờ bị ghi đè (kể cả file viết tay), và các
  thư mục bị ignore sẽ bị bỏ qua.
- **Skills** — đồng bộ `.agent/skills/` → `.claude/skills/`, giữ nguyên cấu
  trúc thư mục và tất cả file hỗ trợ (không chỉ `SKILL.md`). Copy file mới và
  file thay đổi, đồng thời xóa file/thư mục đích không còn đối ứng, nên chạy
  lặp lại là idempotent. `.claude/skills/` hoàn toàn là generated output —
  custom skills phải đặt trong `.agent/skills/`. Nếu `.agent/skills/` không
  tồn tại, bước skills được bỏ qua với thông báo rõ ràng và `.claude/skills/`
  hiện có được giữ nguyên; nếu có nhưng rỗng, nó được đồng bộ như một nguồn
  rỗng (làm trống đích). Bước này tôn trọng `.gitignore` cho việc duyệt và cho
  các input được copy, và không đi theo symlink ra ngoài source tree.

### pr-check

Đọc PR từ event payload mà GitHub Actions đã ghi ra đĩa (`GITHUB_EVENT_PATH`)
— title lẫn SHA của `pull_request.base` và `pull_request.head` — thay vì nhận
thông tin qua đối số của CI, rồi kiểm ba lớp:

1. commitlint với `commitlint.config.mjs` — syntax Conventional Commits và Nx
   scope, đúng nguyên trạng rule mà hook `commit-msg` đang dùng.
2. Chính sách title — đúng một Nx scope; type tùy ý: `feat`, `fix`, `chore`,
   `docs`, `refactor`, `ci`, ...
3. Chính sách development commits — trên khoảng `base.sha..head.sha`, số commit
   có type `feat` hoặc `fix` tối đa là một: không có thì hợp lệ, hai trở lên
   (kể cả `feat` + `fix`) là lỗi. Từng message được parse bằng cùng parser
   preset của commitlint; các type khác không tham gia đếm.

Khoảng commit được đối chiếu với git history tại chỗ (CI checkout với
`fetch-depth: 0`) — pr-check không gọi GitHub API và không dùng trường
`pull_request.commits`. Chính sách nằm ở đây chứ không nằm trong
`commitlint.config.mjs` vì hook `commit-msg` vẫn phải cho `chore`, `docs`,
`refactor`... đi qua trên nhánh phát triển; chỉ PR bị siết lại. CI gọi lệnh này
và không tự parse payload trong YAML nữa.

Ngoài bối cảnh `pull_request` của GitHub, thiếu SHA, hoặc git không đọc được
range thì lệnh exit 1 thay vì báo xanh — một check không xác định được history
thì không có quyền thông qua.

Squash merge và merge queue do GitHub repository/ruleset cấu hình, nên `pr-check`
không kiểm và cũng không giả vờ kiểm những thứ đó.

## Test

```bash
nx test dx         # unit test
nx typecheck dx    # tsc
nx lint dx         # oxlint
```

## Bố cục

| Path                       | Vai trò                                                      |
| -------------------------- | ------------------------------------------------------------ |
| `index.ts`                 | Entry point, đưa `app` cho `runMain` của citty.              |
| `src/index.ts`             | Danh sách lệnh.                                              |
| `src/repo-prepare.ts`      | Các bước của `repo-prepare`, theo thứ tự.                    |
| `src/sync-agent-config.ts` | Đồng bộ `CLAUDE.md` và `.agent/skills/` → `.claude/skills/`. |
| `src/pr-check.ts`          | Chính sách PR và lệnh `pr-check`.                            |
| `src/tools.ts`             | Dò một CLI và cảnh báo về các CLI còn thiếu.                 |
| `src/tool-specs.ts`        | Mỗi tool bắt buộc tên là gì và lấy ở đâu.                    |
| `src/utils.ts`             | `ROOT_DIR` và `runCommand`.                                  |

Một tool được mô tả bởi một `ToolSpec` — tên hiển thị, executable, flag lấy
version và URL cài đặt chính thức — nên thêm tool thứ năm là thêm một spec, không
phải viết code mới.

## Quy ước

- Lệnh chạy từ `ROOT_DIR`, được suy ra từ vị trí file, nên kết quả không phụ
  thuộc vào working directory của caller.
- Import tương đối luôn có extension `.js` tường minh. Source là ESM dưới
  `nodenext`, nơi `./tools.js` chính là tên file sau khi compile mà Node nạp.

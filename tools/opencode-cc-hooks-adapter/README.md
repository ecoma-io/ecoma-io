# opencode-cc-hooks-adapter

Nx tool (`type:tool`) đồng thời là plugin local cho OpenCode V2, chạy hook theo định dạng của Claude Code. Cùng một file `.claude/settings.json` có thể dùng cho cả Claude Code và OpenCode.

## Cách hoạt động

- Plugin nằm tại `tools/opencode-cc-hooks-adapter/` và được đăng ký tường minh trong `.opencode/opencode.jsonc`:

  ```jsonc
  { "plugins": ["../tools/opencode-cc-hooks-adapter"] }
  ```

  Path resolve từ thư mục chứa file config (`.opencode/`). Vì thư mục này không nằm trong `.opencode/plugins/` nên không được auto-discover — sửa code plugin cần `opencode service restart` để nạp lại.

- Hook được đọc lúc plugin khởi động từ ba file, theo thứ tự (file sau nối tiếp file trước):
  1. `~/.claude/settings.json` — global
  2. `.claude/settings.json` — project, nên commit
  3. `.claude/settings.local.json` — riêng máy, đã nằm trong `.gitignore`
- Đặt `"disableAllHooks": true` trong một file bất kỳ để tắt toàn bộ hook mà không phải xoá cấu hình.

Sau khi sửa settings, cần nạp lại plugin (chạy `/reload` hoặc `opencode service restart`).

## Event được hỗ trợ

| Event Claude Code    | Khi nào chạy trong OpenCode                          |
| -------------------- | ---------------------------------------------------- |
| `PreToolUse`         | Trước khi một tool chạy; có thể chặn hoặc sửa input  |
| `PostToolUse`        | Sau khi tool chạy thành công                         |
| `PostToolUseFailure` | Sau khi tool trả lỗi                                 |
| `SessionStart`       | Khi session được tạo                                 |
| `SessionEnd`         | Khi session bị xoá                                   |
| `Stop`               | Khi agent kết thúc một lượt trả lời (`session.idle`) |
| `UserPromptSubmit`   | Chạy thủ công qua `/hook-prompt`                     |
| `Notification`       | Chạy thủ công qua `/hook-notify`                     |
| `PreCompact`         | Chạy thủ công qua `/hook-precompact`                 |

Các event `PermissionRequest`, `SubagentStart`, `SubagentStop`, `TeammateIdle`, `TaskCompleted`, `ConfigChange`, `WorktreeCreate`, `WorktreeRemove`, `InstructionsLoaded` chưa có điểm bắt tương ứng trong OpenCode; plugin sẽ log cảnh báo lúc khởi động.

## Định dạng hook

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "my-safety-check.sh",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

`matcher` là regex không phân biệt hoa thường, so với tên tool. Bỏ trống matcher hoặc dùng `"*"` để khớp mọi tool.

Bốn loại handler:

| `type`    | Hành vi                                                                                               |
| --------- | ----------------------------------------------------------------------------------------------------- |
| `command` | Chạy `bash -c`, ghi input JSON vào stdin. Exit code `0` = cho phép, `2` = chặn, khác = lỗi không chặn |
| `http`    | POST input JSON tới `url`, đọc output JSON từ response                                                |
| `prompt`  | Gọi model mặc định của phiên với `prompt`, đọc output JSON                                            |
| `agent`   | Như `prompt`, timeout mặc định dài hơn                                                                |

Input gửi cho handler:

```json
{
  "session_id": "ses_...",
  "cwd": "/duong/dan/du/an",
  "hook_event_name": "PreToolUse",
  "tool_name": "bash",
  "tool_input": { "command": "ls" }
}
```

Handler có thể trả về JSON trên stdout (hoặc body HTTP) để điều khiển kết quả:

```json
{
  "decision": "block",
  "reason": "Không được sửa file trong thư mục dist",
  "hookSpecificOutput": {
    "updatedInput": { "command": "ls -la" },
    "additionalContext": "Ghi chú thêm cho model"
  }
}
```

Ngoài ra, exit code `2` của handler `command` cũng chặn hành động, với lý do lấy từ stderr.

## Hook có sẵn trong repo

`.claude/settings.json` đã bật sẵn hook `PostToolUse` cho các tool `Edit`, `Write`, `MultiEdit`, `NotebookEdit`, `patch`, `apply_patch`. Sau mỗi lần sửa file, tool `tools/agent-hooks format-lint` sẽ:

1. Chạy `oxfmt --write` cho file thuộc glob format của lefthook: `js,jsx,mjs,cjs,ts,tsx,mts,cts,vue,json,jsonc,css,scss,html,md,yml,yaml`.
2. Chạy `oxlint --fix` cho nhóm JS/TS/Vue (`js,jsx,mjs,cjs,ts,tsx,mts,cts,vue`).
3. Bỏ qua `.agents/skills/security-audit/**` và mọi file nằm ngoài project root.

Lệnh và glob được giữ khớp với `lefthook.yml` để kết quả giống bước pre-commit. Nếu `oxlint` còn lỗi không tự sửa được, script in lỗi ra stderr và trả exit code `2`; lỗi công cụ (ví dụ chưa chạy `pnpm install`) chỉ ghi log và không chặn.

Đường dẫn hook dùng `${OPENCODE_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-.}}` nên chạy được với cả OpenCode và Claude Code.

## Ví dụ khác

Chặn lệnh xoá nguy hiểm:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "shell|bash",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '.tool_input.command // \"\"' | grep -qE 'rm -rf /( |$)' && { echo 'Refusing to remove the filesystem root' >&2; exit 2; } || exit 0"
          }
        ]
      }
    ]
  }
}
```

Thông báo khi agent trả lời xong:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "notify-send 'OpenCode' 'Agent đã trả lời xong'"
          }
        ]
      }
    ]
  }
}
```

Format file vừa sửa bằng `oxfmt` (dùng `path` vì đó là field của tool V2):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "edit|write",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '.tool_input.path // empty' | xargs -r npx oxfmt --write"
          }
        ]
      }
    ]
  }
}
```

## Giới hạn

- `PostToolUse` không nhận `tool_response` như Claude Code; input chỉ có `tool_name` và `tool_input`.
- Khi hook `PostToolUse` trả exit code `2`, Claude Code hiển thị lỗi cho model; plugin OpenCode hiện chỉ ghi lỗi vào log của server.
- Handler `prompt`/`agent` dùng model mặc định đang chọn trong OpenCode, không có session riêng và không chạy tool.
- Hook được nạp một lần khi plugin khởi động; sửa settings cần reload plugin.
- Không có cơ chế `matcher` cho event không phải tool; toàn bộ hook của event đó đều chạy.

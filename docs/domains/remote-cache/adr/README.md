# Remote Cache — ADR index

Architectural decision record (ADR) của bounded context **Remote Cache** (xem [`../README.md`](../README.md)). Mỗi quyết định có **một** canonical location là ADR tương ứng; nhìn lại một quyết định hay đảo nó phải qua ADR mới (không sửa ADR đã Accepted để đổi ý một cách âm thầm) — trừ cập nhật chính tả hay cross-reference không đổi nghĩa.

| #    | Quyết định                                                                                                                                                                                            | Trạng thái | File                                                                             |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------- |
| 0015 | Xác lập bounded context `remote-cache` từ disposable build state; storage `db-remote-cache`, PostgreSQL, schema `remote_cache`; ranh giới tenant với `pact-broker`, entitlement Staff Access deferred | Accepted   | [`0015-remote-cache-bounded-context.md`](./0015-remote-cache-bounded-context.md) |

Số `0015` nối tiếp dải ADR toàn hệ thống (dải `0001…0014` thuộc [`staff-access/adr/`](../../staff-access/adr/README.md)). Quyết định nền tảng của hệ thống (A5, A9, A18, A20, invariant 6/14/22) nằm ở hệ thống, không nhân bản tại đây → [`../../../architecture/01-architecture.md`](../../../architecture/01-architecture.md) §8–§9. Thiết kế kỹ thuật của deploy unit → [`solutions/remote-cache/`](../../../solutions/remote-cache/README.md).

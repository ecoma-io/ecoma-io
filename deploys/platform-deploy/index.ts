/**
 * Chương trình Pulumi của `platform-deploy` — project gốc duy nhất giữ vai trò
 * provisioning của platform.
 *
 * Program này CỐ TÌNH không có resource quản lý nào: không khai báo tài nguyên,
 * không import SDK của provider cloud, không provision gì. Nó tồn tại để mọi deploy
 * unit khác neo cạnh `implicitDependencies` vào một đích duy nhất, và để chỗ này là
 * nơi tài nguyên platform được thêm vào khi nội dung thực sự tồn tại.
 */

// Import `pulumi` để giữ đúng hình dạng của project Pulumi TypeScript (runtime
// nodejs cần engine để đăng ký chương trình) nhưng không tạo resource nào.
import * as pulumi from '@pulumi/pulumi';

pulumi.log.info('platform-deploy: chưa có resource nào — project này không provision gì.');

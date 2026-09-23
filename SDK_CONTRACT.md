<!--
 * @author Bùi Trọng Hiếu
 * @email kevinbui210191@gmail.com
 * @create date 2026-04-22
 * @modify date 2026-04-22
 * @desc Hợp đồng SDK tối thiểu giữa Galaxy Quasar core và extension runtime ở phase đầu.
 */
-->

# Extension SDK Contract

## Mục tiêu

Galaxy Quasar core cung cấp một `Core API` ổn định để extension:
- dùng lại dịch vụ lõi của Galaxy
- không import trực tiếp internals
- đi qua permission check theo `manifest.json`

Ở phase hiện tại, contract ưu tiên:
- rõ ràng
- tối thiểu
- giữ runtime an toàn

## Nguyên tắc

- Extension chỉ gọi Galaxy qua `execute_extension_core_action(...)`
- Extension UI/runtime trong desktop nên dùng TypeScript SDK `createGalaxyCore(extensionId)` thay vì gọi action string trực tiếp.
- Mỗi action phải có permission tương ứng trong `manifest.json`
- Extension runtime không được đọc/ghi ra ngoài vùng dữ liệu được Galaxy core cấp
- `base tools` của AI Agent là phần lõi, không bị biến thành extension

## TypeScript SDK

Source schema cho Core API nằm trong **repo này** (single source of truth):

- `schemas/core-api.schema.json`
- `schemas/manifest.schema.json` (schema cho manifest.json của từng extension)

Consumer (hiện tại là quasar shell) chạy generator để nhận artifact + bản copy
schema; CI của consumer phải kiểm tra generated artifacts khớp schema.

Schema này khai báo:
- `apiVersion`
- action name/key/permission
- `payloadType`
- `resultDataType`
- JSON Schema tối giản cho payload/result data

Generated constants nằm tại:

- `src/features/extensions/sdk/galaxy-core.generated.ts`
- `src-tauri/src/extension_core_api/generated.rs`
- `python/galaxy_ai/extension_core_api_generated.py`

Generate lại sau khi đổi schema (chạy trong quasar shell):

```bash
npm run generate:extension-sdk
```

Shell delegating tới generator của repo này:

```bash
node ../quasar-extension-sdk/generate-extension-sdk.mjs \
  --ts src/features/extensions/sdk/galaxy-core.generated.ts \
  --rust src-tauri/src/extension_core_api/generated.rs \
  --python python/galaxy_ai/extension_core_api_generated.py \
  --schema-copy-dir extensions
```

SDK frontend hiện nằm tại:

```ts
import { createGalaxyCore } from "@/features/extensions/sdk/galaxy-core";
```

Core API version hiện tại là `0.1.0`. Extension mới nên khai báo trong `manifest.json`:

```json
{
  "coreApiVersion": "0.1.0"
}
```

Galaxy Quasar vẫn cho phép manifest cũ chưa khai báo trường này, nhưng manifest có khai báo sai version sẽ bị từ chối khi scan/install.

Ví dụ:

```ts
const galaxy = createGalaxyCore(extensionId);

await galaxy.files.writeText("notes/demo.txt", "Hello");
const result = await galaxy.agent.run({
  prompt: "Tóm tắt deck này",
  assistantMode: false,
  allowTools: false,
});
await galaxy.tts.speak({ engine: "auto", text: "Xin chào" });
const artifact = await galaxy.artifacts.register({
  path: "exports/demo.pptx",
  mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  kind: "presentation",
});
```

SDK hiện expose:
- `galaxy.agent.run/stream/listenStream`
- `galaxy.artifacts.register/list/open/reveal`
- `galaxy.files.writeText/writeBase64/readText/openText/revealInFinder`
- `galaxy.marketData.quote/history`
- `galaxy.news.search`
- `galaxy.records.upsert/list/delete`
- `galaxy.scheduler.schedule/list/cancel/runNow`
- `galaxy.storage.get/set`
- `galaxy.stt.transcribeAudio`
- `galaxy.tts.speak/stop`

SDK facade dùng generated `CoreActionPayloads` và `CoreActionResultData`, nên khi đổi payload/result trong schema cần chạy lại generator trước khi build.
Rust dispatcher cũng validate payload runtime theo subset schema đang dùng (`type`, `required`, `properties`, `additionalProperties`, `items`) trước khi action chạy.

## Manifest Permissions

Các permission đang có execution path thật:

- `ui.panel`
- `core.tts`
- `core.storage`
- `core.agent`
- `core.marketData`
- `core.news`
- `core.artifacts`
- `core.scheduler`
- `core.stt`
- `core.ui`
- `core.notifications`
- `core.assistant.inbox`
- `fs.read`
- `fs.write`

## Core Actions đang hỗ trợ

### `core.tts.speak`

Permission:
- `core.tts`

Arguments:
```json
{
  "text": "Xin chào Galaxy",
  "engine": "auto"
}
```

### `core.tts.stop`

Permission:
- `core.tts`

Arguments:
```json
{}
```

### `core.storage.set`

Permission:
- `core.storage`

Arguments:
```json
{
  "key": "hello.note",
  "value": "Galaxy extension state"
}
```

### `core.storage.get`

Permission:
- `core.storage`

Arguments:
```json
{
  "key": "hello.note"
}
```

### `core.records.upsert/list/delete`

Permission:
- `core.storage`

Ghi chú:
- backed by SQLite table `extension_records`.
- mọi record scoped theo `extensionId`, `collection`, `id`.
- dùng cho dữ liệu có cấu trúc như prediction ledger, positions, evaluator state.

Upsert:
```json
{
  "collection": "stock.prediction_ledger",
  "id": "pred-...",
  "value": { "ticker": "AAPL", "outcome": "open" }
}
```

List:
```json
{
  "collection": "stock.prediction_ledger",
  "limit": 100
}
```

### `core.files.writeText`

Permission:
- `fs.write`

Arguments:
```json
{
  "path": "notes/demo.txt",
  "content": "Hello from extension workspace"
}
```

Ghi chú:
- `path` phải là relative path
- core sẽ resolve vào workspace riêng của extension

### `core.files.writeBase64`

Permission:
- `fs.write`

Arguments:
```json
{
  "path": "exports/demo.pptx",
  "base64": "UEsDB..."
}
```

Ghi chú:
- dùng cho binary file như `.pptx`
- `path` vẫn phải là relative path
- core sẽ decode base64 rồi ghi bytes vào workspace riêng của extension

### `core.files.readText`

Permission:
- `fs.read`

Arguments:
```json
{
  "path": "notes/demo.txt"
}
```

### `core.artifacts.register`

Permission:
- `core.artifacts`

Arguments:
```json
{
  "path": "exports/demo.pptx",
  "mimeType": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "kind": "presentation",
  "metadata": {
    "title": "Demo deck"
  },
  "retention": "default"
}
```

Ghi chú:
- `path` phải là relative path trong workspace của extension.
- artifact sẽ được ghi với `source=extension:<extensionId>`.
- core lưu metadata gồm path, mime, kind, source, sourceTool, bytes, sha256, retention, createdAtMs.
- Với các Python extension tool bundled đang tạo file (`drawio.create_diagram`, `slides.create_deck`, `slides.export_pptx`, `document.create_artifact`, `document.import_artifact`, `document.convert_artifact`), Rust bridge tự động register artifact khi tool result có `extensionId`, `toolName` và `resolvedPath`.
- Tool result sau đó được gắn thêm `artifactId` và `artifact` để UI hoặc agent có thể tham chiếu artifact store trực tiếp.

### `core.artifacts.list`

Permission:
- `core.artifacts`

Arguments:
```json
{
  "kind": "presentation",
  "limit": 20
}
```

Ghi chú:
- extension chỉ nhìn thấy artifact có `source=extension:<extensionId>` của chính nó.

### `core.artifacts.open`

Permission:
- `core.artifacts`

Arguments:
```json
{
  "id": "artifact-..."
}
```

### `core.artifacts.reveal`

Permission:
- `core.artifacts`

Arguments:
```json
{
  "id": "artifact-..."
}
```

### `core.agent.run`

Permission:
- `core.agent`

Mục đích:
- one-shot call tới main AI Agent đang được Galaxy Quasar chọn

Arguments:
```json
{
  "prompt": "Tóm tắt extension platform của Galaxy Quasar",
  "assistantMode": false,
  "allowTools": false
}
```

Ghi chú:
- không stream token
- không ghi vào transcript chat chính
- trả text hoàn chỉnh cùng `provider`, `model`, `thinking`

### `core.agent.stream`

Permission:
- `core.agent`

Mục đích:
- stream contract cho extension runtime qua event bus

Arguments:
```json
{
  "prompt": "Tóm tắt extension platform của Galaxy Quasar",
  "assistantMode": false,
  "allowTools": false
}
```

Kết quả trả về ngay:
```json
{
  "streamId": "extension-stream-...",
  "event": "extension-core-stream"
}
```

Ghi chú:
- phase hiện tại là `synthetic stream`
- core chạy one-shot agent rồi phát delta qua event bus
- mục tiêu là chốt contract trước, chưa ép mở sâu vào sidecar streaming

### `core.stt.transcribeAudio`

Permission:
- `core.stt`

Arguments:
```json
{
  "audioDataUrl": "data:audio/wav;base64,...",
  "sttContext": "generic",
  "referenceText": null,
  "sttProviderOverride": "deepgram"
}
```

Ghi chú:
- dùng lại chính STT backend của Galaxy
- nếu runtime đã enroll voice thì vẫn có thể áp speaker profile

### `core.ui.openPanel`

Permission:
- `core.ui`

Arguments:
```json
{
  "title": "Slides Assistant",
  "subtitle": "galaxy.slides-tools",
  "badge": "running"
}
```

Ghi chú:
- mở secondary message panel ở màn chat chính
- main chat vẫn nằm bên trái, extension surface nằm bên phải

### `core.ui.postMessage`

Permission:
- `core.ui`

Arguments:
```json
{
  "id": "slides-plan-1",
  "role": "assistant",
  "content": "Đang tạo outline deck...",
  "status": "streaming"
}
```

### `core.ui.updateMessage`

Permission:
- `core.ui`

Arguments:
```json
{
  "id": "slides-plan-1",
  "patch": {
    "content": "Outline deck đã sẵn sàng.",
    "status": "done"
  }
}
```

### `core.ui.clearMessages` / `core.ui.closePanel` / `core.ui.setViewState`

Permission:
- `core.ui`

Ghi chú:
- `clearMessages` xóa transcript phụ của extension
- `closePanel` đóng secondary panel
- `setViewState` cập nhật `title`, `subtitle`, `icon`, `badge`

### `core.marketData.quote`

Permission:
- `core.marketData`

Arguments:
```json
{
  "symbol": "AAPL",
  "market": "US"
}
```

Result:
```json
{
  "quote": {
    "provider": "stooq",
    "symbol": "AAPL",
    "market": "US",
    "open": 190.1,
    "high": 192.0,
    "low": 188.5,
    "close": 191.2,
    "volume": 12345678
  }
}
```

Ghi chú:
- bản đầu dùng provider public Stooq, phù hợp cho quote snapshot đơn giản.
- core cache quote bằng SQLite TTL ngắn để scheduler/extension không gọi provider lặp quá dày.
- fundamentals, filings và rate limit/source reliability sẽ tách tiếp ở phase sau.

### `core.marketData.history`

Permission:
- `core.marketData`

Arguments:
```json
{
  "symbol": "AAPL",
  "market": "US",
  "interval": "d",
  "limit": 90
}
```

Result:
```json
{
  "provider": "stooq",
  "source": "https://stooq.com/q/d/l/?s=aapl.us&i=d",
  "candles": [
    { "date": "2026-05-19", "open": 190.1, "high": 192, "low": 188.5, "close": 191.2, "volume": 12345678 }
  ]
}
```

Ghi chú:
- interval hỗ trợ `d`, `w`, `m`.
- `limit` bị clamp trong khoảng 1-500 để tránh tải quá nhiều.
- core cache historical candles bằng SQLite TTL dài hơn quote.

### `core.news.search`

Permission:
- `core.news`

Arguments:
```json
{
  "symbol": "AAPL",
  "market": "US",
  "limit": 10
}
```

Result:
```json
{
  "provider": "yahoo_finance_rss",
  "source": "https://feeds.finance.yahoo.com/rss/2.0/headline?s=AAPL&region=US&lang=en-US",
  "items": [
    {
      "title": "AAPL headline",
      "link": "https://...",
      "publishedAt": "Fri, 22 May 2026 00:00:00 GMT",
      "summary": "..."
    }
  ]
}
```

Ghi chú:
- bản đầu lấy public RSS headline và cache bằng SQLite TTL 30 phút.
- dùng cho extension cần market/news context mà không tự quản path/cache/provider.

### `core.notifications.notify`

Permission:
- `core.notifications`

Arguments:
```json
{
  "title": "AAPL risk alert",
  "body": "AAPL giảm dưới stop loss đã cấu hình.",
  "severity": "warning",
  "actions": [
    { "id": "open", "label": "Open analysis" }
  ],
  "metadata": {
    "ticker": "AAPL",
    "positionId": "pos_..."
  }
}
```

Ghi chú:
- core tự gắn `source=extension:<extensionId>`.
- notification được lưu trong SQLite và emit event `core-notification`.
- phase hiện tại là in-app persisted notification, chưa nối OS notification.

### `core.assistant.inbox.createAlert`

Permission:
- `core.assistant.inbox`

Arguments:
```json
{
  "title": "Position thesis changed",
  "summary": "XXX có tin tức trái chiều lớn, confidence giảm từ 72 xuống 48.",
  "severity": "critical",
  "requiresUserAttention": true,
  "payload": {
    "ticker": "XXX",
    "positionId": "pos_...",
    "predictionId": "pred_..."
  }
}
```

Ghi chú:
- core tự gắn `source=extension:<extensionId>`.
- inbox item được lưu trong SQLite và emit event `assistant-inbox-alert`.
- đây là đường chính thức để extension báo việc cần user/main Agent chú ý, thay vì ghi thẳng vào transcript chính.

## Scheduler Extension Job

`core.scheduler.schedule` hiện hỗ trợ `actionType=extension_job`.

Arguments:
```json
{
  "title": "Monitor AAPL position",
  "scheduleType": "interval",
  "actionType": "extension_job",
  "intervalSeconds": 1800,
  "actionPayload": {
    "extensionId": "galaxy.stock-advisor",
    "handler": "stock.monitorPosition",
    "payload": {
      "positionId": "pos_..."
    }
  },
  "missedRunPolicy": "run_immediately",
  "maxAttempts": 3,
  "backoffSeconds": 60,
  "idempotencyKey": "stock-monitor:AAPL:pos_..."
}
```

Ghi chú:
- khi extension gọi qua Core API, Rust sẽ ép `actionPayload.extensionId` về chính extension đang gọi.
- frontend scheduler runtime gọi `executeExtensionCommand(handler, payload)` khi task due.
- run result/error vẫn được lưu vào `scheduled_task_runs`.

## Event Bus Contract

### Event: `extension-core-stream`

Payload:
```json
{
  "extensionId": "galaxy.slides-tools",
  "streamId": "extension-stream-...",
  "action": "core.agent.stream",
  "phase": "started | delta | done | error",
  "delta": "...",
  "content": "...",
  "thinking": "...",
  "provider": "Manual",
  "model": "qwen3.5:397b-cloud",
  "error": null
}
```

Quy ước:
- `started`: stream bắt đầu
- `delta`: text delta
- `done`: đã hoàn tất, có thể kèm `content` đầy đủ
- `error`: stream lỗi

### Event: `extension-ui-panel`

Payload:
```json
{
  "extensionId": "galaxy.slides-tools",
  "action": "postMessage",
  "message": {
    "id": "slides-plan-1",
    "role": "assistant",
    "content": "Đang tạo outline deck...",
    "status": "streaming"
  }
}
```

### Event: `core-notification`

Payload là notification record đã persist:
```json
{
  "id": "notification-...",
  "title": "AAPL risk alert",
  "body": "AAPL giảm dưới stop loss đã cấu hình.",
  "severity": "warning",
  "source": "extension:galaxy.stock-advisor",
  "createdAtMs": 1780000000000
}
```

### Event: `assistant-inbox-alert`

Payload là inbox item đã persist:
```json
{
  "id": "inbox-...",
  "title": "Position thesis changed",
  "summary": "Confidence giảm mạnh.",
  "severity": "critical",
  "source": "extension:galaxy.stock-advisor",
  "requiresUserAttention": true,
  "status": "open"
}
```

## Gợi ý roadmap tiếp theo

Khi phase nền ổn định, mở tiếp theo thứ tự:
- `core.agent.stream` thật sự bám token stream của main agent
- `core.files.readBinary/writeBinary`
- `core.events.*`
- `core.stt.record` hoặc live audio capture contract cho extension

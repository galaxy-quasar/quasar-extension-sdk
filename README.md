# @galaxy-stack/quasar-sdk

**Galaxy Quasar extension contract** — single source of truth cho Core API schema,
manifest schema và generator sinh artifact đa ngôn ngữ (TypeScript / Rust / Python).

| File | Vai trò |
|---|---|
| `schemas/core-api.schema.json` | Định nghĩa `apiVersion`, actions (key/name/permission), payload & result types |
| `schemas/manifest.schema.json` | Schema cho `manifest.json` của từng extension |
| `generate-extension-sdk.mjs` | Generator — đọc schema, sinh 3 artifact + copy schema vào consumer |
| `SDK_CONTRACT.md` | Hợp đồng SDK đầy đủ giữa Quasar core và extension runtime |

## Generate artifacts cho consumer (quasar shell)

```bash
node generate-extension-sdk.mjs \
  --ts <shell>/src/features/extensions/sdk/galaxy-core.generated.ts \
  --rust <shell>/src-tauri/src/extension_core_api/generated.rs \
  --python <shell>/python/galaxy_ai/extension_core_api_generated.py \
  --schema-copy-dir <shell>/extensions
```

Quy tắc:

- Đổi contract = sửa schema ở đây, bump `apiVersion`, rồi chạy generator cho
  từng consumer; CI của consumer kiểm tra generated artifacts khớp schema.
- Generated artifacts được commit trong consumer repo (Rust cần `include_str!`,
  Python cần import runtime) — nhưng không bao giờ sửa tay.
- TS SDK facade (`createGalaxyCore`) nằm trong shell vì nó dính transport IPC
  của shell; sẽ tách thành npm package khi extension webview cần (Phase 2).

Part of the [Galaxy Quasar](https://github.com/galaxy-quasar/galaxy-quasar) line.

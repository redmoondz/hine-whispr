# Hina Desktop + OpenClaw Dashboard — Architecture

> Статус: черновик Stage 1 (аудит). Автор: Hina (техруководитель), Codex CLI — исполнитель.
> Дата: 2026-10-21

## 1. Цель и границы

Три взаимосвязанных компонента поверх форка OpenWhispr, глубоко интегрированные
в существующий OpenClaw (не вторая независимая система):

1. **Hina Desktop** — форк OpenWhispr (Electron/React/TS). Голос, хоткеи, локальный STT/TTS, Hands.
2. **Hina Connector** — мост Desktop ↔ OpenClaw Gateway.
3. **Hina Dashboard** — веб-интерфейс внутри OpenClaw, визуально согласованный с OpenWhispr.

Жёсткие ограничения (из ТЗ):
- **Не создавать второй независимый агент.** Все команды идут в существующего агента Hina через официальный интерфейс OpenClaw.
- **Не ломать установленный OpenClaw.** Никаких прямых правок `~/.npm-global/lib/node_modules/openclaw`. Dashboard — отдельный маршрут/плагин/портал.
- **Не хранить секреты** в коде/логах; аутентификация локальных API обязательна.
- **Не обходить OpenRouter напрямую** — Desktop не держит ключи провайдера; весь LLM-трафик идёт через OpenClaw.

## 2. Факты аудита (зафиксировано, не выдумано)

### 2.1 Окружение

| Параметр | Значение |
|---|---|
| Host | Windows 11 |
| WSL2 | Ubuntu, пользователь `redmoon`, HOME `/home/redmoon` |
| GPU | RTX 5070 12 GB. `/dev/dxg` есть; WSL CUDA-библиотеки (`/usr/lib/wsl/lib/{libcuda,libnvidia-ml,...}`) есть. `cuInit`/`cuDeviceGet` возвращают 0 (CUDA runtime работоспособен), **но** `nvidia-smi` падает с segfault — значит утилита-срез состояния GPU недостоверна, а runtime — проверять отдельно на ctranslate2/whisper.cpp |
| Node | 24.22.0 (в WSL2) |
| Python | 3.14.4 (системный), `uv` 0.12.22 |
| Codex CLI | 0.163.0, залогинен (`codex doctor` OK, есть неблокирующие ⚠ mcp/threads) |
| OpenClaw | 2026.10.5, Gateway на `ws://127.0.0.1:18789` (loopback), auth `mode=token` |
| Проекты | `/home/redmoon/projects/{bluesky_research, olx-watch, olx_scraper, telegram_rss_news, teq_analytic_model_etl}` |

### 2.2 OpenWhispr (upstream)

- Репозиторий: `OpenWhispr/openwhispr`, v1.10.4, лицензия открытая.
- Стек: Electron + React + TypeScript + Vite. `main.js` (2142 строк) + `preload.js` (1453) + `src/` (1216 файлов). Мобильный Expo — в `openwhispr-mobile/` (вне scope).
- Node 24+. `npm install` + `npm run dev`.
- Много платформо-специфичных нативных сборок (`scripts/build-*.js`: win/mac/linux key listener, fast-paste, mic listener, system audio). Windows-ветки есть (`winkeys`, `winpaste`, `windows-mic-listener`, `windows-system-audio-helper`).
- STT: `whisper.cpp`, `sherpa-onnx` (Parakeet/Whisper), локально или облако. GPU-паки (`src/utils/whisperGpuPack.ts`). Есть `src/locales/ru/` — русская локализация уже есть.
- Горячие клавиши: `src/utils/hotkeys.ts`, `globalShortcut` в main/preload.
- TTS локальный (sherpa-onnx). LLM — через `@ai-sdk/*` (anthropic, openai, google, groq, tinfoil, bedrock, azure) + встроенная поддержка OpenRouter для «voice assistant». `src/services/ai/*`, `BaseReasoningService.ts`, `ReasoningService.ts`.
- Хранилище: `better-sqlite3` + `kysely` + zustand (`src/stores/settingsStore.ts`, `src/helpers/database.js`). Единый источник настроек — settings store.
- Hands-аналоги (коннекторы к внешним сервисам): `src/helpers/connectors/*` — GitHub/Slack/Gmail/Linear/email, `connectorPolicy.js`, `pendingActions.js`, `actionLog.js`. Это — отправная точка для блока «Hands» (управление браузером/приложениями — отдельно добавить).
- Custom ASR shim (`examples/custom-asr-shim/`): OpenWhispr шлёт `multipart` на `POST {URL}/audio/transcriptions` в OpenAI-формате, ждёт `{"text": ...}`. Это — готовый контракт для подмены STT-энпоинта на свою реализацию.
- Публичный API/MCP есть у upstream (notes/transcriptions) — полезен как референс контракта, не как замена нашему Connector.

### 2.3 OpenClaw — поддерживаемые способы расширения (не ломая установку)

Из docs OpenClaw 2026.10.5:

1. **Плагины** (`plugins/feature-plugins.md`, `building-plugins.md`, `sdk-*`):
   - **Feature plugin** — может добавлять «нативные страницы» Control UI (Custom plugin UI, Settings → Labs), панели, dashboard-виджеты, header-аксессуары. Это каноничный способ получить *отдельную вкладку внутри интерфейса OpenClaw*.
   - Tool plugin / provider / CLI backend — другие формы, для нас не главные.
   - API experimental: пинить хост-версию, тестить.
2. **Control UI** — Vite + Lit SPA, раздаётся Gateway на `http://host:18789/`. Говорит напрямую с Gateway WebSocket.
3. **Dashboard-виджеты** — sandboxed HTML-виджеты (отдельная поверхность).
4. **Portal** — прокидывает dev-server (HTTP+WS) как отдельный origin в Control UI → Portals. Подход для «независимого веб-интерфейса с интеграцией», если нативная страница не подойдёт.
5. **Gateway WS protocol** (`gateway/protocol.md`) — единый control plane (роли/scope, RPC-методы). Через него работает и chat, и agent turns.
6. **HTTP API**:
   - `POST /tools/invoke` (`tools-invoke-http-api.md`) — вызов одного инструмента; **полное operator-право (опасно), держать только на loopback**.
   - OpenAI-compatible `/v1/*` и OpenResponses `/v1/responses*` — поверхности совместимости.
7. **CLI agent turn**: `openclaw agent --agent hina -m "..." --json` — запускает turn существующего агента через Gateway (сохраняет его тулзы/контекст/разрешения). Также `openclaw agent exec` (изолированный embedded turn).

### 2.4 Windows ↔ WSL2

- Gateway слушает loopback в WSL2. Из Windows WSL2-порты доступны через `localhost` (mirrored networking включается; иначе — через WSL IP или `netsh interface portproxy`). Это надо проверить на живой машине, не предполагать.
- STT/TTS/GPU — в Desktop (Windows), GPU-пути CUDA — на RTX 5070 на Windows-стороне; WSL2 CUDA runtime есть, но для Desktop он не обязателен.

## 3. Компонентная архитектура

```
┌─────────────────────────────── Windows ───────────────────────────────┐
│  Hina Desktop (Electron, форк OpenWhispr)                            │
│   ├─ Hotkey → Audio capture → локальный STT (whisper.cpp/sherpa)     │
│   ├─ TTS (sherpa-onnx, ru)                                           │
│   ├─ Context: активное окно / скриншот (opt-in)                      │
│   └─ Hands: браузер + разрешённые приложения (подтверждение)         │
└────────────────────────────┬──────────────────────────────────────────┘
                             │ Hina Connector (WS/HTTP, auth)
┌────────────────────────────▼──────────────────────────────────────────┐
│  WSL2 (Ubuntu, redmoon)                                              │
│   ├─ Hina Connector (backend: FastAPI или Node)                     │
│   │    ├─ валидация/версионирование настроек, конфликты             │
│   │    ├─ бидер: Desktop ⇄ Dashboard                                 │
│   │    └─ вызов агента: `openclaw agent --agent hina … --json`       │
│   ├─ OpenClaw Gateway (ws://127.0.0.1:18789, auth token)            │
│   │    └─ агент Hina (tools/memory/permissions уже существующие)     │
│   └─ Hina Dashboard (feature plugin page OR portal)                 │
└───────────────────────────────────────────────────────────────────────┘
```

Поток голосовой команды:

```
Hotkey → capture → STT(локально) → Connector → openclaw agent --agent hina
       → (потоковый ответ через Gateway session) → TTS(локально) → playback
```

## 4. Ключевые решения (обоснование)

- **Desktop = форк OpenWhispr**, а не с нуля: берём готовые hotkey/audio/STT/TTS/UI/store. Правки — в отдельной ветке `hina-desktop` от upstream, с rebase-совместимостью.
- **Connector = отдельный backend-процесс** (не внутри Electron, не внутри Gateway): единая точка аутентификации, настроечного контракта и вызова агента. Делаем на Node (близко к стеку OpenWhispr) или FastAPI (близко к whisper-экосистеме). Решение — зафиксировать до начала Stage 2; MVP стартует с Node, чтобы reuse типов/контрактов OpenWhispr.
- **Вызов агента — официальный CLI `openclaw agent`**, а не прямой OpenRouter и не /tools/invoke (последний слишком широк). Потоковость: MVP — `--json` (полный текст-ответ); стриминг добавить через Gateway WS protocol/сессию на Stage 2+/3.
- **Dashboard — сначала feature plugin (нативная страница)**. Если Custom plugin UI не подходит/выключен, fallback: portal (независимый origin, интеграция через Gateway WS). Ограничение документировать явно.
- **Единый контракт настроек** с версионированием (`schemaVersion` + `revision`), last-write-wins с явным ack «applied vs saved», защита от циклов синхронизации (игнор собственных echo, сравнение по ревизии).
- **Аутентификация локальных API** — token-борт на Connector; секреты только через env/OpenClaw secrets, не в git.

## 5. Открытые вопросы — статус

1. ✅ **Windows↔WSL2**: `mirrored` НЕ включён (`/etc/wsl.conf` — только `systemd`, `.wslconfig` — memory/autoMemoryReclaim). Значит Windows→WSL2 нет гарантированного `localhost`-проброса ⇒ Dashboard/Desktop обращаются к Connector через WSL2 IP или `netsh portproxy`, либо включаем mirrored networking. **Решено: MVP — Connector слушает `0.0.0.0`, Desktop задаёт адрес в настройках.**
2. ✅ **CUDA**: `ctranslate2` и `torch` в Python НЕ установлены. Путь Desktop — нативные `whisper.cpp`/`sherpa-onnx` на GPU Windows-стороны; Python-стек не используется для STT/TTS. `nvidia-smi` segfault — пред-existing проблема WSL-драйвера, **не** влияет на Windows-native GPU. Честный статус GPU в Dashboard — только из Windows-стороны (позже).
3. ⏳ **Streaming**: CLI `openclaw agent` даёт финальный JSON; стриминговый канал через Gateway WS — подтвердить метод на живой сессии (Stage 2+).
4. ⏳ **Аудио-девайсы/хоткеи Windows**: в upstream есть `winkeys`, `windows-mic-listener`, `windows-system-audio-helper` — проверить сборку/работу при форке (Stage 2).
5. ✅ **Dashboard-монтирование**: `gateway.controlUi` / Custom plugin UI — ключ unset ⇒ runtime default **выключен**. Нативная страница требует включения Labs. **Решено: MVP Dashboard — portal (независимый origin, интеграция через Gateway WS), документируем ограничение; нативную страницу — опционально после включения Labs.**

## 6. Безопасность

- Локальные API только loopback/private; bearer auth обязателен.
- Секреты — env/OpenClaw secrets; `git log`/код/дашборд без секретов.
- Dashboard не должен давать произвольный доступ к системным командам (никакого raw shell в UI).
- Hands: внешние действия (браузер/файлы) — только с явным подтверждением, журнал операций.
- Корпоративные/рабочие устройства и данные — не подключаем без разрешения.
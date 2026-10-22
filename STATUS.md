# Hina Desktop + OpenClaw Dashboard — status (live)

> Ведётся Hina. Обновляется после каждого проверенного этапа. Не выдуманные данные.

## Verified (реально прогнано из WSL2)

| Компонент | Статус | Доказательства |
|---|---|---|
| Stage 1 — Аудит + план + форк | ✅ | commits 4bcb433, ed3b29b |
| Connector: `/health`, `/command` | ✅ | 27→56 тестов; живой agent-turn `{"reply":"OK"}` |
| Connector: `/v1/chat/completions` (OpenWhispr self-hosted, SSE) | ✅ | 56/125 тестов; живой non-streaming + SSE `[DONE]` |
| Connector: `/settings` GET/PUT/applied (revision + conflict) | ✅ | 103/125 тестов; живой цикл 200/409/400/401 |
| Connector: `/metrics` + loopback CORS | ✅ | 125/125 тестов; живой counters/CORS204/401 |
| Dashboard MVP (React/Vite + server-side token proxy) | ✅ | build OK; 5/5 proxy-тестов; portal: index 200, asset 200, `/api/*` 200 |

Commits: 22e21d3 → b86e8ad → 0a12a1e → b14e005 → 4042e8d → 89f3e4e.

## Ключевые архитектурные факты (проверено, не домыслы)

- Desktop **не требует форка поведения**: OpenWhispr self-hosted reasoning уже
  говорит OpenAI `/v1/chat/completions` (SSE `delta.content` + `[DONE]`),
  ASR-shim — `POST /audio/transcriptions`. Connector даёт совместимый эндпоинт.
- agent-turn: только `openclaw agent --agent hina --json`; маркер
  `OPENCLAW_SHELL=exec` отклоняет agent-turn в exec-контексте → Connector/Dashboard
  запускаются отдельными процессами (`env -u OPENCLAW_SHELL -u OPENCLAW_CLI`).
- Токен Connector — только в env, server-side; браузер Dashboard ходит только
  в `/api/*` своего origin (прокси подставляет bearer). Ключей провайдера в
  Desktop нет — весь LLM через OpenClaw.

## Блокеры / внешние зависимости

- **Desktop голосовая цепочка (hotkey→STT→TTS)**: требует Windows host
  (Electron/audio/горячие клавиши/TTS) — из WSL2 не прогоняется. Нужен прогон
  на Windows-стороне (Companion node или вручную).
- **Визуальный рендер Dashboard в браузере**: headless Chromium в WSL2 не
  стартует (нет `libnspr4.so`) — pixel-проверка недоступна; приложение
  проверено на уровне build + serve + полного API.

## Следующие этапы

- Stage 4 — Hands (браузер/приложения, обязательное подтверждение).
- Stage 5 — Analytics (только реальные метрики: `/metrics`, латентности,
  токены OpenClaw если доступны).
- Вернуться к Desktop-цепочке, когда доступен Windows host.
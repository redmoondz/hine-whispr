# Hina Desktop + OpenClaw Dashboard — Implementation Plan

> Автор: Hina (техруководитель). Исполняет: Codex CLI. Проверяет: Hina.
> Дата: 2026-10-21.

## Принципы

- Маленькие проверяемые этапы, каждый с: что сделано / файлы / тесты / проблемы / как проверить вручную.
- Отдельные git-ветки, тесты обязательны, «успех» только после реальной проверки.
- Не трогать установленный OpenClaw. Не создавать второго агента. Не выдумывать метрики.

## Этап 1 — Audit (текущий)

- [x] Проверить Codex CLI доступен (`codex` 0.163.0, doctor OK).
- [x] Изучить upstream OpenWhispr (стек, STT/TTS/hotkeys/store/connectors/ASR-shim).
- [x] Изучить способы расширения OpenClaw UI (feature plugin / portal / dashboard / WS / HTTP API / CLI agent).
- [x] Зафиксировать Windows↔WSL2 и GPU/CUDA статус (частично — см. ARCHITECTURE §5).
- [x] Создать repo `hina-desktop`, `ARCHITECTURE.md`, `IMPLEMENTATION_PLAN.md`.
- [ ] Закрыть «открытые вопросы» живыми проверками (mirrored networking, CUDA runtime, streaming канал, Custom plugin UI).

## Этап 2 — Desktop MVP (форк)

Цель: `Hotkey → STT → Hina → TTS`.

1. Форк OpenWhispr в `desktop/` (git clone upstream → ветка `hina-desktop`).
2. Минимальная правка: Voice Assistant hotkey → отправить расшифровку в Hina Connector (вместо/рядом со встроенным reasoning).
3. Локальный STT русский (пин модели), локальный TTS ru — проверить на Windows.
4. Приём ответа → TTS → playback.
5. Конфиг девайсов/моделей/языка/VAD/TTS — из единого контракта (Read from Connector).
6. Тесты: unit на контракт/парсинг, интеграционный прогон цепочки.

## Этап 3 — Connector MVP

1. Backend-процесс (Node/FastAPI) в WSL2: WS+HTTP, bearer auth.
2. `POST /command` → `openclaw agent --agent hina --json` (или WS-сессия) → ответ обратно.
3. Контракт настроек: `GET/PUT /settings` с schemaVersion+revision, ack applied/saved.
4. Бидер Desktop ⇄ Dashboard (WebSocket), защита от echo-циклов, online/offline, reconnect.
5. Тесты: контракт, auth, lint.

## Этап 4 — Dashboard MVP

1. Выбрать способ монтирования: feature plugin (нативная страница) — при недоступности portal. Задокументировать.
2. Вкладки: Overview (статус Desktop/Gateway/модель/GPU/счётчик/задержка), Voice (модель/язык/девайс/VAD/TTS/хоткеи), Agent (статус, история команд, ошибки, подтверждения).
3. Связь с Connector (единый контракт настроек, история).
4. Тесты: рендер контракта, синхронизация.

## Этап 5 — Hands

1. Управление браузером + разрешённые приложения, контекст окна, режим подтверждения, журнал операций.
2. Подтверждение внешних действий — обязательно.

## Этап 6 — Analytics

1. Реальные метрики: запросы по дням, задержки STT/LLM/TTS, CPU/GPU (если честно доступно), ошибки STT, токены OpenRouter (из OpenClaw), распределение команд, аптайм.
2. Никаких выдуманных цифр.

## Отчёт после каждого этапа

1. Что реализовано.
2. Изменённые файлы.
3. Пройденные тесты.
4. Оставшиеся проблемы.
5. Ручная проверка результата.
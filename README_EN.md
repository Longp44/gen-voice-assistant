# Gen (Gèn)

**A voice-first personal AI assistant** — realtime voice chat, diary, meeting transcription with AI summaries, notification archive, email, and calendar.
Web app + Android APK, single-node self-hosted deployment; phone and computer share the same data, and **all data stays on your own server**.

> This project is a fork of [qwen-audio-agent](https://github.com/QwenLM/qwen-audio-agent) 2.1.0 (Apache-2.0).
> Modifications are marked with `GEN-MOD` comments. 中文说明见 [README.md](README.md)。

## Features

| Module | Capabilities |
|:---|:---|
| Chat | Full-duplex realtime voice, barge-in, text input, image understanding, history, multi-device |
| Diary | Timeline / files / creative / notification views, five source types, AI daily summary, export, trash |
| Meeting | Recording (continues on Android lock screen), live subtitles, transcription, speaker separation, AI summary |
| Notifications | Android notification listener → classify/redact → upload → diary (APK only) |
| Email | IMAP receive, send, spam flagging (163.com adapted) |
| Calendar | Todos / events |
| Settings | Voice model / main model switch, voice preview, speech rate, phone sync permissions |
| Android APK | WebView shell + notification listener + lock-screen recording foreground service + JS bridge |

## Quick Start

### Option A: Docker (recommended)

```bash
git clone https://github.com/Longp44/gen-voice-assistant.git
cd gen-voice-assistant
mkdir -p runtime && cp config.env.example runtime/config.env
# edit runtime/config.env: fill in DashScope / DeepSeek API keys
docker compose up -d --build
# open http://server-ip:3201
```

### Option B: install script (Linux / macOS)

```bash
git clone https://github.com/Longp44/gen-voice-assistant.git
cd gen-voice-assistant
bash scripts/install.sh        # checks Node version, installs deps, builds, creates runtime/
vim runtime/config.env         # fill in API keys
bash scripts/start.sh          # start in background; stop.sh to stop
```

Requires Node.js `^22.22.2 || ^24.15.0`.

### Option C: developers

```bash
npm ci && npm run build
QWAUDIO_CONFIG_DIR=./runtime QWAUDIO_STATE_DIR=./runtime/state \
QWAUDIO_DATA_DIR=./runtime/data DSH_HOME=./runtime/dsh-home \
node cli/bin/qwenaudio.mjs gateway
```

## Configuration

All secrets live in `runtime/config.env` (template: [config.env.example](config.env.example)).
Full variable table: [docs/配置说明.md](docs/配置说明.md). You bring your own API keys — this repo ships none.

| Key | Purpose | Where to get it |
|:---|:---|:---|
| `QWEN_AUDIO_REALTIME_API_KEY` | Alibaba Cloud DashScope (realtime voice / ASR / vision, **required**) | https://bailian.console.aliyun.com/ |
| `DEEPSEEK_API_KEY` | DeepSeek (main model / background tasks / summaries, optional) | https://platform.deepseek.com/ |
| `GEN_PUBLIC_BASE_URL` | Public base URL for media links (default `http://127.0.0.1:3201`) | — |
| `QWEN_AUDIO_AGENT_ALLOWED_ORIGINS` | Allowed browser origins (required on public deployments) | — |

## Android APK

The APK is a WebView shell with the **server address baked in** — repackage it yourself (5 minutes):

1. Deploy the server (HTTPS + domain recommended)
2. Edit the `APP_URL` / `BASE` constants per [docs/手机APK使用.md](docs/手机APK使用.md), then `bash build.sh`
3. Install on your phone → grant microphone / camera / notification permissions
4. Pair your device (run on the server, open the printed link in the phone browser):

```bash
node cli/bin/qwenaudio.mjs gateway pair --name my-phone --endpoint https://your-domain.com
```

## Server deployment

Templates in [deploy/](deploy/): systemd unit (with auto-restart), watchdog timer, daily backup timer, and an nginx HTTPS/WebSocket reverse-proxy config. Details: [docs/部署.md](docs/部署.md).

## Privacy & Security

- **Your data stays on your server**: recordings, notifications and diary entries are sensitive — self-host only
- Always enable HTTPS (Let's Encrypt) on public deployments and keep device pairing links private
- Never commit or expose the `runtime/` directory

## Known Limitations

- **Single-user design**: built for personal use, not multi-tenant SaaS; shared use requires your own auth layer
- **Cost**: DashScope voice/ASR is metered (realtime ≈ ¥1–3/hour, file transcription ≈ ¥0.3/hour); DeepSeek is per-token — BYO keys
- **Android**: notification access needs manual authorization; some OEMs restrict background execution; lock-screen recording relies on a foreground service; no iOS support
- **Browser**: automatic notification capture is APK-only; PWA can only upload manually
- **External dependencies**: voice/chat/summaries fail when DashScope or DeepSeek is unreachable
- **DSH optional**: without [@deepseek-ai/dsh](https://www.npmjs.com/package/@deepseek-ai/dsh), voice chat works but "background/main-model tasks" are unavailable

## License & Credits

- Fork of [qwen-audio-agent](https://github.com/QwenLM/qwen-audio-agent) 2.1.0, **Apache-2.0**, modifications marked `GEN-MOD`; upstream [LICENSE](LICENSE), [NOTICE](NOTICE), [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) retained
- Runtime dependency [@deepseek-ai/dsh](https://www.npmjs.com/package/@deepseek-ai/dsh) (MIT, installed externally, not bundled)
- Voice by Alibaba Cloud [DashScope](https://bailian.console.aliyun.com/), main model by [DeepSeek](https://platform.deepseek.com/)

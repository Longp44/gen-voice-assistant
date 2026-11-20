# 艮（Gèn）Docker 镜像：多阶段构建（构建 → 精简运行镜像）
# 注意：DSH（后台执行/主模型任务）为可选外部依赖，默认不内置；
#       需要时在运行容器中自行 npm i -g @deepseek-ai/dsh，见 docs/配置说明.md

FROM node:24-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server server
COPY web web
COPY cli cli
COPY shared shared
COPY packages packages
COPY config config
RUN npm ci --no-audit --no-fund && npm run build && npm prune --omit=dev

FROM node:24-bookworm
ENV NODE_ENV=production \
    PORT=3201 \
    HOST=0.0.0.0 \
    QWAUDIO_CONFIG_DIR=/app/runtime \
    QWAUDIO_STATE_DIR=/app/runtime/state \
    QWAUDIO_DATA_DIR=/app/runtime/data \
    DSH_HOME=/app/runtime/dsh-home \
    QWEN_AUDIO_AGENT_COMPUTER_USE=false
WORKDIR /app
COPY --from=build /app ./
RUN mkdir -p /app/runtime/state /app/runtime/data /app/runtime/dsh-home /app/runtime/backups
VOLUME /app/runtime
EXPOSE 3201
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3201)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "cli/bin/qwenaudio.mjs", "gateway"]

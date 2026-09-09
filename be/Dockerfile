# syntax=docker/dockerfile:1.6
###############################################################################
# unified-service : 모든 백엔드 앱을 빌드 시점에 컴파일해 하나의 이미지에 담는다.
#   - 같은 이미지를 SERVICE_NAME(또는 command) 만 바꿔 서비스별 컨테이너로 실행한다.
#   - 배포 대상: event_receiver / event_analyzer / action_runner /
#               report_manager / config_manager / llm_gateway / ai_chat_service
###############################################################################
ARG PNPM_VERSION=10.28.2

FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

###############################################################################
# build : 의존성 설치 + 공용 패키지/앱 컴파일
###############################################################################
FROM base AS build

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps ./apps
COPY packages ./packages

RUN pnpm install --frozen-lockfile

# 공용 패키지 선빌드 (앱이 workspace:* 로 참조)
RUN pnpm --filter @ai-log/shared-contracts build \
 && pnpm --filter @ai-log/http-api build

# 배포 대상 앱 빌드 → 각 apps/<svc>/dist/main.js 생성
RUN pnpm --filter ./apps/config_manager build \
 && pnpm --filter ./apps/event_receiver build \
 && pnpm --filter ./apps/event_analyzer build \
 && pnpm --filter ./apps/action_runner build \
 && pnpm --filter ./apps/report_manager build \
 && pnpm --filter ./apps/llm_gateway build \
 && pnpm --filter ./apps/ai_chat_service build

# demo(Next.js) 앱 빌드 → apps/demo/.next 생성
RUN pnpm --filter ./apps/demo build

###############################################################################
# runtime
###############################################################################
FROM base AS runtime
ENV NODE_ENV=production
ENV AWS_DEFAULT_REGION=ap-northeast-2
ARG CHAT_INFO_RAG_MIN_SCORE=1.5
ARG CHAT_INFO_RAG_SCREEN_BONUS=0.5
ARG CHAT_INFO_NODE_GUIDE_FALLBACK_CHUNK_KEYS=taskflow-ifthen
ENV CHAT_INFO_RAG_MIN_SCORE=${CHAT_INFO_RAG_MIN_SCORE}
ENV CHAT_INFO_RAG_SCREEN_BONUS=${CHAT_INFO_RAG_SCREEN_BONUS}
ENV CHAT_INFO_NODE_GUIDE_FALLBACK_CHUNK_KEYS=${CHAT_INFO_NODE_GUIDE_FALLBACK_CHUNK_KEYS}

# 배포 확인용. GET /health 가 이 값을 그대로 돌려주므로 어떤 빌드가 떠 있는지 URL 로 확인할 수 있다.
#   예: docker build --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" --build-arg GIT_COMMIT="$(git rev-parse --short HEAD)" .
ARG BUILD_TIME=""
ARG GIT_COMMIT=""
ARG APP_VERSION=""
ENV BUILD_TIME=${BUILD_TIME}
ENV GIT_COMMIT=${GIT_COMMIT}
ENV APP_VERSION=${APP_VERSION}

# 빌드 결과물 전체(소스+node_modules+dist) 복사
#   pnpm workspace 심볼릭 링크 구조를 유지하기 위해 통째로 가져온다.
COPY --from=build /app /app

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
 && chmod +x /usr/local/bin/docker-entrypoint.sh

# 배포용 compose 정본을 이미지에 동봉한다(단일 출처).
#   user-data.sh / deploy-image.sh 가 이 파일을 꺼내 /opt/rsp-qa-ai/compose.qa.yml 로 사용.
COPY deploy/compose.qa.yml /opt/app/compose.qa.yml

# 배포 서비스 포트 (4000 = demo)
EXPOSE 3001 3002 3003 3004 3005 3007 3008 4000

ENTRYPOINT ["docker-entrypoint.sh"]
# SERVICE_NAME 미지정 시 기본값 (compose 에서 서비스별로 덮어씀)
CMD ["event_receiver"]

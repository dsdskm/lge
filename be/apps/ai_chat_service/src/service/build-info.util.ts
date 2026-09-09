import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** 서버가 실제로 언제 배포된 빌드인지 알려 주는 값.
 * 컨테이너를 다시 올렸는지, 어떤 커밋이 올라갔는지 URL 하나로 확인하려고 둔다.
 * 값은 빌드 시 주입한 환경변수를 먼저 쓰고, 없으면 실행 중인 dist 파일 시각으로 대신한다.
 */
export type BuildInfo = {
  service: string
  version: string
  /** 이미지를 만든 시각(ISO). BUILD_TIME 이 없으면 dist 파일 수정 시각을 쓴다. */
  buildTime: string
  /** 빌드에 쓰인 커밋. GIT_COMMIT 이 없으면 빈 문자열. */
  commit: string
  /** 배포 환경 표시용. */
  env: string
  /** 프로세스가 뜬 시각(ISO). 이 값이 최근이면 방금 재시작된 것이다. */
  startedAt: string
  uptimeSec: number
}

const STARTED_AT = new Date()

function readPackageVersion(): string {
  for (const candidate of [
    join(process.cwd(), 'apps/ai_chat_service/package.json'),
    join(process.cwd(), 'package.json'),
  ]) {
    try {
      const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as { version?: string }
      const version = String(parsed?.version ?? '').trim()
      if (version) return version
    } catch {
      // 다음 후보를 본다. 버전을 못 읽어도 헬스 응답은 나가야 한다.
    }
  }
  return ''
}

/** 실행 중인 번들 파일의 수정 시각. 빌드 시각을 따로 주입하지 않는 로컬/개발 환경용이다. */
function readDistBuildTime(): string {
  const candidates = [
    process.argv[1],
    join(process.cwd(), 'apps/ai_chat_service/dist/main.js'),
    join(process.cwd(), 'dist/main.js'),
  ].filter(Boolean) as string[]

  for (const candidate of candidates) {
    try {
      return statSync(candidate).mtime.toISOString()
    } catch {
      // 다음 후보를 본다.
    }
  }

  return ''
}

export function buildInfo(): BuildInfo {
  const buildTime = String(process.env.BUILD_TIME ?? '').trim() || readDistBuildTime()

  return {
    service: 'ai_chat_service',
    version: String(process.env.APP_VERSION ?? '').trim() || readPackageVersion(),
    buildTime,
    commit: String(process.env.GIT_COMMIT ?? '').trim(),
    env: String(process.env.NODE_ENV ?? '').trim() || 'local',
    startedAt: STARTED_AT.toISOString(),
    uptimeSec: Math.max(0, Math.round((Date.now() - STARTED_AT.getTime()) / 1000)),
  }
}

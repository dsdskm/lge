/** 헬스체크 서비스. */
import { Injectable, Logger } from "@nestjs/common";

import { buildInfo, type BuildInfo } from "./build-info.util";

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  /** 배포 확인용. 어떤 빌드가 떠 있는지 같이 돌려준다. */
  check(): { ok: true } & BuildInfo {
    const info = buildInfo();
    this.logger.log(
      `[ai_chat_service] health check version=${info.version || '-'} buildTime=${info.buildTime || '-'} commit=${info.commit || '-'} startedAt=${info.startedAt}`,
    );
    return { ok: true, ...info };
  }
}

/** 헬스체크 컨트롤러. GET /health. */
import { Controller, Get, HttpCode } from '@nestjs/common';
import { ok, type ApiResponse } from '@ai-log/shared-contracts';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthService } from '../service/health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /**
   * API: 헬스 체크 상태를 조회한다.
   * Method/Path: GET /health
   * Response: 200 { code: 200, data: { ok: true, version, buildTime, commit, env, startedAt, uptimeSec } }
   * curl: curl -X GET 'http://localhost:3007/health'
   */
  @HttpCode(200)
  @Get()
  @ApiOperation({ summary: '서비스 헬스 상태와 배포된 빌드 정보를 조회' })
  @ApiOkResponse({ description: '헬스 체크 응답 반환' })
  check(): ApiResponse<Record<string, unknown>> {
    return ok(this.healthService.check());
  }
}

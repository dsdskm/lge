# be 스크립트 사용법

`be/` 아래 모든 `.sh` 의 목적과 사용 예시. 경로는 모두 **`be/` 기준**이며, 스크립트는 어디서 실행해도 내부에서 레포 루트로 이동한다.

| 스크립트 | 한 줄 목적 |
|---|---|
| [docker-entrypoint.sh](docker-entrypoint.sh) | 통합 이미지에서 실행할 서비스 1개를 골라 기동 |
| [kill-all-ports.sh](kill-all-ports.sh) | 백엔드 + 프론트 포트 일괄 종료 |
| [scripts/local/run.sh](scripts/local/run.sh) | 로컬 개발 서버 기동(DB URL 주입 포함) |
| [scripts/local/build.sh](scripts/local/build.sh) | 전체/개별 앱 빌드 |
| [scripts/local/run-docker.sh](scripts/local/run-docker.sh) | compose.local.yml 로 로컬 도커 기동 |
| [scripts/local/kill-all-ports.sh](scripts/local/kill-all-ports.sh) | 백엔드 포트만 일괄 종료 |
| [scripts/local/export-openapi.sh](scripts/local/export-openapi.sh) | 실행 중인 서비스의 OpenAPI 문서 저장 |
| [scripts/local/event-gen-loop.sh](scripts/local/event-gen-loop.sh) | 주기적으로 이벤트 로그 배치 생성 |
| [scripts/local/mcap/send-mcap.sh](scripts/local/mcap/send-mcap.sh) | .mcap 파일 1개를 receiver 로 전송 |
| [scripts/db/db.sh](scripts/db/db.sh) | 로컬 PostgreSQL 컨테이너 생성/시작/정지/삭제 |
| [scripts/db/db-tunnel-aws.sh](scripts/db/db-tunnel-aws.sh) | AWS EC2 안 DB 컨테이너를 로컬 포트로 포워딩 |
| [scripts/db/db-tunnel-codespace.sh](scripts/db/db-tunnel-codespace.sh) | Codespace 의 DB 포트를 로컬로 포워딩 |
| [scripts/aws/config.sh](scripts/aws/config.sh) | AWS 공통 설정/헬퍼 (직접 실행 안 함) |
| [scripts/aws/deploy.sh](scripts/aws/deploy.sh) | 이미지 빌드 → ECR 푸시 → EC2 배포 |
| [scripts/aws/health-check.sh](scripts/aws/health-check.sh) | 컨테이너 + ALB 2단계 헬스체크 |
| [scripts/aws/logs.sh](scripts/aws/logs.sh) | CloudWatch Logs 조회/실시간 추적 |
| [scripts/aws/backup.sh](scripts/aws/backup.sh) | EC2 의 모든 DB 컨테이너 덤프 |
| [scripts/aws/restore.sh](scripts/aws/restore.sh) | 백업 디렉터리를 EC2/로컬 DB 에 복원 |
| [scripts/aws/ssm.sh](scripts/aws/ssm.sh) | SSM 으로 EC2 접속 또는 원격 명령 1회 실행 |
| [scripts/codespaces/ports-public.sh](scripts/codespaces/ports-public.sh) | Codespace 포워딩 포트를 public 으로 변경 |
| [scripts/mock/generate.sh](scripts/mock/generate.sh) | 목 데이터(설정/이벤트/분석) 생성 |
| [scripts/ros2/ros2.sh](scripts/ros2/ros2.sh) | ROS2 wanderer 노드 실행 |
| [scripts/ros2/ros2-rviz.sh](scripts/ros2/ros2-rviz.sh) | RViz2 로 wanderer 시각화 |

---

## 로컬 개발

### scripts/local/run.sh — 개발 서버 기동
DB URL(`DB_URL_*`)을 로컬 터널 포트로 주입하고 `.env`(없으면 `.env.docker`)를 얹어 실행한다.
**루트 `pnpm dev` 는 `be/.env` 가 없으면 DB URL 이 비어 5432 로 붙어 실패하므로, 로컬에서는 이 스크립트를 쓴다.**

```bash
./scripts/local/run.sh                    # 전체 앱, dev
./scripts/local/run.sh ai_chat_service    # 단일 앱, dev
./scripts/local/run.sh ai_chat_service start   # 빌드 산출물로 기동
./scripts/local/run.sh prd                # 전체 프로덕션 빌드만 수행
```

### scripts/local/build.sh — 빌드
```bash
./scripts/local/build.sh                       # 전체
./scripts/local/build.sh ai_chat_service       # 단일 앱
./scripts/local/build.sh event_receiver event_analyzer   # 여러 앱
```

### scripts/local/run-docker.sh — 로컬 도커 기동
`compose.local.yml` + `.env.docker` 를 사용한다.
```bash
./scripts/local/run-docker.sh                       # 전체 up (build, detached)
./scripts/local/run-docker.sh ai_chat_service       # 특정 서비스만 up
./scripts/local/run-docker.sh ai_chat_service logs  # 로그 추적
./scripts/local/run-docker.sh down                  # 전체 down
```

### kill-all-ports.sh / scripts/local/kill-all-ports.sh — 포트 정리
```bash
./kill-all-ports.sh                 # 백엔드 + 프론트(5173/5176/5177) 포함
./scripts/local/kill-all-ports.sh   # 백엔드 포트만(9001, 3001~3005, 3007~3008)
```

### scripts/local/export-openapi.sh — OpenAPI 문서 저장
서비스가 떠 있는 상태에서 각 `/docs-json` 을 받아 `docs/openapi/` 에 저장한다.
```bash
./scripts/local/export-openapi.sh                # localhost
./scripts/local/export-openapi.sh 10.0.0.12      # 다른 호스트
```

### scripts/local/event-gen-loop.sh — 이벤트 주기 생성
`event_generator(/send)` 를 주기적으로 호출해 로그 배치를 만들고 receiver 로 흘려보낸다.
```bash
./scripts/local/event-gen-loop.sh 10             # 10초마다 무한 반복
./scripts/local/event-gen-loop.sh 10 5           # 10초 간격 5회
CLOUD=1 ./scripts/local/event-gen-loop.sh 10     # 클라우드 receiver 로 전송
LOGS_PER_SEC=20 DURATION_MIN=2 ./scripts/local/event-gen-loop.sh 30
```

### scripts/local/mcap/send-mcap.sh — MCAP 단건 전송
```bash
./scripts/local/mcap/send-mcap.sh                                   # 기본 샘플 파일 → localhost:3001
./scripts/local/mcap/send-mcap.sh ./sample.mcap http://localhost:3001
```

### scripts/mock/generate.sh — 목 데이터 생성
config_manager / event_generator / receiver / analyzer 를 순서대로 호출해 데이터 세트를 만든다. `curl jq awk shuf` 필요.
```bash
./scripts/mock/generate.sh 30            # 30건, 고정 날짜
./scripts/mock/generate.sh 30 random     # 30건, 랜덤 날짜
MOCK_COUNT=50 ./scripts/mock/generate.sh
```

---

## DB

### scripts/db/db.sh — 로컬 PostgreSQL 컨테이너
서비스별 컨테이너를 표준 포트로 띄운다(`root/root`).
`event_receiver 5433`, `event_analyzer 5434`, `action_runner 5436`, `report_manager 5437`, `mcp_tools 5438`, `ai_chat_service 5439`, `config_manager 5440`.
```bash
./scripts/db/db.sh          # 생성 또는 재시작
./scripts/db/db.sh stop     # 정지
./scripts/db/db.sh rm       # 정지 + 삭제(데이터 소멸)
```

### scripts/db/db-tunnel-aws.sh — EC2 DB 터널
DB 컨테이너는 호스트에 포트를 열지 않으므로, 컨테이너 IP:5432 를 SSM 포트포워딩으로 끌어온다. 로컬 포트는 `db.sh` 와 동일한 관례를 쓴다.
```bash
./scripts/db/db-tunnel-aws.sh                   # 6개 DB 일괄 터널 (창 유지)
./scripts/db/db-tunnel-aws.sh ai_chat_service   # 특정 서비스만
./scripts/db/db-tunnel-aws.sh event_receiver 15433   # 로컬 포트 지정
PORT_OFFSET=10000 ./scripts/db/db-tunnel-aws.sh # 로컬 dev DB 와 동시 사용
INSTANCE_ID=i-0123... ./scripts/db/db-tunnel-aws.sh
```
접속: `127.0.0.1:<포트>`, `root/root`, DB 이름 `<서비스>_db`. `session-manager-plugin` 필요.

### scripts/db/db-tunnel-codespace.sh — Codespace DB 터널
```bash
./scripts/db/db-tunnel-codespace.sh                     # $CODESPACE_NAME 사용
./scripts/db/db-tunnel-codespace.sh my-codespace-name
TUNNEL_ALL_PORTS=1 ./scripts/db/db-tunnel-codespace.sh  # 포워딩된 모든 포트
```

---

## AWS 배포/운영

`scripts/aws/config.sh` 는 계정·리전·ECR·ASG·ALB·S3 값과 `log/ok/warn/err`, `require_aws` 등 헬퍼를 담은 **공용 설정 파일**이다. 직접 실행하지 않고 다른 스크립트가 `source` 한다. 값은 환경변수로 덮어쓸 수 있다(`AWS_REGION=... ./scripts/aws/deploy.sh`).

### scripts/aws/deploy.sh — 배포
`linux/amd64` 이미지를 빌드해 ECR 에 푸시하고, ASG 의 InService 인스턴스(1대 고정)에 SSM 으로 교체 배포한다. 빌드 시각/커밋을 이미지에 넣어 `/health` 에서 확인할 수 있다.
```bash
./scripts/aws/deploy.sh              # image 모드(기본): 이미지만 교체
./scripts/aws/deploy.sh instance     # instance 모드: 인스턴스를 종료해 ASG 가 새로 띄우게 함
IMAGE_TAG=hotfix ./scripts/aws/deploy.sh
```

### scripts/aws/health-check.sh — 헬스체크
1) 인스턴스 내부 컨테이너 상태 → 2) 정상이면 ALB 를 통해 각 서비스 `/health` 호출.
```bash
./scripts/aws/health-check.sh                       # config.sh 의 ALB_DNS 사용
./scripts/aws/health-check.sh my-alb-123.ap-northeast-2.elb.amazonaws.com
SCHEME=http TIMEOUT=20 ./scripts/aws/health-check.sh
```

### scripts/aws/logs.sh — CloudWatch 로그
```bash
./scripts/aws/logs.sh                        # 로그 스트림(서비스) 목록
./scripts/aws/logs.sh ai_chat_service        # 실시간 로그(최근 5분부터)
./scripts/aws/logs.sh event_analyzer 30m     # 최근 30분부터 실시간
```

### scripts/aws/ssm.sh — EC2 접속
```bash
./scripts/aws/ssm.sh                            # ASG InService 인스턴스에 셸 접속
./scripts/aws/ssm.sh i-076fc7f8617a39baf        # 특정 인스턴스
./scripts/aws/ssm.sh -- "sudo docker ps -a"     # 원격 명령 1회 실행
```

### scripts/aws/backup.sh — DB 백업
6개 DB 컨테이너를 순서대로 덤프하고 `SHA256SUMS`·`backup_info.txt` 를 남긴다. 하나라도 실패하면 임시 디렉터리를 지워 **불완전한 백업을 남기지 않는다**. `deploy.sh` 등에서 `source` 해 함수로도 쓴다.
```bash
sudo ./scripts/aws/backup.sh /opt/app/backup    # EC2 에서 직접 실행

source ./scripts/aws/backup.sh                  # 함수로 사용
backup_databases "sudo docker" "/opt/app/backup"
```

### scripts/aws/restore.sh — DB 복원
```bash
./scripts/aws/restore.sh backup/db_backup_20260909152801            # EC2, 기존 데이터 유지(병합)
./scripts/aws/restore.sh -f backup/db_backup_20260909152801         # EC2, DB 삭제 후 전체 복원
./scripts/aws/restore.sh -local backup/db_backup_20260909152801     # 로컬 도커에 복원
./scripts/aws/restore.sh -f -local backup/db_backup_20260909152801
./scripts/aws/restore.sh -i i-00db45f6e071ee5c8 backup/db_backup_20260909152801
```
- 기본(병합) 모드: 기존 스키마/데이터 유지, 덤프 데이터만 넣는다. PK/UNIQUE 충돌이 날 수 있고 충돌해도 다음 컨테이너로 계속 진행한다.
- `-f`: 연결 종료 → DB drop → 재생성 → 스키마+데이터 전체 복원.
- `-local`: S3/SSM 없이 로컬 도커의 같은 이름 컨테이너에 직접 복원.
- 복원 후 id 시퀀스는 자동으로 `max(id)` 에 맞춘다. (시퀀스가 밀리면 이후 INSERT 가 PK 충돌로 실패하고, `chat_log` 처럼 저장 실패를 삼키는 곳은 "기록이 안 쌓인다" 로만 보인다)

---

## 컨테이너 / 기타

### docker-entrypoint.sh — 통합 이미지 엔트리포인트
`SERVICE_NAME` 또는 첫 번째 인자로 실행할 서비스를 정한다. 빌드 산출물이 없으면 즉시 실패한다.
```bash
docker run -e SERVICE_NAME=ai_chat_service unified-service
docker run unified-service report_manager
```
유효값: `event_receiver event_analyzer action_runner report_manager config_manager llm_gateway ai_chat_service demo`

### scripts/codespaces/ports-public.sh — Codespace 포트 공개
`gh` CLI 필요.
```bash
./scripts/codespaces/ports-public.sh
./scripts/codespaces/ports-public.sh my-codespace-name
```

### scripts/ros2/ros2.sh, ros2-rviz.sh — ROS2
ROS2 Humble 환경에서만 동작한다.
```bash
./scripts/ros2/ros2.sh            # INFO 이상 로그
./scripts/ros2/ros2.sh error      # ERROR/FATAL 만
./scripts/ros2/ros2-rviz.sh       # RViz2 실행(apps/ros2/wanderer.rviz)
```

---

## 자주 쓰는 순서

```bash
# 1) 로컬 DB 준비 (로컬 컨테이너 또는 AWS 터널 중 하나)
./scripts/db/db.sh
./scripts/db/db-tunnel-aws.sh          # 창 유지

# 2) 앱 기동
./scripts/local/run.sh ai_chat_service

# 3) 배포 후 확인
./scripts/aws/deploy.sh
./scripts/aws/health-check.sh
./scripts/aws/logs.sh ai_chat_service
```

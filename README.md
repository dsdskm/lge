# Robotics Workflow Portal

Robotics Workflow를 단계별로 구성하고 실행 이력을 관리하는 로컬 모노레포입니다. 포털 API는 NestJS와 PostgreSQL을 사용하고, 각 에이전트는 독립된 동기식 JSON REST 앱으로 실행됩니다.

## 구성

- `apps/web`: React + Vite 포털, Workflow 구성·실행 결과 관리
- `apps/api`: NestJS API, PostgreSQL 저장소, 설정된 노드 순서 실행
- `apps/planning-agent`: 요구사항 정리와 설계 입력/검증 기준 생성
- `apps/design-agent`: 차동구동 로봇의 primitive URDF 생성 및 선택적 Claude CLI 콘셉트 생성
- `apps/simulation-agent`: 2D 차동구동 운동학 미리보기
- `apps/implementation-agent`: URDF에서 ROS 2 구동 패키지 초안과 설정 파일 생성
- `apps/validation-agent`: URDF XML, 링크/조인트 참조 및 운동학 트리 검증
- `packages/agent-runtime`: 독립 에이전트 REST 서버 공통 런타임
- `packages/robot-model`: 공유 URDF 파서·검증 및 차동구동 형상 추출
- `packages/shared`: 프론트엔드와 API에서 공유하는 도메인 타입

Workflow는 `기획 → 설계 → 모델/시뮬 → 구현 → 검증`의 다섯 단계를 고정으로 가집니다. Agents 탭에서 기본 프로토타입 Agent를 포함해 Agent를 등록·수정·삭제하고, 각 Agent의 단계 유형, 서비스 주소, 실행 경로를 관리할 수 있습니다. Agent 서비스는 `<서비스 주소>/health`로 상태를 확인하며, Workflow 실행 시 등록된 실행 경로에 JSON 입력을 POST합니다. 기본 Agent의 전역 실행 옵션(기획의 출력 언어·상세도, 설계 엔진, 시뮬레이션 기본값, ROS 2 패키지 설정, 검증 강도)은 PostgreSQL에 저장해 모든 Workflow에 적용합니다. Workflow에서 사용 중인 Agent는 해당 Workflow에서 제거한 뒤에 삭제하거나 다른 단계 유형으로 변경할 수 있습니다. Workflow 생성 후 각 단계의 Agent와 Work 노드를 추가·삭제·정렬하고, 입력 경로를 매핑해 서로 다른 실행 흐름을 구성할 수 있습니다. Work 노드는 앞선 실행 결과나 입력 데이터의 값을 골라 다른 Agent 입력 필드에 연결합니다. 모든 노드의 입력·상태·출력은 실행 이력에 저장됩니다.

지식 Agent(HW·기구·BSP·제어·기획)는 실행 단계와 별개의 재사용 가능한 지침 프로필입니다. 각 단계에서 다섯 프로필을 모두 연결할 수 있으며, 실행 시 해당 단계의 Agent에 `knowledgeContext`로 전달됩니다. 설계 Agent는 Claude CLI 모드에서 지침을 프롬프트에 포함하고, 구현 Agent는 생성된 README에 지침을 기록합니다. 기획·시뮬레이션·검증은 지침을 검토 항목으로 결과에 남기며 `verified: false`로 표시합니다. 이 프로토타입은 외부 문서나 지식베이스를 검색하지 않고, 해당 검토 항목이 자동으로 검증됐다고 간주하지 않습니다.

새 Workflow를 만든 뒤 **단계 구성 편집**에서 해당 단계의 Agent와 Work 노드를 배치합니다. 매핑 원본 경로는 `input.requirements.robotName`, 이전 노드 결과 경로는 `steps.<노드 ID>.<필드명>` 형식입니다. Agent 입력 매핑의 대상은 각 REST 앱이 받는 JSON 필드 경로입니다. Workflow는 독립적으로 관리되며 프로젝트 개념은 사용하지 않습니다. 기획 Agent는 설계 요구사항과 검증 기준을 구성하고, 구현 Agent는 ROS 2 패키지 초안을 생성합니다. 구현 결과는 하드웨어 드라이버가 포함된 완제품이 아니며, 실제 장비의 `ros2_control` 연동과 검증이 필요합니다.

기존 데이터베이스의 프로젝트 관련 테이블과 링크는 삭제하지 않고 보존합니다. 새 포털에서는 이를 조회하거나 사용하지 않습니다.

## 요구사항

- Node.js 22.5 이상
- PostgreSQL (Homebrew 서비스 스크립트 기준 18)
- pnpm

## 실행

```sh
pnpm install
./scripts/db-start.sh
pnpm dev
```

루트 `.env`의 설정을 API와 에이전트 앱이 읽습니다. 다른 환경에서는 `.env.example`을 복사해 사용하세요.

```sh
cp .env.example .env
```

`pnpm dev`는 아래 서비스를 함께 시작합니다.

| 서비스 | 주소 | 용도 |
| --- | --- | --- |
| 웹 포털 | `http://127.0.0.1:5173` | Workflow 관리와 결과 조회 |
| 포털 API | `http://127.0.0.1:4310` | 데이터베이스, Workflow 구성·실행 |
| 기획 에이전트 | `http://127.0.0.1:4324` | `POST /plan` |
| 설계 에이전트 | `http://127.0.0.1:4321` | `POST /design` |
| 시뮬레이션 에이전트 | `http://127.0.0.1:4323` | `POST /simulate` |
| 구현 에이전트 | `http://127.0.0.1:4325` | `POST /implement` |
| 검증 에이전트 | `http://127.0.0.1:4322` | `POST /validate` |

API는 `.env`의 PostgreSQL 접속 설정을 사용하고, 시작 시 필요한 테이블을 생성합니다. `POSTGRES_USER`와 `POSTGRES_PASSWORD`가 비어 있으면 로컬 OS 사용자와 PostgreSQL의 기본 로컬 인증 설정을 사용합니다.

`./scripts/kill-port.sh`는 인자가 없으면 웹 기본 포트(5173)와 `.env` 또는 환경 변수로 설정된 API, 에이전트, PostgreSQL 포트에서 수신 중인 프로세스를 종료합니다. 해당 포트를 사용하는 다른 프로그램이나 공유 PostgreSQL 서비스도 종료될 수 있습니다. 특정 포트만 종료하려면 `./scripts/kill-port.sh 4310 4321`처럼 지정하세요. Vite가 다른 포트로 자동 변경한 경우에는 해당 포트를 직접 지정해야 합니다.

설계 에이전트는 기본적으로 `DESIGN_AGENT_ENGINE=claude-cli`를 사용하며, 로컬에서 Claude CLI가 인증된 상태여야 합니다. Claude CLI 없이 빠르게 테스트하려면 `.env`에서 `DESIGN_AGENT_ENGINE=template`으로 설정하세요. 두 모드 모두 URDF는 primitive 형상으로 생성하며, 제작용 CAD가 아닙니다.

시뮬레이션은 Mac에서 실행 가능한 2D 운동학 미리보기로, 중력·마찰·슬립·3D 충돌을 계산하지 않습니다. ROS 2 / Gazebo 기반의 물리 검증을 대체하지 않습니다.

## 로컬 PostgreSQL 서비스 (macOS)

Homebrew로 설치된 PostgreSQL 서비스를 시작하거나 중지합니다.

```sh
./scripts/db-start.sh
./scripts/db-stop.sh
```

스크립트는 설치된 PostgreSQL 버전을 자동 선택하고, `.env`의 `POSTGRES_DB` 데이터베이스가 없으면 생성합니다. 다른 설치 버전을 지정하려면 `POSTGRES_FORMULA` 환경 변수를 설정할 수 있습니다.

## 검증

```sh
pnpm test
pnpm build
```

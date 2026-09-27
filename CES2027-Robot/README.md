# CES2027 Robot Azure 리소스 요청

안녕하세요.

CES2027 Robot의 문서 관리 및 폴더 기반 RAG 챗봇 구현을 위해 아래 리소스 확인을 요청드립니다.

## 필수 요청 리소스

### 1. Azure APIM / Azure OpenAI

목적:

- 사용자 질문에 대한 LLM 답변 생성
- 문서 chunk 임베딩 생성

확인 필요:

- Chat deployment name (`gpt-5` 사용 가능 여부)
- Embedding deployment name (`text-embedding-3-small` 사용 가능 여부)
- Embedding vector dimension
- Responses API와 Embeddings API 호출 권한
- API key 재발급 및 안전한 전달 방식

현재 APIM endpoint:

```text
https://apim-rndinsgt.azure-api.net/dea-ai
```

### 2. 운영용 백엔드 호스팅

예: Azure App Service 또는 사내 표준 호스팅

목적:

- Teams 탭에서 호출할 API 운영
- 파일 업로드, 폴더 관리, RAG 채팅 API 제공

필요 사항:

- 공개 HTTPS endpoint
- 환경변수/Secret 주입
- APIM, DB, GCS outbound 접근

### 3. 운영 데이터베이스

예: Azure Database for PostgreSQL 또는 사내 PostgreSQL

목적:

- 폴더/파일/권한 메타데이터 저장
- RAG chunk와 embedding 저장

필요 사항:

- `pgvector` extension 사용 권한
- 운영 DB 접속 정보
- App Service에서 DB 접근 권한

## 선택 사항

### Azure AI Search

Azure 관리형 검색을 표준으로 사용해야 할 때 요청합니다.

- 벡터/키워드 검색 인프라 관리
- 인덱서와 문서 검색 운영 부담 감소

### Azure Blob Storage

현재는 GCP Cloud Storage를 원본 파일 저장소로 사용하므로 필수는 아닙니다. Azure로 통일해야 할 때만 요청합니다.

## 추천 구성

```text
Azure APIM / OpenAI     LLM 답변 + Embedding
PostgreSQL + pgvector   폴더 필터 + RAG 벡터 검색
GCP Cloud Storage       원본 파일 저장
Azure App Service       백엔드 API
```

Azure AI Search는 검색 인프라를 관리형으로 줄여주지만 별도 리소스와 인덱스 설정이 필요합니다. 현재처럼 폴더, 파일, 이동, 복사, 권한 범위를 직접 제어해야 하므로 **PostgreSQL + pgvector 방식이 더 유연하고 현재 구조와도 잘 맞습니다.**

## 영상 음성 검색

- MP4, MOV, WebM과 문서 업로드 상한은 파일당 200MB입니다. 영상은 임시 디스크를 거쳐 GCS에 저장하고 작업 ID를 즉시 반환합니다. 파일 화면에서 전사·색인 상태 및 실패 이유를 확인할 수 있습니다.
- 영상 음성을 FFmpeg로 추출하여 시간 구간별 청크로 색인합니다. Cloud Speech-to-Text API가 비활성화된 경우 기존 Vertex 모델로 5분씩 나눠 전사합니다. 해당 GCP 프로젝트의 GCS 및 Vertex 사용 권한이 필요하며, Speech API를 활성화하면 Speech-to-Text를 우선 사용합니다.
- 채팅은 **말로 설명된 내용만** 검색할 수 있습니다. 화면에만 보이는 동작은 검색할 수 없습니다. 영상 색인이 완료돼야 검색 대상에 포함되며, 답변 출처를 클릭하면 해당 시점부터 재생합니다.
- `pnpm install`은 `pnpm-workspace.yaml`에서 허용한 `ffmpeg-static` 설치 스크립트를 실행해야 합니다. 영상 색인 작업 상태는 PostgreSQL에 보관되고 서버 재시작 시 대기 작업을 다시 처리합니다.

감사합니다.

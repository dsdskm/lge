## nest 생성
pnpm dlx @nestjs/cli new apps/ai_chat_service --package-manager pnpm --skip-git

## port
lsof -i :8080 -i :3001 -i :3002 -i :3003 -i :3004 -i :3005 -i :9001 
lsof -i :3008 

## run
./workspace/lge/ailog_github/be/scripts/local/run.sh event_generator
./workspace/lge/ailog_github/be/scripts/local/run.sh event_receiver
./workspace/lge/ailog_github/be/scripts/local/run.sh event_analyzer
./workspace/lge/ailog_github/be/scripts/local/run.sh llm_gateway
./workspace/lge/ailog_github/be/scripts/local/run.sh config_manager
./workspace/lge/ailog_github/be/scripts/local/run.sh report_manager
./workspace/lge/ailog_github/be/scripts/local/run.sh action_runner
./workspace/lge/ailog_github/be/scripts/local/run.sh ai_chat_service

# DB 초기화
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;

# DB 터널링
(로컬PC)
scripts/db/db-tunnel-codespace.sh

# gh
echo "apiKey" | gh auth login --with-token --insecure-storage
gh cs list

# codespace name
fictional-lamp-x99gpvjw7963jv5

# codespace stop / start
gh codespace stop -c fictional-lamp-x99gpvjw7963jv5
gh codespace start -c fictional-lamp-x99gpvjw7963jv5

# sql
## 접속
docker exec -it ai-chat-service-pg psql -U root -d ai_chat_service_db 
docker exec -it event-receiver-pg psql -U root -d event_receiver_db 
docker exec -it config-manager-pg psql -U root -d config_manager_db 

# DB Restore
## 백업 파일 복사
docker cp ./sql/ai_chat_service_db ai-chat-service-pg:/tmp/ai_chat_service_db

## DB 초기화
docker exec -it ai-chat-service-pg psql -U root -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'ai_chat_service_db' AND pid <> pg_backend_pid();"
docker exec -it ai-chat-service-pg psql -U root -d postgres -c "DROP DATABASE IF EXISTS ai_chat_service_db;"
docker exec -it ai-chat-service-pg psql -U root -d postgres -c "CREATE DATABASE ai_chat_service_db OWNER root;"

DROP SCHEMA public CASCADE;
CREATE SCHEMA public;

## Restore(dump)
docker exec -it ai-chat-service-pg pg_restore -U root -d ai_chat_service_db --clean --if-exists /tmp/ai_chat_service_db

## 확인
docker exec -it ai-chat-service-pg psql -U root -d ai_chat_service_db -c "\dt"


## full_log query
ALTER TABLE events ADD COLUMN IF NOT EXISTS full_log JSONB;

## testcase - taskflow

### rule
parallel 노드 추가해줘
parallel 노드에 puase 추가해줘
parallel 노드에 pause 추가해줘
parallel 노드 하단에 도슨트 대기 추가해줘
인트로 tts, bouquet_hand_present 모션, Love 얼굴을 동시에 수행하는 parallel을 만들고 Pause 노드 우측에 연결 해줘
pause 추가해
thumb_up 모션 성공하면 Love 얼굴, 실패하면 Idle 얼굴 보이게 하는 ifThenElse 노드를 만들고 두번쨰 Pause 노드 우측에 연결해줘
Love를 Joy로 바꿔줘
Love 노드 지워줘
Love노드 3회 반복해줘
Repeat 반복회수 5로 바꿔줘
3초 기다렸다가 Love노드 실행해줘
Delay 노드 시간을 5초로 바꿔줘
Love노드 실행하고 3초 타임아웃 걸어줘

도슨트 환영 장소 이동해서 1.인트로 발화하고 도슨트 안내 장소로 이동해서 2.TV 구조도 설명1 발화 해줘. 그리고 작별 인사하고 도슨트 대기 장소로 돌아오게 해줘
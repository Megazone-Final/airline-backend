# Payments Service Required Variables

이 문서는 `payments` 서비스가 실제로 사용하는 환경변수와 각 값의 의미를 정리한 파일입니다.
현재 기준으로 이 서비스는 MySQL에 `IAM DB Authentication`으로 접속합니다. 따라서 고정 DB 비밀번호는 사용하지 않습니다.

## MySQL

### `DB_HOST`
- 의미: 접속할 MySQL 엔드포인트 주소입니다.
- 예시: `rds-airline-mysql-main.cluster-cb8q4mm6485z.ap-northeast-2.rds.amazonaws.com`
- 설명: 현재 배포에서는 이 주소로 직접 접속합니다.

### `DB_PORT`
- 의미: MySQL 포트입니다.
- 예시: `3306`

### `DB_USER`
- 의미: MySQL 로그인 사용자명입니다.
- 예시: `payment_user`
- 설명: 이 사용자는 DB에서 IAM 인증 사용자로 설정되어 있어야 합니다.

### `DB_NAME`
- 의미: 사용할 데이터베이스 이름입니다.
- 예시: `payments`

### `AWS_REGION`
- 의미: RDS IAM 인증 토큰을 발급할 AWS 리전입니다.
- 예시: `ap-northeast-2`
- 설명: DB가 있는 리전과 일치해야 합니다.

## Valkey / Session

### `VALKEY_URL`
- 의미: 세션 저장소로 사용하는 Valkey 접속 주소입니다.
- 예시: `rediss://valkey-user:password@host:6379`
- 설명: 서비스는 로그인 세션을 Valkey에서 읽고 갱신합니다.

### `SESSION_TTL_SECONDS`
- 의미: 세션 만료 시간을 초 단위로 지정합니다.
- 예시: `604800`
- 설명: `604800`은 7일입니다.

### `SESSION_COOKIE_NAME`
- 의미: 브라우저 쿠키에서 읽을 세션 토큰 이름입니다.
- 예시: `session_token`

### `SESSION_PREFIX`
- 의미: Valkey에 저장할 때 세션 키 앞에 붙는 prefix입니다.
- 예시: `auth:session:`

## Service Runtime

### `PORT`
- 의미: payments 서비스가 뜰 포트입니다.
- 예시: `3000`

### `CORS_ORIGIN`
- 의미: CORS 허용 origin 목록입니다.
- 예시: `http://localhost:3000`
- 설명: 여러 개를 허용하려면 쉼표로 구분합니다.

## Flights Service Integration

### `FLIGHTS_SERVICE_URL`
- 의미: flights 서비스의 기본 URL입니다.
- 예시: `http://svc-flight.flight.svc`
- 설명: 결제 생성 시 항공편 조회와 예약 생성 요청을 이 서비스로 보냅니다.
- 설명: 여러 후보 주소를 시도하려면 쉼표로 구분해 넣을 수 있습니다.

### `INTERNAL_API_KEY`
- 의미: flights 서비스의 내부 API 보호용 키입니다.
- 예시: 빈 값 가능
- 설명: 값이 있으면 `x-internal-api-key` 헤더로 전달합니다.

## Not Used Now

아래 값들은 현재 코드 기준으로 사용하지 않습니다.

- `DB_PASSWORD`
  현재 MySQL은 비밀번호 대신 IAM 인증 토큰으로 접속합니다.
- `DB_CONNECTION_LIMIT`
  현재 코드는 connection pool을 쓰지 않습니다.
- `DB_AUTO_INIT`
  현재 코드에는 이 변수를 읽는 로직이 없습니다.
- `COOKIE_SAME_SITE`
  현재 코드에는 이 변수를 읽는 로직이 없습니다.
- `COOKIE_SECURE`
  현재 코드에는 이 변수를 읽는 로직이 없습니다.

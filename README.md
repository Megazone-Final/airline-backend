# airline-backend

`airline-backend`는 항공 예약 서비스의 백엔드 마이크로서비스 코드를 담고 있습니다. 인증, 항공편, 결제 서비스가 각각 독립된 디렉터리로 분리되어 있습니다.

## 서비스 구성

### `auth/`

담당 기능:

- 회원가입
- 로그인/로그아웃
- 프로필 조회
- Valkey 기반 세션 저장

기본 실행 정보:

- 포트: `3001`
- 라우트 기준 경로: `/api/auth/users`

의존성:

- MySQL
- Valkey

### `flight/`

담당 기능:

- 항공편 검색
- 항공편 상세 조회
- 예약 목록/상세 조회
- 결제 서비스용 내부 예약 생성 API

기본 실행 정보:

- 코드 기본 포트: `3002`
- 공개 라우트: `/api/flight`, `/api/flight/reservations`
- 내부 라우트: `/internal/reservations`

의존성:

- MySQL

동작 메모:

- `DB_AUTO_INIT=true`면 테이블 자동 생성
- `FLIGHTS_AUTO_SEED=true`면 항공편 시드 데이터 적재

### `payment/`

담당 기능:

- 결제 생성
- 결제 이력/상세 조회
- flight 서비스와 연동한 예약 확정 처리

기본 실행 정보:

- 코드 기본 포트: `3000`
- 라우트 기준 경로: `/api/payment`

의존성:

- MySQL
- Valkey
- flight 서비스 내부 API
- 현재 구현 기준 AWS RDS IAM 인증 경로

## 저장소 구조

- `auth/` : 인증 서비스
- `flight/` : 항공편/예약 서비스
- `payment/` : 결제 서비스
- `.github/workflows/` : 서비스별 이미지 빌드 및 ECR 푸시 워크플로

## 로컬 실행

각 서비스 디렉터리에서 개별 실행합니다.

### auth

```bash
cd auth
npm install
npm run dev
```

### flight

```bash
cd flight
npm install
npm run dev
```

### payment

```bash
cd payment
npm install
npm run dev
```

권장 로컬 포트:

- auth: `3001`
- flight: `3002`
- payment: `3003`

이유:

- `payment` 서비스의 코드 기본 포트가 `3000`이라 프론트 개발 서버와 충돌할 수 있습니다.
- `flight/.env.example`에는 `PORT=3000`이 있지만, 실제 코드 기본값은 `3002`입니다.

## 환경변수 메모

### auth

주요 환경변수:

- `PORT`
- `CORS_ORIGIN`
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
- `DB_AUTO_INIT`
- `VALKEY_URL`

### flight

참고 파일:

- `flight/.env.example`

주요 환경변수:

- `PORT`
- `CORS_ORIGIN`
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
- `DB_AUTO_INIT`
- `FLIGHTS_AUTO_SEED`
- `INTERNAL_API_KEY`

### payment

주요 환경변수:

- `PORT`
- `CORS_ORIGIN`
- `AWS_REGION`
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_NAME`
- `VALKEY_URL`
- `FLIGHTS_SERVICE_URL`
- `INTERNAL_API_KEY`

중요:

- 현재 payment 서비스의 DB 연결 코드는 AWS RDS IAM 토큰 인증을 전제로 작성되어 있습니다.
- 단순 로컬 MySQL 비밀번호 연결만으로는 바로 실행되지 않을 수 있습니다.

## Docker

서비스별 Dockerfile:

- `auth/Dockerfile`
- `flight/Dockerfile`
- `payment/Dockerfile`

예시:

```bash
docker build -t airline-auth ./auth
docker build -t airline-flight ./flight
docker build -t airline-payment ./payment
```

## CI/CD

ECR 이미지 빌드/푸시용 GitHub Actions:

- `.github/workflows/auth-ecr.yml`
- `.github/workflows/flight-ecr.yml`
- `.github/workflows/payment-ecr.yml`

현재 확인된 주의사항:

- `flight`와 `payment` 워크플로는 각각 `flights/**`, `payments/**` 경로를 감시합니다.
- 실제 디렉터리 이름은 `flight/`, `payment/`입니다.
- 워크플로 트리거를 신뢰하기 전 경로 필터를 먼저 점검해야 합니다.

## 역할 경계

- 이 저장소는 백엔드 애플리케이션 코드와 서비스 이미지 생성을 담당합니다.
- Kubernetes 운영 매니페스트는 `../airline-eks`에 있습니다.
- 공용 AWS 인프라는 `../airline-infra`에서 관리합니다.

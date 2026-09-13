# 가계부

Next.js와 Firebase로 만든 개인 가계부입니다. 수입·지출, 예금·적금과 주식 주문, 작업 정산을 한 화면에서 관리합니다.

Firebase 환경변수가 없으면 브라우저 로컬 저장소를 사용하고, 설정하면 허용된 Google 계정으로 로그인한 사용자만 Firestore 저장소를 사용합니다.

## 실행

패키지 매니저는 pnpm을 사용합니다.

```bash
pnpm install
pnpm dev      # http://localhost:3000
pnpm build    # 프로덕션 빌드
pnpm lint
pnpm test     # node:test 기반 도메인·임포트 테스트
pnpm typecheck
pnpm test:firestore # Java 21 이상 필요, demo-gagebu 에뮬레이터만 사용
pnpm exec playwright install chromium webkit # Linux에서는 --with-deps 추가
pnpm test:e2e # 별도 개발 서버·브라우저 프로필과 합성 데이터 사용
pnpm test:ios # WebKit의 iPhone SE·iPhone 13·iPad Mini 프로필 검사
```

CI는 Node 22에서 단위 검사, 린트, 타입 검사, 프로덕션 빌드, Firestore 규칙 검사와 브라우저 회귀 검사를 실행합니다. 브라우저 검사는 320·390·768·1440px에서 기간 선택, 필터, 터치 영역을 확인하고 저장·재조회·오류 재시도·백업·가져오기를 검증합니다. 실제 사용자 기록을 읽거나 바꾸지 않습니다.

`test:ios`는 macOS 또는 Linux의 Playwright WebKit에서 320·390·768px 기기 프로필과 터치 입력을 검증합니다. 실제 iOS 기기 검사는 아니며, 네이티브 키보드·Files 선택기·VoiceOver는 별도로 확인해야 합니다. [검증 결과와 남은 실기기 확인 항목](docs/ios-validation.md)을 참고하세요.

## 기록과 백업

지출의 결제 수단·상점·메모를 상세와 수정 화면에서 확인할 수 있습니다. 예금의 잔액 0은 미입력과 구분하며, 종료 계좌는 현재 잔액 합계에서 제외합니다. 주식 주문 누적액은 매수·매도 주문액 합계로, 보유 평가액이나 순자산이 아닙니다. 외화 주문은 해당 통화로 표시하고 원화 합계와 구분합니다.

작업은 작업명으로 검색하며 미완료 작업의 마감이 빠른 순서로 표시합니다. 카테고리 이름 변경은 작업의 고정 ID 연결을 유지합니다. 기존 작업의 과목·회차 등 숨겨진 필드와 가져오기 출처 정보는 보존됩니다.

`백업·복원`에서 거래·예금·주식 주문·작업·카테고리 전체를 JSON으로 내려받을 수 있습니다. 복원은 version 1 형식을 검증한 뒤 유형별 추가·유지 건수를 보여줍니다. 같은 ID 또는 가져오기 식별자가 있으면 현재 기록을 유지하고, 없는 기록만 추가합니다. 기존 기록을 삭제하거나 덮어쓰지 않습니다. 일부만 저장된 경우 다시 시도하면 이미 추가된 기록을 건너뜁니다. 복원 파일은 최대 20MB입니다.

카테고리 초기화 표식, 지출 상세, 예금 종료일, 작업 카테고리 ID를 지원하려면 앱 업데이트와 함께 변경된 `firestore.rules`가 필요합니다. 규칙은 `main`에 머지되면 자동 배포됩니다. [Firestore 규칙 배포](#firestore-규칙-배포)를 참고하세요.

## 접근 권한

접근할 수 있는 Google 계정은 `firestore.rules`의 목록 한 곳에서만 정합니다. 사람을 추가하거나 빼려면 그 목록을 고쳐 머지하면 되고, 배포는 자동으로 이뤄집니다.

앱 번들에는 허용 목록이 들어 있지 않습니다. 예전에는 `NEXT_PUBLIC_ALLOWED_GOOGLE_EMAIL`에도 같은 목록을 두었지만, 두 목록이 어긋나면 규칙상 허용된 계정이 로그인 화면에서 막히는 일이 생겼습니다. 게다가 `NEXT_PUBLIC_` 값은 내려받은 자바스크립트에서 그대로 읽히고, 브라우저 쪽 검사는 건너뛴 채 Firestore를 직접 부를 수도 있어 보안 경계가 되지 못했습니다.

지금은 로그인 후 Firestore에 표식 문서를 한 번 읽어 보고, 규칙이 거부하면 로그아웃시킨 뒤 권한 없음을 알립니다. 실제 경계는 언제나 규칙이며, 화면은 그 판단을 그대로 따릅니다. 읽기가 네트워크 오류로 실패한 경우는 거부로 보지 않고 세션을 유지합니다.

## 데모 페이지

`/demo` 경로는 더미 데이터로 채운 테스트용 페이지입니다. 로그인 없이 열리고, 데이터는 메모리에만 있어 새로고침하면 초기화됩니다. 메뉴에 노출되지 않고 검색엔진 색인도 막아 둡니다.

## Firebase 설정

1. Firebase Console에서 프로젝트와 Web App을 만듭니다.
2. Authentication의 로그인 제공업체에서 Google을 활성화합니다.
3. Firestore Database를 생성합니다.
4. `.env.local.example`을 `.env.local`로 복사하고 Web App 설정값을 입력합니다.
5. `firestore.rules`의 허용 이메일 목록에 접근할 Google 주소를 넣습니다. 접근 권한을 정하는 곳은 여기 한 곳뿐입니다.
6. `firestore.rules`를 배포합니다. 최초 1회는 아래처럼 직접 실행하고, 이후에는 자동 배포에 맡깁니다.

```bash
firebase login
firebase use --add
firebase deploy --only firestore:rules
```

기존 브라우저 로컬 데이터는 Firebase 연결 후 허용된 Google 사용자 계정으로 최초 1회 자동 이전됩니다.

## Firestore 규칙 배포

Vercel은 Next.js 앱만 배포하므로 `firestore.rules`는 별도 경로로 Firestore에 올라갑니다. 이 배포를 빠뜨리면 앱은 새 필드와 경로에 쓰려 하는데 라이브 규칙이 그 경로를 모르는 상태가 되고, 화면에는 `Missing or insufficient permissions`만 표시됩니다.

`.github/workflows/deploy-firestore-rules.yml`이 이 단계를 대신합니다. `main`에서 `firestore.rules`·`firebase.json`·`.firebaserc`가 바뀌면 실행되고, Actions 탭에서 수동 실행할 수도 있습니다. 배포 전에 `pnpm test:firestore`를 먼저 돌려 에뮬레이터가 거부하는 규칙이 올라가지 않게 막습니다.

동작하려면 저장소 시크릿 `FIREBASE_SERVICE_ACCOUNT`에 서비스 계정 키 JSON 전체를 넣어야 합니다.

1. Firebase Console의 프로젝트 설정 > 서비스 계정에서 새 비공개 키를 생성합니다.
2. 해당 서비스 계정에 `Firebase Rules Admin` 역할을 부여합니다.
3. 내려받은 JSON 파일 내용을 그대로 `FIREBASE_SERVICE_ACCOUNT` 시크릿에 붙여넣습니다.

시크릿이 없으면 워크플로가 즉시 실패하므로, 배포가 조용히 건너뛰어지는 일은 없습니다.

## 개발용 로그인 바이패스

Firebase 자격 증명 없이 화면을 보려면 `.env.local`에 아래 값을 넣고 개발 서버를 다시 시작합니다.

```
NEXT_PUBLIC_DEV_AUTH_BYPASS=1
```

로그인 게이트를 건너뛰고 바로 대시보드가 열리며, 데이터는 브라우저 로컬 저장소에 저장됩니다. `NODE_ENV=production`인 빌드에서는 이 값이 무시되므로 배포본에는 영향이 없습니다.

## 테마

헤더의 해·달 버튼으로 라이트/다크를 전환합니다. 선택한 값은 `localStorage`(`gagebu:theme`)에 저장되고, 저장된 값이 없으면 OS 설정을 따릅니다. `layout.tsx`의 인라인 스크립트가 페인트 전에 `data-theme`을 적용해 새로고침 시 화면이 번쩍이지 않습니다.

색은 `src/app/globals.css`의 시맨틱 토큰으로만 정의합니다.

- 표면·경계·텍스트: `bg-app`, `bg-surface`, `bg-card`, `bg-field`, `border-line`, `text-ink`, `text-body`, `text-muted`, `text-faint`
- 강조색: 수입/기본(세이지), 지출(클레이), 부수입(오커), 자산(더스티 블루), 주식(모브) 다섯 계열을 Tailwind 색 변수로 덮어써서 사용합니다. 테마별로 밝기 단계가 반대로 매핑되므로, 새 UI를 만들 때도 팔레트 값을 직접 적지 말고 토큰과 기존 계열 클래스를 씁니다.

## 모바일 레이아웃 점검

`scripts/mobile-audit.js`는 320·360·390·414·430px에서 탭 바, 44px 터치 타깃, 스탯 카드 줄바꿈, 가로 스크롤, 모달 바텀시트를 재어 표로 보여줍니다. `pnpm dev` 후 `http://localhost:3000` 콘솔에 파일 내용을 붙여넣고 `await mobileAudit()`을 실행합니다 — node로 실행하는 스크립트가 아닙니다.

측정하는 동안 저장된 기록을 고정 시드로 바꿨다가 끝나면 되돌립니다(예외가 나도 되돌립니다). 기록이 있으면 시작 전에 한 번 물어봅니다. Firebase 모드에서는 시드가 앱이 읽지 않는 키에 쓰이므로 실행을 거부합니다 — 로컬 저장소 모드에서 돌리세요.

의존성이 없는 수동 보조 도구입니다. CI의 Playwright 검사와 별도로 사용할 수 있습니다. 창 크기 조절 대신 앱을 해당 크기의 iframe에 띄워 재므로 미디어 쿼리는 정확하지만, **실기기의 주소창 높이 변화·터치 동작·iOS Safari 하단 바는 재현하지 못합니다.** 계정 컨트롤(로그아웃)은 Firebase 로그인 세션에서만 렌더되는데 그 세션은 Firebase 모드라 이 스크립트가 실행을 거부하므로, 그 버튼만은 자동 측정 대상이 아닙니다.

## 배포

`main`에 머지하면 Vercel이 자동 배포합니다. Vercel 프로젝트에도 `.env.local`과 같은 `NEXT_PUBLIC_*` 값을 등록해야 로그인이 동작합니다.

Vercel Hobby 플랜은 커밋 작성자가 계정 소유자일 때만 배포를 만듭니다. 커밋 author 이메일을 GitHub 계정에 연결된 주소로 설정해 두세요.

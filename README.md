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
```

## Firebase 설정

1. Firebase Console에서 프로젝트와 Web App을 만듭니다.
2. Authentication의 로그인 제공업체에서 Google을 활성화합니다.
3. Firestore Database를 생성합니다.
4. `.env.local.example`을 `.env.local`로 복사하고 Web App 설정값 및 본인 Google 이메일을 입력합니다.
5. `firestore.rules`의 허용 이메일도 같은 Google 이메일로 바꿉니다.
6. Firebase CLI로 `firestore.rules`를 배포합니다.

```bash
firebase login
firebase use --add
firebase deploy --only firestore:rules
```

기존 브라우저 로컬 데이터는 Firebase 연결 후 허용된 Google 사용자 계정으로 최초 1회 자동 이전됩니다.

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

## 배포

`main`에 머지하면 Vercel이 자동 배포합니다. Vercel 프로젝트에도 `.env.local`과 같은 `NEXT_PUBLIC_*` 값을 등록해야 로그인이 동작합니다.

Vercel Hobby 플랜은 커밋 작성자가 계정 소유자일 때만 배포를 만듭니다. 커밋 author 이메일을 GitHub 계정에 연결된 주소로 설정해 두세요.

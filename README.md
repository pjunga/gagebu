# 가계부

Next.js와 Firebase로 만든 간단한 가계부입니다. Firebase 환경변수가 없으면 브라우저 로컬 저장소를 사용하고, 설정하면 익명 인증된 사용자별 Firestore 저장소를 사용합니다.

## Firebase 설정

1. Firebase Console에서 프로젝트와 Web App을 만듭니다.
2. Authentication에서 익명 로그인(Anonymous)을 활성화합니다.
3. Firestore Database를 생성합니다.
4. `.env.local.example`을 `.env.local`로 복사하고 Web App 설정값을 입력합니다.
5. Firebase CLI로 `firestore.rules`를 배포합니다.

```bash
firebase login
firebase use --add
firebase deploy --only firestore:rules
```

기존 브라우저 로컬 데이터는 Firebase 연결 후 현재 익명 사용자 계정으로 최초 1회 자동 이전됩니다.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

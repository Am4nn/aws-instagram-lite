// Stand-in for the Next.js server until `npm run deploy:web` (or deploy:aws) has built web/.open-next.
export const handler = async () => ({
  statusCode: 503,
  headers: { "content-type": "text/plain" },
  body: "The web app is not built yet: run npm run deploy:web",
});

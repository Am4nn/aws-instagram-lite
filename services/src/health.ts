import { json } from "./http.js";

export async function handler() {
  return json(200, { ok: true, stage: process.env.STAGE, time: new Date().toISOString() });
}

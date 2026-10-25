import { NextRequest, NextResponse } from "next/server";
import { getSettings, saveSettings, WATCH_TOPICS, type Settings } from "@/lib/db";

const VALID = (v: unknown): v is Settings => {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  const arr = (x: unknown) => x === null || (Array.isArray(x) && x.every((i) => typeof i === "string"));
  return typeof s.minScore === "number" && Number.isInteger(s.minScore)
    && s.minScore >= 1 && s.minScore <= 5
    && arr(s.tags) && arr(s.sources) && arr(s.products)
    && typeof s.unreadOnly === "boolean"
    && typeof s.hideDownvoted === "boolean"
    && Array.isArray(s.blockedKeywords) && s.blockedKeywords.every((i) => typeof i === "string")
    && (s.blockMode === "hide" || s.blockMode === "drop")
    && typeof s.dropLowScore === "boolean"
    && (s.watchTopics == null
      || (Array.isArray(s.watchTopics)
        && s.watchTopics.every((i) => typeof i === "string" && (WATCH_TOPICS as readonly string[]).includes(i))));
};

export async function GET() {
  return NextResponse.json(await getSettings());
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!VALID(body)) {
    return NextResponse.json({ error: "设置格式不正确" }, { status: 400 });
  }
  await saveSettings(body);
  return NextResponse.json({ ok: true });
}

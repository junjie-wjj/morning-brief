import { NextRequest, NextResponse } from "next/server";
import { setFeedback } from "@/lib/db";

// 单条反馈：{"link": "...", "verdict": "up" | "down" | null}
// verdict=null 表示撤销反馈
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const link = body?.link;
  const verdict = body?.verdict;

  if (typeof link !== "string" || !/^https?:\/\//.test(link)) {
    return NextResponse.json({ error: "link 无效" }, { status: 400 });
  }
  if (verdict !== "up" && verdict !== "down" && verdict !== null) {
    return NextResponse.json({ error: "verdict 必须是 up / down / null" }, { status: 400 });
  }

  await setFeedback(link, verdict);
  return NextResponse.json({ ok: true, link, verdict });
}

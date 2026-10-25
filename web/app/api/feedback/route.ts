import { NextRequest, NextResponse } from "next/server";
import { execute, setFeedback } from "@/lib/db";

// 单条反馈：{"link": "...", "verdict": "up" | "down" | null}
// verdict=null 表示撤销反馈。写入时把条目当时的分类/产品快照进反馈行，
// 以后条目被删除，偏好统计依然记得"这条赞/踩的是什么类型"（删除失忆修复）。
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

  let snapshot: { tag?: string | null; product?: string | null } | undefined;
  const rows = await execute("SELECT tag, product FROM items WHERE link = ?", [link]);
  const item = rows.rows[0] as { tag?: string | null; product?: string | null } | undefined;
  if (item) snapshot = { tag: item.tag ?? null, product: item.product ?? null };

  await setFeedback(link, verdict, snapshot);
  return NextResponse.json({ ok: true, link, verdict });
}

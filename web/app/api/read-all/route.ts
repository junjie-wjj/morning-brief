import { NextRequest, NextResponse } from "next/server";
import { execute } from "@/lib/db";

// 批量标为已读：POST /api/read-all
// 请求体二选一：{"issue": "2026-10-24"} 只清这一期；{"all": true} 清所有期。
// 只改 status，不删任何数据；被去重合并的条目一并标读，避免它们以未读状态复活。
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);

  let result;
  if (body?.all === true) {
    result = await execute("UPDATE items SET status = 'read' WHERE status != 'read'", []);
  } else if (typeof body?.issue === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.issue)) {
    result = await execute("UPDATE items SET status = 'read' WHERE issue = ? AND status != 'read'", [
      body.issue,
    ]);
  } else {
    return NextResponse.json({ error: "需要 issue（YYYY-MM-DD）或 all: true" }, { status: 400 });
  }

  return NextResponse.json({ ok: true, updated: result.rowsAffected });
}

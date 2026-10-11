import { NextRequest, NextResponse } from "next/server";
import { execute } from "@/lib/db";

const VALID_STATUSES = new Set(["unread", "read", "later"]);

// 改条目状态：POST /api/items/123  请求体 {"status": "read"}
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const status = body?.status;

  if (!VALID_STATUSES.has(status)) {
    return NextResponse.json({ error: "status 必须是 unread / read / later" }, { status: 400 });
  }

  const itemId = Number(id);
  if (!Number.isInteger(itemId)) {
    return NextResponse.json({ error: "id 无效" }, { status: 400 });
  }

  const result = await execute("UPDATE items SET status = ? WHERE id = ?", [status, itemId]);
  if (result.rowsAffected === 0) {
    return NextResponse.json({ error: "条目不存在" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, id: itemId, status });
}

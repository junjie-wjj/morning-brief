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

// 删除单条：不可恢复。可见卡片都是主条目（或独立条目），
// 所以连带删掉「合并进来的重复报道」（dup_of 指向它的条目），整组一起走；
// 若删的是重复条目本身（理论上界面不会出现），只删它一条。
// 点赞/点踩的反馈记录保留——那是偏好学习的原料，不随条目消失。
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const itemId = Number(id);
  if (!Number.isInteger(itemId)) {
    return NextResponse.json({ error: "id 无效" }, { status: 400 });
  }

  const rows = await execute("SELECT link, dup_of FROM items WHERE id = ?", [itemId]);
  const item = rows.rows[0] as { link?: string; dup_of?: string | null } | undefined;
  if (!item?.link) {
    return NextResponse.json({ error: "条目不存在" }, { status: 404 });
  }

  const result = item.dup_of
    ? await execute("DELETE FROM items WHERE id = ?", [itemId])
    : await execute("DELETE FROM items WHERE link = ? OR dup_of = ?", [item.link, item.link]);

  return NextResponse.json({ ok: true, id: itemId, deleted: result.rowsAffected });
}

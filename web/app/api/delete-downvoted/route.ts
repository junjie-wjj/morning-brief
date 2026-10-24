import { NextResponse } from "next/server";
import { execute } from "@/lib/db";

// 批量删除所有点过「踩」的条目：POST /api/delete-downvoted（无请求体）
// 连同合并进这些条目的重复报道一起删；反馈记录保留（偏好学习还要用）。
// 不可恢复，界面按钮必须先弹确认。
export async function POST() {
  const result = await execute(
    `DELETE FROM items WHERE link IN (SELECT link FROM feedback WHERE verdict = 'down')
      OR dup_of IN (SELECT link FROM feedback WHERE verdict = 'down')`,
    [],
  );
  return NextResponse.json({ ok: true, deleted: result.rowsAffected });
}

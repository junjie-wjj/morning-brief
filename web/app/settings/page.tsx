import { getFilterOptions, getSettings } from "@/lib/db";
import SettingsForm from "./SettingsForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [settings, options] = await Promise.all([getSettings(), getFilterOptions()]);

  return (
    <div>
      <h1 className="border-b border-zinc-200 pb-2 text-base font-semibold">筛选设置</h1>
      <p className="mt-3 text-xs text-zinc-500">
        设置只影响首页的显示，不会删除任何数据；关掉筛选即可恢复全部内容（历史页始终完整）。
      </p>
      <SettingsForm initial={settings} options={options} />
    </div>
  );
}

import { getFilterOptions, getInsights, getSettings } from "@/lib/db";
import SettingsForm from "./SettingsForm";
import { IconSliders } from "../components/Icons";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [settings, options, insights] = await Promise.all([getSettings(), getFilterOptions(), getInsights()]);

  return (
    <div className="max-w-2xl">
      <header>
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-700">
          <IconSliders className="h-4 w-4" />
          Preferences
        </p>
        <h1 className="mt-1 font-serif text-2xl font-semibold tracking-tight text-ink">筛选设置</h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          设置只影响首页的显示，不会删除任何数据；关掉筛选即可恢复全部内容（历史页始终完整）。
        </p>
      </header>
      <SettingsForm
        initial={settings}
        options={options}
        insights={insights}
        authEnabled={Boolean(process.env.APP_PASSWORD?.trim())}
      />
    </div>
  );
}

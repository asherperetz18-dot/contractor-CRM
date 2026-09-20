import { SettingsBreadcrumb } from "./settings-breadcrumb";

// Every page under /settings/ gets its way back to the grid from here,
// so a new page cannot forget it. The grid itself renders no crumb.
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SettingsBreadcrumb />
      {children}
    </>
  );
}

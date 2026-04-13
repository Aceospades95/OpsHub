import { SettingsNav } from "./settings-nav";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <SettingsNav />
      {children}
    </>
  );
}

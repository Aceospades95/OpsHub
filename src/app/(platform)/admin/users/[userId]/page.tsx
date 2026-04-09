import { redirect } from "next/navigation";

interface Props {
  params: Promise<{ userId: string }>;
}

/**
 * Admin user detail page now redirects to the unified employee profile at /team/[id].
 * All user management capabilities (edit, delete, permissions) are available there.
 */
export default async function UserDetailPage({ params }: Props) {
  const { userId } = await params;
  redirect(`/team/${userId}`);
}
